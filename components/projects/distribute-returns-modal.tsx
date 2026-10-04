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
  StatusBadge,
} from "@/components/ui";
import { useLocale } from "@/lib/i18n";
import { Project, ProjectMemberParticipation } from "@/types";
import { formatMoney } from "@/lib/formatters";
import { newIdempotencyRef } from "@/lib/idempotency";
import { DollarSign, AlertCircle, ArrowUpRight, ArrowDownLeft, Users } from "lucide-react";

interface DistributeReturnsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onSubmit: (payload: { type: "Profit" | "Loss"; amount: number; description: string; referenceNumber: string }) => Promise<void>;
}

export function DistributeReturnsModal({
  isOpen,
  onClose,
  project,
  onSubmit,
}: DistributeReturnsModalProps) {
  const { t } = useLocale();

  const [type, setType] = useState<"Profit" | "Loss">("Profit");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // §12 idempotency: one retry key per modal session — a retry after a
  // network failure reuses it so the server rejects the double payment.
  const [idempotencyRef, setIdempotencyRef] = useState<string>("");

  useEffect(() => {
    if (isOpen) setIdempotencyRef(newIdempotencyRef());
  }, [isOpen]);

  const typeOptions: DropdownOption[] = [
    { value: "Profit", label: t("projects.returns.profit", { defaultValue: "Profit / Dividend Return" }) },
    { value: "Loss", label: t("projects.returns.loss", { defaultValue: "Loss Allocation" }) },
  ];

  const shareholders = project?.involvedMembers || [];
  const totalShares = Number(project?.totalShares || 0);
  const currentBalance = Number(project?.currentFundBalance || 0);
  const numAmount = parseFloat(amount) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (numAmount <= 0) {
      setErrorMessage(t("finance.validation.amountGreaterThanZero", { defaultValue: "Amount must be greater than zero." }));
      return;
    }

    if (!description.trim()) {
      setErrorMessage(t("projects.validation.descriptionRequired", { defaultValue: "Description is required." }));
      return;
    }

    if (type === "Profit" && numAmount > currentBalance) {
      setErrorMessage(
        t("projects.validation.insufficientBalanceForPayout", {
          defaultValue: `Distribution amount (${formatMoney(numAmount)}) exceeds available project fund balance (${formatMoney(currentBalance)}).`,
        })
      );
      return;
    }

    if (shareholders.length === 0 || totalShares <= 0) {
      setErrorMessage(t("projects.validation.noShareholdersForReturn", { defaultValue: "No shareholders found for distribution." }));
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        type,
        amount: numAmount,
        description: description.trim(),
        referenceNumber: idempotencyRef,
      });
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
      description={project ? `${project.title} • Available Balance: ${formatMoney(currentBalance)}` : ""}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        <ERPFormSection title={t("projects.returns.type", { defaultValue: "Distribution Parameters" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("projects.returns.type", { defaultValue: "Distribution Type *" })}>
              <AppDropdown
                options={typeOptions}
                value={type}
                onChange={(val) => setType((val as "Profit" | "Loss") || "Profit")}
                placeholder="Select type..."
              />
            </ERPFormField>

            <ERPFormField label={t("projects.returns.amount", { defaultValue: "Distribution Amount *" })}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>
          </ERPFormGrid>

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

        {/* Live Pro-Rata Shareholder Payout Preview */}
        <ERPFormSection title={t("projects.returns.preview", { defaultValue: "Pro-Rata Shareholder Payout Preview" })}>
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
                      <th className="px-3 py-2 text-right">{t("projects.returns.portion", { defaultValue: "Calculated Share" })}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {shareholders.map((sh, idx) => {
                      const shares = Number(sh.sharesInvested || 0);
                      const memberPct = totalShares > 0 ? (shares / totalShares) : 0;
                      const calculatedShare = numAmount > 0 ? numAmount * memberPct : 0;

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
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            <span
                              className={
                                type === "Profit"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              }
                            >
                              {type === "Profit" ? "+" : "-"}
                              {formatMoney(calculatedShare)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </ERPFormSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            loading={isSubmitting}
            icon={type === "Profit" ? ArrowUpRight : ArrowDownLeft}
          >
            {t("projects.returns.execute", { defaultValue: "Execute Distribution" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
