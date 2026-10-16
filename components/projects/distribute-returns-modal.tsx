"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  TopSheet,
  ERPFormLayout,
  ERPFormSection,
  ERPFormGrid,
  ERPFormField,
  AppDropdown,
  DropdownOption,
  Button,
  StatusBadge,
} from "@/components/ui";
import { NumericInput } from "@/components/ui/numeric-input";
import { useLocale } from "@/lib/i18n";
import { Project, ProjectMemberParticipation } from "@/types";
import { formatMoney } from "@/lib/formatters";
import { intlLocaleFor } from "./project-labels";
import { apiClient } from "@/lib/api-client";
import { newIdempotencyRef } from "@/lib/idempotency";
import { toCents, splitByPercent, splitDividendByShares, parsePercentBp } from "@/lib/money";
import { AlertCircle, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Lock, Users, Plus, X, Landmark } from "lucide-react";

export interface DistributeFundOption {
  id: string;
  name: string;
  balance: number;
}

interface FundPick {
  fundId: string;
  /** Raw percent input, 0.01 – 100 (max 2dp). */
  percent: string;
}

export interface DistributeReturnsPayload {
  type?: "Profit" | "Loss" | "Both";
  amount?: number;
  /** 'Both' only: the loss leg, settled after the profit leg in one atomic run. */
  lossAmount?: number;
  /**
   * Settle & close: omit type/amount — the server pays the ENTIRE remaining
   * balance and marks the project Completed + permanently locked.
   */
  settleProject?: boolean;
  description: string;
  referenceNumber: string;
  fundAllocations?: Array<{ fundId: string; percent: number }>;
  /** The project this run targets — always set, so picker-mode runs post. */
  projectId: string;
}

interface DistributeReturnsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  /**
   * When `project` is null these are offered in an in-modal project picker —
   * list rows carry no involvedMembers, so the full project is fetched on pick.
   */
  projects?: Project[];
  /** Tenant funds the user may allocate the profit to (Profit only). */
  funds?: DistributeFundOption[];
  onSubmit: (payload: DistributeReturnsPayload) => Promise<void>;
}

interface PreviewState {
  /** Profit + loss legs combined (drives the balance-after strip). */
  totalCents: number;
  /** Profit leg only (denominator for the fund/member percent displays). */
  profitTotalCents: number;
  error: string | null;
  /** Sum of the parsed fund percents in basis points (0 when no/invalid funds). */
  sumBp: number;
  fundsTotalCents: number;
  membersTotalCents: number;
  fundPayouts: Map<string, number>;
  memberPayouts: Map<string, number>;
  /** Loss leg total (Both: from lossAmount; single Loss: from amount). */
  lossTotalCents: number;
  /** Pro-rata loss split per shareholder (display only; the server caps it at equity). */
  lossMemberPayouts: Map<string, number>;
}

export function DistributeReturnsModal({
  isOpen,
  onClose,
  project,
  projects,
  funds = [],
  onSubmit,
}: DistributeReturnsModalProps) {
  const { t, locale } = useLocale();
  const fm = (n: number | string | null | undefined) => formatMoney(n, "BDT", { locale: intlLocaleFor(locale) });

  // Distribution mode: "custom" (the user picks type + amounts) or "settle"
  // (Distribute Complete Project — the server pays the ENTIRE remaining
  // balance, marks the project Completed and permanently locks it).
  const [mode, setMode] = useState<"custom" | "settle">("custom");
  const [type, setType] = useState<"Profit" | "Loss" | "Both">("Profit");
  const [amount, setAmount] = useState<string>("");
  // 'Both' only: the loss leg (settled after the profit leg in one atomic run).
  const [lossAmount, setLossAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fundPicks, setFundPicks] = useState<FundPick[]>([]);
  const [pickerValue, setPickerValue] = useState<string | null>(null);
  // In-modal project picker (only when the caller didn't pin a project).
  const [projectPickerId, setProjectPickerId] = useState<string | null>(null);
  const [fetchedProject, setFetchedProject] = useState<Project | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  // §12 idempotency: one retry key per modal session — a retry after a
  // network failure reuses it so the server rejects the double payment.
  const [idempotencyRef, setIdempotencyRef] = useState<string>("");

  // Caller-pinned project wins; otherwise the one picked (and fully loaded)
  // inside the modal. Nothing renders below until one of them exists.
  const activeProject = project ?? fetchedProject;

  useEffect(() => {
    // Prefixed ref: persisted as the ledger reference number (profit/loss
    // return), so it must read like `PRJ-RET-…`, never a bare UUID.
    if (isOpen) {
      setIdempotencyRef(newIdempotencyRef("PRJ-RET"));
      setMode("custom");
      setFundPicks([]);
      setPickerValue(null);
      setProjectPickerId(null);
      setFetchedProject(null);
      setErrorMessage(null);
    }
  }, [isOpen, project?.id]);

  const typeOptions: DropdownOption[] = [
    { value: "Profit", label: t("projects.returns.profit", { defaultValue: "Profit / Dividend Return" }) },
    { value: "Loss", label: t("projects.returns.loss", { defaultValue: "Loss Allocation" }) },
    { value: "Both", label: t("projects.returns.both", { defaultValue: "Both (Profit + Loss)" }) },
  ];

  const shareholders = useMemo(
    () => activeProject?.involvedMembers || [],
    [activeProject],
  );
  const totalShares = Number(activeProject?.totalShares || 0);
  const currentBalance = Number(activeProject?.currentFundBalance || 0);
  const numAmount = parseFloat(amount) || 0;
  const numLoss = parseFloat(lossAmount) || 0;
  const isSettle = mode === "settle";
  // In a settle run the whole run IS a profit leg — display logic keys off
  // this so a stale custom "Loss" selection can't tint the preview.
  const effectiveType: "Profit" | "Loss" | "Both" = isSettle ? "Profit" : type;
  // Fund allocations apply to the profit leg (Profit, Both, and settle runs).
  const showFunds = effectiveType !== "Loss";
  const isBoth = !isSettle && type === "Both";
  // An already-settled project is an immutable record — the modal is a
  // notice, not a form.
  const projectLocked = Boolean(activeProject?.isLocked);

  const projectOptions: DropdownOption[] = useMemo(
    () =>
      (projects || []).map((p) => ({
        value: p.id,
        label: p.title,
        caption: p.status,
      })),
    [projects],
  );

  const handleProjectPick = async (val: string | null) => {
    setProjectPickerId(val);
    setErrorMessage(null);
    if (!val) {
      setFetchedProject(null);
      return;
    }
    // List rows have no involvedMembers — load the full project so the
    // pro-rata preview and balance checks are accurate.
    setLoadingProject(true);
    try {
      const res = await apiClient<{ data: Project } | Project>(`/projects/${val}`);
      setFetchedProject((res as any)?.data || res);
    } catch (err: any) {
      setFetchedProject(null);
      setErrorMessage(err?.message || t("projects.loadFailed", { defaultValue: "Failed to load project" }));
    } finally {
      setLoadingProject(false);
    }
  };

  // Funds still available to add (already-selected ones are removed from the
  // list so a fund can only appear once).
  const fundOptions: DropdownOption[] = useMemo(() => {
    const selected = new Set(fundPicks.map((p) => p.fundId));
    return funds
      .filter((f) => !selected.has(f.id))
      .map((f) => ({
        value: f.id,
        label: f.name,
        caption: `${t("projects.returns.fundBalance", { defaultValue: "Current Balance" })}: ${fm(f.balance)}`,
      }));
  }, [funds, fundPicks, t]);

  // ---- Live preview (display only) — mirrors the server's exact integer-cent
  // math so what the user sees is what the ledger posts:
  //   profit leg: funds block = round(amount × Σpct), split among funds
  //               (largest remainder); members block = amount − funds block,
  //               split pro-rata by shares.
  //   loss leg:   pro-rata split of the loss among shareholders. The server
  //               additionally caps each debit at the member's recorded
  //               equity (the note below the table explains this).
  const preview: PreviewState = useMemo(() => {
    const res: PreviewState = {
      totalCents: 0,
      profitTotalCents: 0,
      error: null,
      sumBp: 0,
      fundsTotalCents: 0,
      membersTotalCents: 0,
      fundPayouts: new Map(),
      memberPayouts: new Map(),
      lossTotalCents: 0,
      lossMemberPayouts: new Map(),
    };

    const shareSeeds = shareholders.map((s) => ({
      id: s.memberId,
      shares: Number(s.sharesInvested || 0),
    }));
    const splitToMembers = (cents: number, target: Map<string, number>): boolean => {
      if (cents <= 0) return true;
      try {
        for (const s of splitDividendByShares(cents, shareSeeds)) {
          target.set(s.id, s.payoutCents);
        }
        return true;
      } catch {
        return false; // no shares — leave payouts empty; table shows ownership %
      }
    };

    // ---- Profit leg (Profit, Both, and settle runs).
    if (effectiveType !== "Loss") {
      // Settle: the leg is the ENTIRE remaining balance, not user input.
      const profitStr = isSettle ? currentBalance.toFixed(2) : amount;
      let profitCents = 0;
      if (profitStr.trim()) {
        try {
          profitCents = toCents(profitStr);
        } catch {
          return res; // invalid amount — no preview
        }
      }
      if (!Number.isFinite(profitCents) || profitCents < 0) return res;
      res.profitTotalCents = profitCents;
      res.totalCents = profitCents;
      if (profitCents > 0) {
        if (!showFunds || fundPicks.length === 0) {
          // No funds: members take the whole profit leg, as before.
          res.membersTotalCents = profitCents;
          splitToMembers(profitCents, res.memberPayouts);
        } else {
          // Parse every fund percent into basis points.
          const entries: Array<{ id: string; bp: number }> = [];
          for (const p of fundPicks) {
            if (!p.percent.trim()) {
              res.error = t("projects.returns.fundPercentRequired", { defaultValue: "Enter a percent (0.01 – 100) for each selected fund." });
              return res;
            }
            let bp: number;
            try {
              bp = parsePercentBp(p.percent);
            } catch (e) {
              res.error = e instanceof Error && e.message ? e.message : t("projects.returns.fundPercentRequired", { defaultValue: "Enter a percent (0.01 – 100) for each selected fund." });
              return res;
            }
            entries.push({ id: p.fundId, bp });
          }
          const sumBp = entries.reduce((acc, e) => acc + e.bp, 0);
          res.sumBp = sumBp;
          if (sumBp > 10_000) {
            res.error = t("projects.returns.fundPercentSumExceeded", { defaultValue: "Fund percentages must not exceed 100% in total." });
            return res;
          }

          try {
            const split = splitByPercent(profitCents, entries);
            for (const s of split) res.fundPayouts.set(s.id, s.payoutCents);
            res.fundsTotalCents = split.reduce((acc, s) => acc + s.payoutCents, 0);
          } catch (e) {
            res.error = e instanceof Error && e.message ? e.message : "Cannot split the distribution across funds.";
            return res;
          }
          res.membersTotalCents = profitCents - res.fundsTotalCents;

          if (res.membersTotalCents > 0) {
            if (!splitToMembers(res.membersTotalCents, res.memberPayouts)) {
              res.error = t("projects.returns.noSharesForMemberPortion", {
                defaultValue: "The remaining percentage cannot be split — this project has no shareholders with shares. Give the remainder to funds (up to 100%).",
              });
            }
          }
        }
      }
    }

    // ---- Loss leg (custom Loss and Both runs only — a settle never has one;
    //      the project's losses already depleted the balance being paid out).
    if (!isSettle && type !== "Profit") {
      const lossStr = type === "Both" ? lossAmount : amount;
      let lossCents = 0;
      if (lossStr.trim()) {
        try {
          lossCents = toCents(lossStr);
        } catch {
          lossCents = 0; // invalid — no preview
        }
      }
      if (Number.isFinite(lossCents) && lossCents > 0) {
        res.lossTotalCents = lossCents;
        res.totalCents += lossCents;
        splitToMembers(lossCents, res.lossMemberPayouts);
      }
    }
    return res;
  }, [amount, lossAmount, type, fundPicks, shareholders, showFunds, t, isSettle, currentBalance, effectiveType]);

  // Fund/member percents are relative to the PROFIT leg (in a Both run the
  // loss leg is settled separately and must not skew them).
  const fundsPctDisplay = preview.profitTotalCents > 0 ? (preview.sumBp / 100).toFixed(2) : "0.00";
  const membersPctDisplay =
    preview.profitTotalCents > 0 ? ((preview.membersTotalCents / preview.profitTotalCents) * 100).toFixed(2) : "0.00";
  // Both legs draw from the project fund, so the strip shows the net position.
  const balanceAfter = currentBalance - (preview.totalCents / 100);

  const addFund = () => {
    if (!pickerValue) return;
    setFundPicks((prev) => [...prev, { fundId: pickerValue, percent: "" }]);
    setPickerValue(null);
    setErrorMessage(null);
  };

  const removeFund = (fundId: string) => {
    setFundPicks((prev) => prev.filter((p) => p.fundId !== fundId));
    setErrorMessage(null);
  };

  const setFundPercent = (fundId: string, percent: string) => {
    setFundPicks((prev) => prev.map((p) => (p.fundId === fundId ? { ...p, percent } : p)));
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!activeProject) {
      setErrorMessage(t("projects.returns.selectProjectRequired", {
        defaultValue: "Select a project to distribute its returns.",
      }));
      return;
    }

    // An already-settled project is an immutable record — nothing to run.
    if (projectLocked) {
      setErrorMessage(t("projects.returns.lockedNotice", {
        defaultValue: "This project is completed and permanently locked — returns can no longer be distributed.",
      }));
      return;
    }

    // Custom runs validate their own numbers; a settle run's amount is
    // computed server-side from the locked balance (the entire remainder).
    if (!isSettle) {
      if (numAmount <= 0) {
        setErrorMessage(t("finance.validation.amountGreaterThanZero", { defaultValue: "Amount must be greater than zero." }));
        return;
      }

      // Both: the loss leg must be entered too (single Loss already covers
      // the loss through `amount`).
      if (isBoth && numLoss <= 0) {
        setErrorMessage(t("finance.validation.amountGreaterThanZero", { defaultValue: "Amount must be greater than zero." }));
        return;
      }

      // The profit leg (Profit and Both runs) can never exceed the available
      // project fund balance. The loss leg may exceed remaining equity — the
      // server caps each member's debit at their recorded equity — so it is
      // shown in the balance strip (red when negative) rather than blocked.
      if (type !== "Loss" && numAmount > currentBalance) {
        setErrorMessage(
          t("projects.validation.insufficientBalanceForPayout", {
            defaultValue: "Distribution amount ({amount}) exceeds available project fund balance ({balance}).",
            amount: fm(numAmount),
            balance: fm(currentBalance),
          })
        );
        return;
      }
    }

    // Fund allocations (profit leg): percents must be complete and <= 100%.
    if (showFunds && fundPicks.length > 0) {
      if (preview.error) {
        setErrorMessage(preview.error);
        return;
      }
    } else if (showFunds && fundPicks.length === 0) {
      // No funds selected — members-only distribution, as before. A settle
      // run with no funds needs shareholders to receive the balance.
      if (shareholders.length === 0 || totalShares <= 0) {
        setErrorMessage(t("projects.validation.noShareholdersForReturn", { defaultValue: "No shareholders found for distribution." }));
        return;
      }
    }

    const payload: DistributeReturnsPayload = isSettle
      ? {
          // The server computes the leg from the locked balance and closes
          // the project — no type/amount crosses the wire.
          settleProject: true,
          description: description.trim(),
          referenceNumber: idempotencyRef,
          projectId: activeProject.id,
        }
      : {
          type,
          amount: numAmount,
          description: description.trim(),
          referenceNumber: idempotencyRef,
          projectId: activeProject.id,
        };
    if (!isSettle && isBoth) payload.lossAmount = numLoss;
    if (showFunds && fundPicks.length > 0) {
      payload.fundAllocations = fundPicks.map((p) => ({
        fundId: p.fundId,
        percent: parseFloat(p.percent),
      }));
    }

    try {
      setIsSubmitting(true);
      await onSubmit(payload);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || t("projects.validation.failedDistribute", { defaultValue: "Failed to distribute returns." }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("projects.returns.modalTitle", { defaultValue: "Distribute Project Returns" })}
      description={
        activeProject
          ? `${activeProject.title} • Available Balance: ${fm(currentBalance)}`
          : t("projects.returns.selectProjectHint", {
              defaultValue: "Select the project whose returns you want to distribute",
            })
      }
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {projectLocked && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs rounded-xl flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              {t("projects.returns.lockedNotice", {
                defaultValue: "This project is completed and permanently locked — returns can no longer be distributed.",
              })}
            </span>
          </div>
        )}

        {!activeProject && (
          <ERPFormSection title={t("projects.returns.projectSection", { defaultValue: "Project" })}>
            <p className="text-[11px] text-muted-foreground mb-3">
              {t("projects.returns.projectHint", {
                defaultValue:
                  "Choose the project whose returns you want to distribute. The balance, fund and shareholder previews load with it.",
              })}
            </p>
            {projectOptions.length === 0 ? (
              <div className="p-4 border border-dashed border-border/80 rounded-xl text-center text-xs text-muted-foreground">
                {t("projects.returns.noProjectsAvailable", {
                  defaultValue: "No projects available in this organization.",
                })}
              </div>
            ) : (
              <AppDropdown
                options={projectOptions}
                value={projectPickerId}
                onChange={handleProjectPick}
                placeholder={t("projects.returns.selectProject", { defaultValue: "Select a project..." })}
                disabled={loadingProject}
              />
            )}
          </ERPFormSection>
        )}

        {activeProject && (
        <>
        <ERPFormSection title={t("projects.returns.type", { defaultValue: "Distribution Parameters" })}>
          {/* Distribution Mode: custom amounts vs. settle the entire project. */}
          <ERPFormField label={t("projects.returns.mode", { defaultValue: "Distribution Mode *" })}>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "custom", label: t("projects.returns.modeCustom", { defaultValue: "Custom Amount" }) },
                  { id: "settle", label: t("projects.returns.modeSettle", { defaultValue: "Distribute Complete Project" }) },
                ] as const
              ).map((opt) => {
                const active = mode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={projectLocked}
                    onClick={() => {
                      setMode(opt.id);
                      setErrorMessage(null);
                    }}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-medium text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/80 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </ERPFormField>

          {isSettle ? (
            <>
              {/* Settle & close: the amount is computed by the server from the
                  project's locked balance — shown read-only here. */}
              <ERPFormField
                label={t("projects.returns.settleAmountLabel", { defaultValue: "Distribution Amount (automatic)" })}
              >
                <div className="w-full px-3 py-2 text-xs font-mono bg-muted/40 border border-border/60 text-foreground rounded-xl flex items-center justify-between gap-2">
                  <span className="font-semibold">{fm(currentBalance)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("projects.returns.settleFullBalance", { defaultValue: "the entire remaining balance" })}
                  </span>
                </div>
              </ERPFormField>
              {currentBalance <= 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {t("projects.returns.settleZeroNote", {
                    defaultValue: "The project has no remaining balance — executing will only mark it Completed and lock it.",
                  })}
                </p>
              )}
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs rounded-xl flex items-start gap-2">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {t("projects.returns.settleWarning", {
                    defaultValue:
                      "This distributes the entire remaining balance, marks the project as Completed, and permanently locks it — no further edits, postings, or distributions will be possible.",
                  })}
                </span>
              </div>
            </>
          ) : (
            <ERPFormGrid cols={2}>
              <ERPFormField label={t("projects.returns.type", { defaultValue: "Distribution Type *" })}>
                <AppDropdown
                  options={typeOptions}
                  value={type}
                  onChange={(val) => setType((val as "Profit" | "Loss" | "Both") || "Profit")}
                  placeholder={t("projects.returns.selectType", { defaultValue: "Select type..." })}
                />
              </ERPFormField>

              <ERPFormField
                label={
                  isBoth
                    ? t("projects.returns.profitAmount", { defaultValue: "Profit Amount *" })
                    : t("projects.returns.amount", { defaultValue: "Distribution Amount *" })
                }
              >
                <NumericInput
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setErrorMessage(null);
                  }}
                  className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                />
              </ERPFormField>

              {isBoth && (
                <ERPFormField label={t("projects.returns.lossAmount", { defaultValue: "Loss Amount *" })}>
                  <NumericInput
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={lossAmount}
                    onChange={(e) => {
                      setLossAmount(e.target.value);
                      setErrorMessage(null);
                    }}
                    className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                  />
                </ERPFormField>
              )}
            </ERPFormGrid>
          )}

          <ERPFormField label={t("projects.returns.description", { defaultValue: "Distribution Reason / Notes *" })}>
            <textarea
              rows={2}
              placeholder={t("projects.returns.descPlaceholder", { defaultValue: "e.g. Q3 Commercial rental yield distribution..." })}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
            />
          </ERPFormField>
        </ERPFormSection>

        {/* Fund Allocation — Profit only: funds take their percents first,
            shareholders split the remaining percentage pro-rata by shares. */}
        {showFunds && (
          <ERPFormSection
            title={
              isBoth
                ? t("projects.returns.fundsSectionProfitLeg", { defaultValue: "Distribute to Funds (Profit Leg)" })
                : t("projects.returns.fundsSection", { defaultValue: "Distribute to Funds (Profit Only)" })
            }
          >
            <p className="text-[11px] text-muted-foreground mb-3">
              {t("projects.returns.fundsHint", {
                defaultValue:
                  "Each selected fund receives a percentage of the distribution; shareholders split the remaining percentage pro-rata by their project share ownership.",
              })}
            </p>

            <div className="flex items-end gap-2 mb-3">
              <div className="flex-1">
                <AppDropdown
                  options={fundOptions}
                  value={pickerValue}
                  onChange={(val) => setPickerValue(val)}
                  placeholder={t("projects.returns.selectFund", { defaultValue: "Select a fund to allocate..." })}
                  disabled={fundOptions.length === 0}
                  disabledHint={
                    fundOptions.length === 0
                      ? t("projects.returns.noFundsAvailable", { defaultValue: "No funds available to add" })
                      : undefined
                  }
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                type="button"
                icon={Plus}
                onClick={addFund}
                disabled={!pickerValue}
              >
                {t("projects.returns.addFund", { defaultValue: "Add Fund" })}
              </Button>
            </div>

            {fundPicks.length > 0 && (
              <div className="border border-border/80 rounded-xl overflow-hidden mb-3">
                <div className="overflow-x-auto max-h-56">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="px-3 py-2">{t("projects.returns.fundLabel", { defaultValue: "Fund" })}</th>
                        <th className="px-3 py-2 text-right">{t("projects.returns.fundBalance", { defaultValue: "Current Balance" })}</th>
                        <th className="px-3 py-2 text-center w-28">{t("projects.returns.percentLabel", { defaultValue: "Percent % *" })}</th>
                        <th className="px-3 py-2 text-right">{t("projects.returns.allocated", { defaultValue: "Allocated" })}</th>
                        <th className="px-2 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {fundPicks.map((p) => {
                        const fund = funds.find((f) => f.id === p.fundId);
                        const payoutCents = preview.fundPayouts.get(p.fundId) ?? 0;
                        return (
                          <tr key={p.fundId} className="hover:bg-muted/20">
                            <td className="px-3 py-2 text-foreground font-medium">
                              <span className="flex items-center gap-1.5">
                                <Landmark className="w-3.5 h-3.5 text-primary shrink-0" />
                                {fund?.name ?? p.fundId}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                              {fund ? fm(fund.balance) : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-1">
                                <NumericInput
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  max="100"
                                  placeholder="0.00"
                                  value={p.percent}
                                  onChange={(e) => setFundPercent(p.fundId, e.target.value)}
                                  className="w-20 px-2 py-1.5 text-xs font-mono text-center bg-card border border-border/80 text-foreground rounded-lg placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                                />
                                <span className="text-muted-foreground text-[10px]">%</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                              +{fm(payoutCents / 100)}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeFund(p.fundId)}
                                className="p-1 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                aria-label={t("projects.returns.removeFund", { defaultValue: "Remove fund" })}
                                title={t("projects.returns.removeFund", { defaultValue: "Remove fund" })}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Live remaining-balance strip: updates with every selection/input.
                Gated on the profit leg — in a Both run the loss leg alone
                (funds unentered profit) must not render a zero-percent strip. */}
            {preview.profitTotalCents > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/20">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {t("projects.returns.toFunds", { defaultValue: "To Funds" })}
                  </p>
                  <p className="text-xs font-mono font-semibold text-foreground">
                    {fundsPctDisplay}%
                    <span className="text-muted-foreground font-normal"> · {fm(preview.fundsTotalCents / 100)}</span>
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-semibold">
                    {t("projects.returns.toMembers", { defaultValue: "To Members (pro-rata by shares)" })}
                  </p>
                  <p className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {membersPctDisplay}%
                    <span className="opacity-70"> · {fm(preview.membersTotalCents / 100)}</span>
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-muted/40 border border-border/80">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {t("projects.returns.balanceAfter", { defaultValue: "Project Balance After" })}
                  </p>
                  <p className={`text-xs font-mono font-semibold ${balanceAfter < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
                    {fm(balanceAfter)}
                  </p>
                </div>
              </div>
            )}
            {preview.error && (
              <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {preview.error}
              </p>
            )}
          </ERPFormSection>
        )}

        {/* Live Pro-Rata Shareholder Payout Preview (members' remaining block) */}
        <ERPFormSection
          title={
            showFunds && fundPicks.length > 0
              ? t("projects.returns.memberPreviewWithFunds", { defaultValue: "Shareholder Payout Preview (Remaining Portion)" })
              : t("projects.returns.preview", { defaultValue: "Pro-Rata Shareholder Payout Preview" })
          }
        >
          {shareholders.length === 0 ? (
            <div className="p-4 border border-dashed border-border/80 rounded-xl text-center text-xs text-muted-foreground">
              {t("projects.shareholders.noShareholders", { defaultValue: "No shareholders registered." })}
            </div>
          ) : (
            <div className="border border-border/80 rounded-xl overflow-hidden">
              <div className="overflow-x-auto max-h-56">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-3 py-2">{t("projects.memberLabel", { defaultValue: "Member" })}</th>
                      <th className="px-3 py-2 text-center">{t("projects.sharesLabel", { defaultValue: "Shares" })}</th>
                      <th className="px-3 py-2 text-center">{t("projects.shareholders.ownership", { defaultValue: "Ownership %" })}</th>
                      {isBoth ? (
                        <>
                          <th className="px-3 py-2 text-right">{t("projects.returns.profitShare", { defaultValue: "Profit Share" })}</th>
                          <th className="px-3 py-2 text-right">{t("projects.returns.lossShare", { defaultValue: "Loss Share" })}</th>
                        </>
                      ) : (
                        <th className="px-3 py-2 text-right">{t("projects.returns.portion", { defaultValue: "Calculated Share" })}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {shareholders.map((sh, idx) => {
                      const shares = Number(sh.sharesInvested || 0);
                      const memberPct = totalShares > 0 ? shares / totalShares : 0;
                      const profitShare = (preview.memberPayouts.get(sh.memberId) ?? 0) / 100;
                      const lossShare = (preview.lossMemberPayouts.get(sh.memberId) ?? 0) / 100;

                      return (
                        <tr key={sh.memberId || idx} className="hover:bg-muted/20">
                          <td className="px-3 py-2 text-foreground font-medium">
                            {sh.memberName}
                            {sh.memberCode && (
                              <span className="text-[10px] text-muted-foreground block font-mono">
                                {sh.memberCode}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center font-mono">{shares}</td>
                          <td className="px-3 py-2 text-center font-mono">
                            {(memberPct * 100).toFixed(1)}%
                          </td>
                          {isBoth ? (
                            <>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                +{fm(profitShare)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                                -{fm(lossShare)}
                              </td>
                            </>
                          ) : (
                            <td className="px-3 py-2 text-right font-mono font-semibold">
                              <span
                                className={
                                  effectiveType === "Profit"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400"
                                }
                              >
                                {effectiveType === "Profit" ? "+" : "-"}
                                {fm(effectiveType === "Profit" ? profitShare : lossShare)}
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {effectiveType !== "Profit" && shareholders.length > 0 && (
            <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0" />
              {t("projects.returns.equityCapNote", {
                defaultValue: "Loss allocation is capped at each member's recorded equity at execution.",
              })}
            </p>
          )}
        </ERPFormSection>
        </>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-border">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            loading={isSubmitting || loadingProject}
            disabled={!activeProject || loadingProject || projectLocked}
            icon={isSettle ? Lock : type === "Profit" ? ArrowUpRight : type === "Loss" ? ArrowDownLeft : ArrowLeftRight}
          >
            {isSettle
              ? t("projects.returns.executeSettle", { defaultValue: "Settle & Close Project" })
              : t("projects.returns.execute", { defaultValue: "Execute Distribution" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
