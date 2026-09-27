"use client";

import React, { useState } from "react";
import { TopSheet, ERPFormLayout, ERPFormSection, ERPFormGrid, ERPFormField, AppDropdown, DropdownOption, Button } from "@/components/ui";
import { useLocale } from "@/lib/i18n";
import { Project, ProjectUpdateRecord } from "@/types";
import { formatMoney } from "@/lib/formatters";

interface ProjectUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (updateData: { type: "Earning" | "Expense"; amount: number; description: string }) => Promise<void>;
  project: Project | null;
}

export function ProjectUpdateModal({
  isOpen,
  onClose,
  onSubmit,
  project,
}: ProjectUpdateModalProps) {
  const { t } = useLocale();

  const [type, setType] = useState<"Earning" | "Expense">("Expense");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const typeOptions: DropdownOption[] = [
    { value: "Expense", label: t("projects.updateTypes.expense", { defaultValue: "Expense (Project Cost / Material)" }) },
    { value: "Earning", label: t("projects.updateTypes.earning", { defaultValue: "Earning (Revenue / Return)" }) },
  ];

  const currentBalance = Number(project?.currentFundBalance || 0);
  const numAmount = parseFloat(amount) || 0;
  const simulatedNewBalance =
    type === "Earning"
      ? currentBalance + numAmount
      : currentBalance - numAmount;

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

    if (type === "Expense" && simulatedNewBalance < 0) {
      setErrorMessage(t("projects.validation.insufficientBalance", { defaultValue: "Insufficient project fund balance for this expense." }));
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        type,
        amount: numAmount,
        description: description.trim(),
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || t("common.errors.failedToRecordProjectUpdate", { defaultValue: "Failed to record project update." }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("projects.recordDisbursement", { defaultValue: "Project Disbursement & Update" })}
      description={project ? `${project.title} (${project.category})` : ""}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-md">
            {errorMessage}
          </div>
        )}

        <ERPFormSection title={t("projects.updateDetails", { defaultValue: "Disbursement Specification" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("projects.transactionType", { defaultValue: "Update Type *" })}>
              <AppDropdown
                options={typeOptions}
                value={type}
                onChange={(val) => setType((val as "Earning" | "Expense") || "Expense")}
                placeholder={t("projects.selectUpdateTypePlaceholder", { defaultValue: "Select type..." })}
              />
            </ERPFormField>

            <ERPFormField label={t("finance.amount", { defaultValue: "Amount *" })}>
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

          <ERPFormField label={t("finance.description", { defaultValue: "Description / Purpose *" })}>
            <textarea
              rows={3}
              placeholder={t("projects.updateDescriptionPlaceholder", { defaultValue: "Reason for disbursement or source of earned income..." })}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
            />
          </ERPFormField>
        </ERPFormSection>

        {/* Real-time Ledger Snapshot Comparison */}
        <div className="p-4 bg-muted/40 border border-border/80 rounded-xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
            {t("finance.ledgerSnapshot", { defaultValue: "Balance Impact Snapshot" })}
          </span>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground block">
                {t("finance.balanceBefore", { defaultValue: "Current Balance:" })}
              </span>
              <span className="font-mono font-medium text-foreground text-sm">
                {formatMoney(currentBalance)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 block">
                {t("finance.balanceAfter", { defaultValue: "Projected Balance:" })}
              </span>
              <span
                className={`font-mono font-semibold text-sm ${
                  simulatedNewBalance < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {formatMoney(simulatedNewBalance)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            {t("common.postTransaction", { defaultValue: "Post Disbursement" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
