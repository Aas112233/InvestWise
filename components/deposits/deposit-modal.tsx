"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPDatePicker } from "@/components/ui/erp-date-picker";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { ERPFiscalMonthPicker, type FiscalMonthValue } from "@/components/ui/erp-fiscal-month-picker";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { monthKeyOf, recentYears, useFundOptions, useMemberOptions } from "./shared";

const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

// Amount stays a string end-to-end (2dp, no float) to match the API contract.
const depositSchema = z.object({
  memberId: z.string().min(1),
  fundId: z.string().min(1),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "amount")
    .refine((v) => parseFloat(v) > 0, "amount"),
  method: z.string().min(1),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  date: z.string().nullable().optional(),
});

type DepositForm = z.infer<typeof depositSchema>;

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

const METHOD_VALUES = ["Cash", "Bank", "Mobile Banking", "Check", "Other"] as const;

function methodLabelKey(m: string): string {
  switch (m) {
    case "Cash":
      return "deposits.methods.cash";
    case "Bank":
      return "deposits.methods.bank";
    case "Mobile Banking":
      return "deposits.methods.mobile";
    case "Check":
      return "deposits.methods.check";
    default:
      return "deposits.methods.other";
  }
}

// Single deposit entry. Month is required (fiscal picker); exact transaction
// date is optional (server defaults to now when omitted).
export function DepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState<FiscalMonthValue>({ fiscalYear: null, month: null });
  const [monthError, setMonthError] = useState(false);

  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DepositForm>({
    resolver: zodResolver(depositSchema) as any,
    defaultValues: { memberId: "", fundId: "", amount: "", method: "", reference: "", notes: "", date: null },
  });

  const memberId = watch("memberId") ?? "";
  const fundId = watch("fundId") ?? "";
  const method = watch("method") ?? "";
  const date = watch("date") ?? null;

  const memberOptions = (membersQuery.data ?? [])
    .filter((m) => m.status === "active")
    .map((m) => ({ value: m.id, label: m.name, caption: m.memberId }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const methodOptions = METHOD_VALUES.map((m) => ({ value: m, label: t(methodLabelKey(m)) }));
  const years = recentYears(5);
  const monthOptions = MONTH_SHORT.map((s, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label: t(`common.months.${s}`),
  }));

  const close = () => {
    reset({ memberId: "", fundId: "", amount: "", method: "", reference: "", notes: "", date: null });
    setMonth({ fiscalYear: null, month: null });
    setMonthError(false);
    onClose();
  };

  const onSubmit = async (values: DepositForm) => {
    if (!month.fiscalYear || !month.month) {
      setMonthError(true);
      return;
    }
    const monthKey = `${month.fiscalYear}-${month.month}`;
    try {
      const res = await apiClient<{ success: boolean; message?: string }>("/deposits", {
        method: "POST",
        body: JSON.stringify({
          memberId: values.memberId,
          fundId: values.fundId,
          amount: values.amount.trim(),
          description: values.notes?.trim() || `${monthKey} deposit`,
          depositMethod: values.method,
          referenceNumber: values.reference?.trim() || undefined,
          date: values.date || undefined,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      const memberName = membersQuery.data?.find((m) => m.id === values.memberId)?.name ?? "";
      toast.success(res.message ?? t("deposits.recordedToast", { amount: values.amount.trim(), member: memberName }));
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed"));
    }
  };

  return (
    <TopSheet open={open} onClose={close} title={t("deposits.modal.titleAdd")}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <ERPFormLayout>
          <ERPFormSection title={t("deposits.modal.titleAdd")}>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("deposits.modal.member")} required error={errors.memberId ? t("deposits.modal.selectMember") : undefined}>
                <AppDropdown
                  options={memberOptions}
                  value={memberId || null}
                  onChange={(v) => setValue("memberId", v ?? "", { shouldValidate: true })}
                  placeholder={t("deposits.modal.selectMember")}
                />
              </ERPFormField>
              <ERPFormField label={t("deposits.modal.fund")} required error={errors.fundId ? t("deposits.modal.selectFund") : undefined}>
                <AppDropdown
                  options={fundOptions}
                  value={fundId || null}
                  onChange={(v) => setValue("fundId", v ?? "", { shouldValidate: true })}
                  placeholder={t("deposits.modal.selectFund")}
                />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("deposits.modal.amount")} required error={errors.amount?.message}>
                <input type="text" inputMode="decimal" placeholder="0.00" {...register("amount")} className={`${inputCls} font-mono`} />
              </ERPFormField>
              <ERPFormField label={t("deposits.modal.method")} required error={errors.method ? t("deposits.modal.selectMethod") : undefined}>
                <AppDropdown
                  options={methodOptions}
                  value={method || null}
                  onChange={(v) => setValue("method", v ?? "", { shouldValidate: true })}
                  placeholder={t("deposits.modal.selectMethod")}
                />
              </ERPFormField>
            </ERPFormGrid>
            <div>
              <ERPFiscalMonthPicker
                fiscalYears={years}
                months={monthOptions}
                value={month}
                onChange={(v) => {
                  setMonth(v);
                  setMonthError(false);
                }}
                yearLabel={t("deposits.modal.month")}
                monthLabel={t("deposits.modal.month")}
              />
              {monthError && (
                <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                  {t("deposits.modal.month")}
                </p>
              )}
            </div>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("deposits.modal.reference")}>
                <input type="text" placeholder={t("deposits.modal.referencePlaceholder")} {...register("reference")} className={`${inputCls} font-mono`} />
              </ERPFormField>
              <ERPFormField label={t("deposits.modal.txnDate")}>
                <ERPDatePicker
                  value={date}
                  onChange={(v) => setValue("date", v)}
                  placeholder={t("erp.datePicker.placeholder")}
                />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFormField label={t("deposits.modal.notes")}>
              <input type="text" placeholder={t("deposits.modal.notesPlaceholder")} {...register("notes")} className={inputCls} />
            </ERPFormField>
            {month.fiscalYear && month.month && date && monthKeyOf(date) !== `${month.fiscalYear}-${month.month}` && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("deposits.modal.monthMismatch")}</p>
            )}
          </ERPFormSection>
          <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" type="button" onClick={close} disabled={isSubmitting}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" size="sm" type="submit" loading={isSubmitting} loadingLabel={t("deposits.modal.submitting")}>
                {t("deposits.modal.submit")}
              </Button>
            </div>
          </ERPFormLayout>
      </form>
    </TopSheet>
  );
}
