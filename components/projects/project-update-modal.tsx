"use client";

import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { TopSheet, ERPFormSection, ERPFormGrid, ERPFormField, ERPDatePicker, AppDropdown, DropdownOption, Button } from "@/components/ui";
import { NumericInput } from "@/components/ui/numeric-input";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency, useTenantDateFormat } from "@/lib/use-tenant-settings";
import { Project } from "@/types";
import { formatMoney, todayLocalIso } from "@/lib/formatters";
import { intlLocaleFor, projectSectorLabel } from "./project-labels";
import { newIdempotencyRef } from "@/lib/idempotency";
import { apiClient } from "@/lib/api-client";

interface ProjectUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (updateData: {
    type: "Earning" | "Expense";
    amount: number;
    description: string;
    projectId?: string;
    referenceNumber: string;
    date: string;
    handledByMemberId: string | null;
  }) => Promise<void>;
  project?: Project | null;
  projects?: Project[];
}

interface InvolvedMember {
  memberId: string;
  memberName: string;
  memberCode?: string;
}

export function ProjectUpdateModal({
  isOpen,
  onClose,
  onSubmit,
  project,
  projects = [],
}: ProjectUpdateModalProps) {
  const { t, locale } = useLocale();
  // Money on this screen is the tenant's money, so it carries the tenant's currency.
  const tenantCurrency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const fm = (n: number | string | null | undefined) => formatMoney(n, tenantCurrency, { locale: intlLocaleFor(locale) });

  const [selectedProjectId, setSelectedProjectId] = useState<string>(project?.id || "");
  const [type, setType] = useState<"Earning" | "Expense">("Expense");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [date, setDate] = useState<string>(todayLocalIso());
  const [handledByMemberId, setHandledByMemberId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // §12 idempotency: one retry key per modal session — a retry after a
  // network failure reuses it so the server rejects the double post.
  const [idempotencyRef, setIdempotencyRef] = useState<string>("");

  // #107: a fresh sheet every time. The old sheet kept the previously
  // submitted amount/description visible on reopen.
  const resetForm = React.useCallback(() => {
    setType("Expense");
    setAmount("");
    setDescription("");
    setDate(todayLocalIso());
    setHandledByMemberId(null);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    // Prefixed ref: this value is persisted as the ledger reference number, so
    // it must read like `PRJ-EXP-…` / `PRJ-REV-…`, never a bare UUID.
    if (isOpen) setIdempotencyRef(newIdempotencyRef(type === "Earning" ? "PRJ-REV" : "PRJ-EXP"));
  }, [isOpen, type]);

  useEffect(() => {
    if (project?.id) {
      setSelectedProjectId(project.id);
    } else if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId("");
    }
  }, [project, projects, isOpen]);

  const effectiveProject = project || projects.find((p) => p.id === selectedProjectId) || null;

  // #107: project associate members for the "Handled by" picker (name entry
  // only — selecting one never moves a balance).
  const membersQuery = useQuery<{ data?: { involvedMembers?: InvolvedMember[] }; involvedMembers?: InvolvedMember[] }>({
    queryKey: ["project-update-members", effectiveProject?.id],
    queryFn: () => apiClient(`/projects/${effectiveProject?.id}`),
    enabled: isOpen && !!effectiveProject?.id,
    staleTime: 60_000,
  });
  const involvedMembers: InvolvedMember[] =
    membersQuery.data?.data?.involvedMembers ?? membersQuery.data?.involvedMembers ?? [];

  const projectOptions: DropdownOption[] = projects.map((p) => ({
    value: p.id,
    label: `${p.title} (Bal: ${fm(p.currentFundBalance)})`,
  }));

  const typeOptions: DropdownOption[] = [
    { value: "Expense", label: t("projects.updateTypes.expense", { defaultValue: "Expense (Project Cost / Material)" }) },
    { value: "Earning", label: t("projects.updateTypes.earning", { defaultValue: "Earning (Revenue / Return)" }) },
  ];

  const handledByOptions: DropdownOption[] = involvedMembers.map((m) => ({
    value: m.memberId,
    label: `${m.memberName}${m.memberCode ? ` (${m.memberCode})` : ""}`,
  }));

  const currentBalance = Number(effectiveProject?.currentFundBalance || 0);
  const numAmount = parseFloat(amount) || 0;
  const simulatedNewBalance =
    type === "Earning"
      ? currentBalance + numAmount
      : currentBalance - numAmount;

  const isDirty =
    !!amount ||
    !!description.trim() ||
    type !== "Expense" ||
    date !== todayLocalIso() ||
    !!handledByMemberId;

  const discardAndClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const targetId = effectiveProject?.id;
    if (!targetId) {
      setErrorMessage(t("projects.validation.selectProjectRequired", { defaultValue: "Please select a target project." }));
      return;
    }

    if (numAmount <= 0) {
      setErrorMessage(t("finance.validation.amountGreaterThanZero", { defaultValue: "Amount must be greater than zero." }));
      return;
    }

    if (!description.trim()) {
      setErrorMessage(t("projects.validation.descriptionRequired", { defaultValue: "Description is required." }));
      return;
    }

    if (!date) {
      setErrorMessage(t("projects.validation.dateRequired", { defaultValue: "Date is required." }));
      return;
    }
    if (date > todayLocalIso()) {
      setErrorMessage(t("projects.validation.dateFuture", { defaultValue: "Date cannot be in the future." }));
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
        projectId: targetId,
        referenceNumber: idempotencyRef,
        date,
        handledByMemberId,
      });
      // #107: clear the sheet so the next open starts blank.
      resetForm();
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
      onDiscard={discardAndClose}
      isDirty={isDirty}
      title={t("projects.recordDisbursement", { defaultValue: "Project Spending & Update" })}
      description={effectiveProject ? `${effectiveProject.title} (${projectSectorLabel(t, effectiveProject.category)})` : t("projects.selectProjectForUpdate", { defaultValue: "Record income or expense against a project" })}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-xl">
            {errorMessage}
          </div>
        )}

        <ERPFormSection title={t("projects.updateDetails", { defaultValue: "Spending Specification" })}>
          {!project && projects.length > 0 && (
            <ERPFormField label={t("projects.targetEntity", { defaultValue: "Target Project *" })}>
              <AppDropdown
                options={projectOptions}
                value={selectedProjectId || null}
                onChange={(val) => setSelectedProjectId(val || "")}
                placeholder={t("projects.selectProject", { defaultValue: "Select Project..." })}
              />
            </ERPFormField>
          )}

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
              <NumericInput
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

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("common.date", { defaultValue: "Date *" })}>
              <ERPDatePicker
                value={date || null}
                onChange={(v) => setDate(v ?? "")}
                displayFormat={dateFormat}
                max={todayLocalIso()}
                clearable={false}
                placeholder={t("erp.datePicker.placeholder")}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.handledBy", { defaultValue: "Handled By" })}>
              <AppDropdown
                options={handledByOptions}
                value={handledByMemberId}
                onChange={(val) => setHandledByMemberId(val || null)}
                placeholder={t("projects.handledByPlaceholder", { defaultValue: "Select member (optional)..." })}
                disabled={handledByOptions.length === 0}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {handledByOptions.length === 0
                  ? t("projects.handledByNoMembers", { defaultValue: "No members are associated with this project yet." })
                  : t("projects.handledByHint", { defaultValue: "Name entry only — this does not change the member's balance." })}
              </p>
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormField label={t("finance.description", { defaultValue: "Description / Purpose *" })}>
            <textarea
              rows={3}
              placeholder={t("projects.updateDescriptionPlaceholder", { defaultValue: "Reason for spending or source of earned income..." })}
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
                {fm(currentBalance)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">
                {t("finance.balanceAfter", { defaultValue: "Projected Balance:" })}
              </span>
              <span
                className={`font-mono font-semibold text-sm ${
                  simulatedNewBalance < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {fm(simulatedNewBalance)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-border">
          <Button variant="ghost" size="sm" type="button" onClick={discardAndClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            {t("common.postTransaction", { defaultValue: "Post Spending" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
