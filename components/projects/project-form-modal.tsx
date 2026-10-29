"use client";

import React, { useState, useEffect } from "react";
import {
  TopSheet,
  ERPFormLayout,
  ERPFormSection,
  ERPFormGrid,
  ERPFormField,
  AppDropdown,
  DropdownOption,
  Button,
  ERPDatePicker,
  StatusBadge,
} from "@/components/ui";
import { NumericInput } from "@/components/ui/numeric-input";
import { Plus, Trash2, AlertCircle, Info, Landmark, Layers, Lock } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency, useTenantDateFormat } from "@/lib/use-tenant-settings";
import { memberDisplayName } from "@/lib/member-display";
import { Project, Member } from "@/types";
import { formatMoney } from "@/lib/formatters";
import { intlLocaleFor } from "./project-labels";

interface ShareholderInputRow {
  memberId: string;
  shares: number;
  sourceFundId: string;
}

interface ProjectFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (projectData: any) => Promise<void>;
  funds: Array<{ id: string; name: string; balance: number; type?: string; minimumBalance?: number }>;
  members?: Member[];
  tenantShareValue?: number;
  initialData?: Project | null;
}

export function ProjectFormModal({
  isOpen,
  onClose,
  onSubmit,
  funds,
  members = [],
  tenantShareValue = 1000,
  initialData,
}: ProjectFormModalProps) {
  const { t, locale } = useLocale();
  // Money on this screen is the tenant's money, so it carries the tenant's currency.
  const tenantCurrency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const fm = (n: number | string | null | undefined) => formatMoney(n, tenantCurrency, { locale: intlLocaleFor(locale) });

  // Basic Information
  const [title, setTitle] = useState(initialData?.title || "");
  const [category, setCategory] = useState(initialData?.category || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [status, setStatus] = useState<string>(initialData?.status || "In Progress");
  // #109: project manager selection. Persisted as projectFundHandler (the
  // existing varchar column the detail view renders as "Handler: …"); the
  // dropdown carries the member id, submit maps it back to the member's name.
  const [projectManagerId, setProjectManagerId] = useState<string | null>(null);

  // Financials & ROI
  const [budget, setBudget] = useState(initialData?.budget ? String(initialData.budget) : "");
  const [expectedRoi, setExpectedRoi] = useState(
    initialData?.expectedRoi !== undefined ? String(initialData.expectedRoi) : ""
  );

  // Fund Strategy: link existing vs create dedicated
  const [fundStrategy, setFundStrategy] = useState<"linkExisting" | "createNew">(
    initialData?.linkedFundId ? "linkExisting" : "linkExisting"
  );
  const [selectedFundId, setSelectedFundId] = useState<string | null>(initialData?.linkedFundId || null);
  const [newFundName, setNewFundName] = useState("");

  // Timeline & Dates
  const [startDate, setStartDate] = useState(initialData?.startDate || "");
  const [completionDate, setCompletionDate] = useState(initialData?.completionDate || "");

  // Shareholders & Equity Allocation (Option A) — the same editor on create and
  // edit. On edit it is prefilled from the ledger, and locked once the project
  // has earnings or expenses (their capital structure is history).
  const [shareholders, setShareholders] = useState<ShareholderInputRow[]>([]);
  const capitalLocked = Boolean(initialData?.capitalLocked);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset form when modal opens with initialData
  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || "");
      setCategory(initialData.category || "");
      setDescription(initialData.description || "");
      setBudget(initialData.budget ? String(initialData.budget) : "");
      setExpectedRoi(initialData.expectedRoi !== undefined ? String(initialData.expectedRoi) : "");
      setStartDate(initialData.startDate || "");
      setCompletionDate(initialData.completionDate || "");
      setSelectedFundId(initialData.linkedFundId || null);
      setStatus(initialData.status || "In Progress");
      setFundStrategy("linkExisting");
      setShareholders(
        (initialData.involvedMembers || []).map((p) => ({
          memberId: p.memberId,
          shares: Number(p.sharesInvested || 0),
          sourceFundId: p.sourceFundId || "",
        })),
      );
      setProjectManagerId(
        initialData.projectFundHandler
          ? members.find((m) => m.name === initialData.projectFundHandler)?.id ?? null
          : null
      );
    } else {
      setTitle("");
      setCategory("");
      setDescription("");
      setBudget("");
      setExpectedRoi("");
      setStartDate("");
      setCompletionDate("");
      setSelectedFundId(null);
      setNewFundName("");
      setStatus("In Progress");
      setFundStrategy("linkExisting");
      setShareholders([]);
      setProjectManagerId(null);
    }
    setErrorMessage(null);
  }, [initialData, isOpen]);

  const fundOptions: DropdownOption[] = funds.map((f) => ({
    value: f.id,
    label: `${f.name} (Bal: ${fm(f.balance)})`,
  }));

  const memberOptions: DropdownOption[] = members.map((m) => {
    const depositBal = Number(m.totalContributed || 0);
    return {
      value: m.id,
      label: `${memberDisplayName(m.name, m.status)} (${m.memberId}) — Bal: ${fm(depositBal)}`,
      // Suspended members cannot be assigned to new work; the current manager
      // of the edited project stays selectable so the field never blanks
      // (manager persists as the member's name in projectFundHandler).
      disabled: m.status === "suspended" && m.name !== initialData?.projectFundHandler,
    };
  });

  // Invested capital has to leave a real deposit fund, so project funds are not
  // offered as a source (a project cannot fund itself out of its own balance).
  // The destination fund is excluded too: drawing from it would credit the
  // project fund with no matching debit, which the server rejects. Funds with
  // no spendable cash (balance already at or below their minimum reserve) are
  // not offered at all — they cannot fund an investment.
  const sourceFundOptions: DropdownOption[] = funds
    .filter((f) => (f.type || '').toUpperCase() !== 'PROJECT')
    .filter((f) => !(fundStrategy === 'linkExisting' && f.id === selectedFundId))
    .filter((f) => Number(f.balance || 0) - Number(f.minimumBalance || 0) > 0)
    .map((f) => ({ value: f.id, label: `${f.name} (Bal: ${fm(f.balance)})` }));

  // A prefilled allocation must stay visible even if that fund no longer
  // qualifies as a source (drained balance, retype), otherwise an edit would
  // show an empty fund for money that is really there.
  const sourceOptionsForRow = (selected: string): DropdownOption[] => {
    if (!selected || sourceFundOptions.some((o) => o.value === selected)) return sourceFundOptions;
    const fund = funds.find((f) => f.id === selected);
    return [
      ...sourceFundOptions,
      { value: selected, label: fund ? `${fund.name} (Bal: ${fm(fund.balance)})` : selected },
    ];
  };

  const categoryOptions: DropdownOption[] = [
    { value: "Real Estate", label: t("projects.sectors.realEstate", { defaultValue: "Real Estate" }) },
    { value: "Agriculture", label: t("projects.sectors.agriculture", { defaultValue: "Agriculture" }) },
    { value: "Technology", label: t("projects.sectors.technology", { defaultValue: "Technology" }) },
    { value: "Retail", label: t("projects.sectors.retail", { defaultValue: "Retail" }) },
    { value: "Manufacturing", label: t("projects.sectors.manufacturing", { defaultValue: "Manufacturing" }) },
    { value: "Other", label: t("projects.sectors.other", { defaultValue: "Other" }) },
  ];

  const statusOptions: DropdownOption[] = [
    { value: "In Progress", label: t("projects.statuses.inProgress", { defaultValue: "In Progress" }) },
    { value: "Review", label: t("projects.statuses.review", { defaultValue: "Review" }) },
    { value: "Completed", label: t("projects.statuses.completed", { defaultValue: "Completed" }) },
  ];

  // Helper calculations for shareholders
  const totalShares = shareholders.reduce((acc, s) => acc + (Number(s.shares) || 0), 0);
  const totalShareholderCapital = totalShares * tenantShareValue;
  // Total Budget is the ceiling on capital raised — the server rejects an
  // over-subscription, so flag it live instead of letting the submit fail.
  const numBudgetInput = parseFloat(budget) || 0;
  const overBudget = !capitalLocked && totalShareholderCapital > numBudgetInput;

  // On edit the server refunds this project's existing allocation before
  // re-investing, so a member's headroom is their live equity PLUS what this
  // project already holds from them. Comparing against raw equity alone makes
  // an unchanged row look permanently under-funded.
  const committedByMember = new Map<string, number>();
  const committedByFund = new Map<string, number>();
  for (const p of initialData?.involvedMembers || []) {
    const invested = Number(p.totalInvested || 0);
    if (!invested) continue;
    committedByMember.set(p.memberId, (committedByMember.get(p.memberId) ?? 0) + invested);
    if (p.sourceFundId) {
      committedByFund.set(p.sourceFundId, (committedByFund.get(p.sourceFundId) ?? 0) + invested);
    }
  }

  // Shareholder picker shows the amount the member can actually invest here —
  // live equity plus this project's existing holdback — not raw equity, which
  // an edit has already deducted.
  const shareholderMemberOptions: DropdownOption[] = members.map((m) => ({
    value: m.id,
    label: `${memberDisplayName(m.name, m.status)} (${m.memberId}) — Bal: ${fm(Number(m.totalContributed || 0) + (committedByMember.get(m.id) ?? 0))}`,
    // Suspended members cannot (re-)invest in a project — the server rejects
    // it; the UI says so up front. An existing allocation on the edited
    // project stays selectable so its row is never blanked.
    disabled: m.status === "suspended" && !initialData?.involvedMembers?.some((p) => p.memberId === m.id),
  }));

  const handleAddShareholder = () => {
    setShareholders((prev) => [...prev, { memberId: "", shares: 1, sourceFundId: "" }]);
  };

  const handleRemoveShareholder = (index: number) => {
    setShareholders((prev) => prev.filter((_, i) => i !== index));
  };

  const handleShareholderChange = (index: number, field: "memberId" | "shares" | "sourceFundId", value: any) => {
    setShareholders((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (field === "memberId") {
          return { ...row, memberId: String(value || "") };
        }
        if (field === "sourceFundId") {
          // §5: changing the parent (source fund) resets the dependent member,
          // because the chosen member's deposit may not live in this fund.
          return { ...row, sourceFundId: String(value || ""), memberId: "" };
        }
        return { ...row, shares: Number(value) || 1 };
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage(t("projects.validation.titleRequired", { defaultValue: "Project title is required." }));
      return;
    }
    if (!category) {
      setErrorMessage(t("projects.validation.categoryRequired", { defaultValue: "Category is required." }));
      return;
    }
    if (!startDate) {
      setErrorMessage(t("projects.validation.startDateRequired", { defaultValue: "Start date is required." }));
      return;
    }

    const numBudget = parseFloat(budget);
    if (isNaN(numBudget) || numBudget < 0) {
      setErrorMessage(t("projects.validation.validBudget", { defaultValue: "Valid budget is required." }));
      return;
    }

    if (fundStrategy === "createNew" && !newFundName.trim() && !title.trim()) {
      setErrorMessage(t("projects.validation.fundNameRequired", { defaultValue: "Dedicated fund name is required." }));
      return;
    }

    // Validate shareholders
    const validShareholders: Array<{ memberId: string; shares: number; sourceFundId: string }> = [];
    const seenIds = new Set<string>();
    const drawBySourceFund = new Map<string, number>();

    for (const sh of shareholders) {
      if (!sh.memberId) continue;
      // While locked the rows are display-only, so their balances and (for
      // allocations pred migration 0015) possibly unknown source funds are not
      // re-validated — nothing about them can change.
      if (!sh.sourceFundId && !capitalLocked) {
        setErrorMessage(
          t("projects.shareholders.sourceFundRequired", {
            defaultValue: "Select the deposit fund each shareholder's capital is drawn from.",
          }),
        );
        return;
      }
      if (seenIds.has(sh.memberId)) {
        setErrorMessage(t("projects.validation.duplicateShareholder", { defaultValue: "Each member can only be added once as a shareholder." }));
        return;
      }
      seenIds.add(sh.memberId);

      const shares = Number(sh.shares);
      if (isNaN(shares) || shares < 1) {
        setErrorMessage(t("projects.validation.invalidShares", { defaultValue: "Shares must be at least 1." }));
        return;
      }

      // Locked rows pass through untouched — no balance math to re-validate.
      if (capitalLocked) {
        validShareholders.push({ memberId: sh.memberId, shares, sourceFundId: sh.sourceFundId });
        continue;
      }

      // Check deposit balance — headroom counts what this project already holds
      // from the member, because the edit refunds it before re-investing.
      const member = members.find((m) => m.id === sh.memberId);
      const memberBalance =
        Number(member?.totalContributed || 0) + (committedByMember.get(sh.memberId) ?? 0);
      const requiredCapital = shares * tenantShareValue;

      if (memberBalance < requiredCapital) {
        setErrorMessage(
          `${member?.name || "Member"} has insufficient deposit balance (Available: ${fm(memberBalance)}, Required: ${fm(requiredCapital)})`
        );
        return;
      }

      // Cash side: the chosen fund must still hold the capital after every
      // draw assigned to it, keeping its minimum reserve.
      const sourceFund = funds.find((f) => f.id === sh.sourceFundId);
      if (!sourceFund) {
        setErrorMessage(t("projects.shareholders.sourceFundRequired", { defaultValue: "Select the deposit fund each shareholder's capital is drawn from." }));
        return;
      }
      const alreadyDrawnCents = Math.round((drawBySourceFund.get(sourceFund.id) ?? 0) * 100);
      const requiredCents = Math.round(requiredCapital * 100);
      // Same refund-before-reinvest logic on the cash side.
      const fundHeadroomCents = Math.round(
        (Number(sourceFund.balance) + (committedByFund.get(sourceFund.id) ?? 0)) * 100,
      );
      const availableCents = fundHeadroomCents - alreadyDrawnCents;
      const reserveCents = Math.round((sourceFund.minimumBalance ?? 0) * 100);
      if (!capitalLocked && availableCents - requiredCents < reserveCents) {
        setErrorMessage(
          `${sourceFund.name} has insufficient balance for this investment (Available: ${fm(availableCents / 100)}, Required: ${fm(requiredCents / 100)})`
        );
        return;
      }
      drawBySourceFund.set(sourceFund.id, (drawBySourceFund.get(sourceFund.id) ?? 0) + requiredCapital);

      validShareholders.push({ memberId: sh.memberId, shares, sourceFundId: sh.sourceFundId });
    }

    // Hard gate mirroring the server: subscribed capital may never exceed the
    // declared budget.
    const submittedCapitalCents = validShareholders.reduce(
      (acc, s) => acc + Math.round(s.shares * tenantShareValue * 100),
      0,
    );
    if (!capitalLocked && submittedCapitalCents > Math.round(numBudget * 100)) {
      setErrorMessage(
        t("projects.validation.capitalExceedsBudget", {
          invested: fm(submittedCapitalCents / 100),
          budget: fm(numBudget),
          defaultValue: `Total shareholder investment (${fm(submittedCapitalCents / 100)}) cannot exceed the project budget (${fm(numBudget)}).`,
        }),
      );
      return;
    }

    try {
      setIsSubmitting(true);
      const managerMember = members.find((m) => m.id === projectManagerId);
      await onSubmit({
        title: title.trim(),
        category,
        description: description.trim(),
        budget: numBudget,
        // initialInvestment is never sent: both create and edit derive it from
        // the capital actually drawn from shareholder deposits (§12).
        expectedRoi: parseFloat(expectedRoi) || 0,
        startDate,
        completionDate: completionDate || undefined,
        linkedFundId: fundStrategy === "linkExisting" ? (selectedFundId || undefined) : undefined,
        // A dedicated fund can only be minted at creation; an edit re-links.
        createNewFund: !initialData && fundStrategy === "createNew",
        newFundName: !initialData && fundStrategy === "createNew" ? (newFundName.trim() || `${title.trim()} Fund`) : undefined,
        status,
        // Prefilled on edit. PUT compares it against the ledger: identical means
        // no money moves, different means the allocation is refunded and
        // re-invested. While locked it is not sent at all — nothing may change.
        shareholders: capitalLocked ? undefined : validShareholders,
        projectFundHandler: managerMember?.name || undefined,
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || t("common.errors.failedToCreateProject", { defaultValue: "Failed to save project" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? t("projects.editProject", { defaultValue: "Edit Project" }) : t("projects.newProject", { defaultValue: "New Project Master" })}
      description={t("projects.formDescription", { defaultValue: "Define project capital requirements, linked fund, and shareholder equity allocations." })}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Section 1: General Details */}
        <ERPFormSection title={t("projects.basicDetails", { defaultValue: "General Information" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("projects.title", { defaultValue: "Project Title *" })}>
              <input
                type="text"
                placeholder={t("projects.titlePlaceholder", { defaultValue: "e.g. Dhaka Commercial Plaza" })}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("projects.category", { defaultValue: "Category *" })}>
              <AppDropdown
                options={categoryOptions}
                value={category}
                onChange={(val) => setCategory(val || "")}
                placeholder={t("projects.selectCategory", { defaultValue: "Select category..." })}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.projectManager", { defaultValue: "Project Manager" })}>
              <AppDropdown
                options={memberOptions}
                value={projectManagerId}
                onChange={(val) => setProjectManagerId(val || null)}
                placeholder={t("projects.projectManagerPlaceholder", { defaultValue: "Select member (optional)..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormField label={t("projects.description", { defaultValue: "Project Description" })}>
            <textarea
              rows={3}
              placeholder={t("projects.descriptionPlaceholder", { defaultValue: "Comprehensive project scope, objectives and deliverables..." })}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
            />
          </ERPFormField>
        </ERPFormSection>

        {/* Section 2: Financials & Budget */}
        <ERPFormSection title={t("projects.financials", { defaultValue: "Capital & ROI Projection" })}>
          <ERPFormGrid cols={3}>
            <ERPFormField label={t("projects.budget", { defaultValue: "Total Budget *" })}>
              <NumericInput
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("projects.initialInvestment", { defaultValue: "Initial Investment" })}>
              <div className="px-3 py-2 text-xs font-mono font-semibold text-foreground bg-muted/30 border border-border/60 rounded-xl">
                {fm(initialData ? Number(initialData.initialInvestment || 0) : totalShareholderCapital)}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {t("projects.initialInvestmentFromDeposits", {
                  defaultValue: "Auto-funded: drawn from shareholder deposit balances, never entered manually.",
                })}
              </p>
            </ERPFormField>

            <ERPFormField label={t("projects.expectedRoi", { defaultValue: "Expected ROI (%)" })}>
              <NumericInput
                type="number"
                step="0.1"
                min="0"
                placeholder="15.0"
                value={expectedRoi}
                onChange={(e) => setExpectedRoi(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        {/* Section 3: Fund Management (Link vs Create Dedicated) */}
        <ERPFormSection title={t("projects.fundStrategy", { defaultValue: "Fund Management" })}>
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-xs font-medium">
              <label className="flex items-center gap-2 cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="fundStrategy"
                  checked={fundStrategy === "linkExisting"}
                  onChange={() => setFundStrategy("linkExisting")}
                  className="text-primary focus:ring-primary h-3.5 w-3.5"
                />
                <span>{t("projects.funds.linkExisting", { defaultValue: "Link Existing Fund" })}</span>
              </label>

              {!initialData && (
                <label className="flex items-center gap-2 cursor-pointer text-foreground">
                  <input
                    type="radio"
                    name="fundStrategy"
                    checked={fundStrategy === "createNew"}
                    onChange={() => setFundStrategy("createNew")}
                    className="text-primary focus:ring-primary h-3.5 w-3.5"
                  />
                  <span>{t("projects.funds.createDedicated", { defaultValue: "Create New Dedicated Fund" })}</span>
                </label>
              )}
            </div>

            {fundStrategy === "linkExisting" ? (
              <ERPFormField label={t("projects.linkedFund", { defaultValue: "Source / Linked Fund" })}>
                <AppDropdown
                  options={fundOptions}
                  value={selectedFundId}
                  disabled={capitalLocked}
                  onChange={(val) => {
                    setSelectedFundId(val);
                    // §5: the destination can no longer be a source, so any row
                    // drawing from it is reset rather than left holding a value
                    // the server would reject.
                    if (val) {
                      setShareholders((prev) =>
                        prev.map((row) => (row.sourceFundId === val ? { ...row, sourceFundId: "", memberId: "" } : row)),
                      );
                    }
                  }}
                  placeholder={t("projects.selectFund", { defaultValue: "Select fund to link..." })}
                />
              </ERPFormField>
            ) : (
              <ERPFormField label={t("projects.funds.newFundName", { defaultValue: "Dedicated Fund Name *" })}>
                <div className="relative">
                  <input
                    type="text"
                    placeholder={title ? `${title} Fund` : t("projects.funds.newFundPlaceholder", { defaultValue: "e.g. Commercial Plaza Fund" })}
                    value={newFundName}
                    onChange={(e) => setNewFundName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                  />
                </div>
              </ERPFormField>
            )}
          </div>
        </ERPFormSection>

        {/* Section 4: Timeline & Dates */}
        <ERPFormSection title={t("projects.timeline", { defaultValue: "Timeline & Dates" })}>
          <ERPFormGrid cols={3}>
            <ERPFormField label={t("projects.startDate", { defaultValue: "Start Date *" })}>
              <ERPDatePicker
                value={startDate || null}
                onChange={(iso) => setStartDate(iso || "")}
                displayFormat={dateFormat}
                placeholder={t("projects.startDate", { defaultValue: "Start Date" })}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.completionDate", { defaultValue: "Estimated Completion Date" })}>
              <ERPDatePicker
                value={completionDate || null}
                onChange={(iso) => setCompletionDate(iso || "")}
                displayFormat={dateFormat}
                placeholder={t("projects.completionDate", { defaultValue: "Estimated Completion Date" })}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.status", { defaultValue: "Lifecycle Status" })}>
              <AppDropdown
                options={statusOptions}
                value={status}
                onChange={(val) => setStatus(val || "In Progress")}
                placeholder={t("projects.selectStatusPlaceholder", { defaultValue: "Select status..." })}
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        {/* Section 5: Project Shareholders & Equity Allocation (Option A).
            Same editor on create and edit; locked once the ledger has moved. */}
        {(
          <ERPFormSection title={t("projects.shareholders.title", { defaultValue: "Project Shareholders & Equity Ownership" })}>
            <div className="space-y-3">
              {capitalLocked && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium">
                    {t("projects.shareholders.capitalLockedNote", {
                      defaultValue: "Locked: this project already has earnings or expenses recorded, so its shareholders, shares and source funds can no longer be changed.",
                    })}
                  </span>
                </div>
              )}
              {/* Option A Policy Banner */}
              <div className="p-3 bg-muted/40 border border-border/80 rounded-xl flex items-start gap-2.5 text-xs text-muted-foreground">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    {t("projects.shareholders.tenantShareValue", {
                      value: fm(tenantShareValue),
                      defaultValue: `Tenant Share Value: ${fm(tenantShareValue)} per share`,
                    })}
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    {capitalLocked
                      ? t("projects.shareholders.optionALockedNote", {
                          defaultValue: "Recorded allocation. Changing it would strand the postings already made against this capital.",
                        })
                      : t("projects.shareholders.optionANote", {
                          defaultValue:
                            "Option A Active: On project creation, this capital will be deducted from each member's existing deposit account and transferred into the project fund.",
                        })}
                  </p>
                </div>
              </div>

              {/* Shareholder Rows */}
              {shareholders.length === 0 ? (
                <div className="p-4 border border-dashed border-border/80 rounded-xl text-center text-xs text-muted-foreground">
                  <p>{t("projects.shareholders.noShareholders", { defaultValue: "No shareholders assigned to this project yet." })}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("projects.shareholders.addMembersHint", {
                      defaultValue: "Add members to distribute project shares and auto-deduct required capital from their deposit balance.",
                    })}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {shareholders.map((row, index) => {
                    const selectedMember = members.find((m) => m.id === row.memberId);
                    const memberDeposit =
                      Number(selectedMember?.totalContributed || 0) + (committedByMember.get(row.memberId) ?? 0);
                    const requiredCapital = (row.shares || 0) * tenantShareValue;
                    const isInsufficient = selectedMember && memberDeposit < requiredCapital;
                    // A member already picked in another shareholder row cannot be
                    // chosen here again (duplicates are rejected on submit + server),
                    // but this row's own selection stays visible.
                    const takenElsewhere = new Set(
                      shareholders
                        .filter((_, i) => i !== index)
                        .map((s) => s.memberId)
                        .filter(Boolean),
                    );
                    const rowMemberOptions = shareholderMemberOptions.filter((o) => !takenElsewhere.has(o.value));

                    return (
                      <div
                        key={index}
                        className={`p-3 bg-card border rounded-xl space-y-2 transition-colors ${
                          isInsufficient ? "border-rose-300 dark:border-rose-900 bg-rose-50/20" : "border-border/80"
                        }`}
                      >
                        {/* Parent → child order (§5): the source fund is chosen
                            first, then the member whose capital is invested. */}
                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-6">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.shareholders.sourceFund", { defaultValue: "Source Deposit Fund" })}
                            </label>
                            <AppDropdown
                              options={sourceOptionsForRow(row.sourceFundId)}
                              value={row.sourceFundId || null}
                              onChange={(val) => handleShareholderChange(index, "sourceFundId", val || "")}
                              disabled={capitalLocked}
                              placeholder={t("projects.shareholders.selectSourceFund", { defaultValue: "Select fund to draw from..." })}
                            />
                          </div>

                          <div className="col-span-6">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.shareholderMember", { defaultValue: "Member" })}
                            </label>
                            <AppDropdown
                              options={rowMemberOptions}
                              value={row.memberId || null}
                              onChange={(val) => handleShareholderChange(index, "memberId", val || "")}
                              disabled={capitalLocked}
                              placeholder={t("projects.shareholders.selectMember", { defaultValue: "Select member..." })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.sharesLabel", { defaultValue: "Shares" })}
                            </label>
                            <NumericInput
                              type="number"
                              min="1"
                              step="1"
                              value={row.shares}
                              disabled={capitalLocked}
                              onChange={(e) =>
                                handleShareholderChange(index, "shares", Math.max(1, parseInt(e.target.value) || 1))
                              }
                              className="w-full px-2.5 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl outline-none focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>

                          <div className="col-span-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.shareholders.capital", { defaultValue: "Required Capital" })}
                            </label>
                            <div className="px-2.5 py-2 text-xs font-mono font-semibold text-foreground bg-muted/30 border border-border/60 rounded-xl">
                              {fm(requiredCapital)}
                            </div>
                          </div>

                          {!capitalLocked && (
                            <div className="col-span-6 flex justify-end pt-5">
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                icon={Trash2}
                                onClick={() => handleRemoveShareholder(index)}
                                className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 h-8 w-8 p-0"
                              />
                            </div>
                          )}
                        </div>

                        {/* Balance Warning / Status */}
                        {!capitalLocked && isInsufficient && (
                          <div className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium pt-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>
                              {t("projects.shareholders.insufficientDeposit", {
                                available: fm(memberDeposit),
                                defaultValue: `Insufficient deposit balance (Available: ${fm(memberDeposit)})`,
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                {!capitalLocked && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Plus}
                    type="button"
                    onClick={handleAddShareholder}
                  >
                    {t("projects.shareholders.add", { defaultValue: "Add Shareholder" })}
                  </Button>
                )}

                {shareholders.length > 0 && (
                  <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                    <span>
                      {t("projects.shareholders.totalProjectShares", { defaultValue: "Total Shares" })}:{" "}
                      <strong className="text-foreground">{totalShares}</strong>
                    </span>
                    <span>
                      {t("projects.shareholders.totalMemberCapital", { defaultValue: "Total Capital" })}:{" "}
                      <strong className="text-foreground">{fm(totalShareholderCapital)}</strong>
                    </span>
                  </div>
                )}
              </div>

              {overBudget && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2 text-[11px] text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                  <span className="font-medium">
                    {t("projects.validation.capitalExceedsBudget", {
                      invested: fm(totalShareholderCapital),
                      budget: fm(numBudgetInput),
                      defaultValue: `Total shareholder investment (${fm(totalShareholderCapital)}) cannot exceed the project budget (${fm(numBudgetInput)}).`,
                    })}
                  </span>
                </div>
              )}
            </div>
          </ERPFormSection>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-border">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            {initialData ? t("common.saveChanges", { defaultValue: "Save Changes" }) : t("projects.createButton", { defaultValue: "Create Project" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
