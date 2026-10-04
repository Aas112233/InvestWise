"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPDatePicker } from "@/components/ui/erp-date-picker";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { useTenantShareValue } from "@/lib/use-tenant-settings";
import { buildDepositMonthOptions, buildDepositYearOptions, useFundOptions, useMemberOptions, type DepositRow } from "./shared";

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
  collectedDate: z.string().min(1),
  submittedDate: z.string().nullable().optional(),
  // Add mode only — month/year dropdowns (required at submit, guarded there
  // since edit mode derives the month from the collected date server-side).
  depositMonth: z.string().optional(),
  depositYear: z.string().optional(),
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

// Single deposit entry + edit. The deposit month is chosen explicitly
// (month + year dropdowns) instead of being auto-derived from the collected
// date — back-entry records the month the deposit is FOR. Collected date
// (money received) is still required. Submission date (recorded) is
// optional — server defaults to now, settable for back-entry. All fields
// start empty (§15 — explicit user choice); the amount autofills from the
// selected member's shares × tenant share value at the user's request.
export function DepositModal({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: DepositRow | null;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const isEdit = !!initial;
  const tenantShareValue = useTenantShareValue();

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
    defaultValues: {
      memberId: "",
      fundId: "",
      amount: "",
      method: "",
      reference: "",
      notes: "",
      collectedDate: null as unknown as string,
      submittedDate: null,
      depositMonth: "",
      depositYear: "",
    },
  });

  // Edit mode pre-fills from the row; add mode always starts empty.
  useEffect(() => {
    if (open && initial) {
      setValue("memberId", initial.memberId ?? "", { shouldValidate: true });
      setValue("fundId", initial.fundId ?? "", { shouldValidate: true });
      setValue("amount", String(initial.amount ?? ""), { shouldValidate: true });
      setValue("method", initial.depositMethod ?? "", { shouldValidate: true });
      setValue("reference", initial.referenceNumber ?? "");
      setValue("notes", initial.description ?? "");
      setValue("collectedDate", initial.date ? initial.date.slice(0, 10) : ("" as unknown as string), {
        shouldValidate: true,
      });
      setValue("submittedDate", initial.submittedDate ? initial.submittedDate.slice(0, 10) : null);
      setValue("depositMonth", "");
      setValue("depositYear", "");
    } else if (open && !initial) {
      reset({
        memberId: "",
        fundId: "",
        amount: "",
        method: "",
        reference: "",
        notes: "",
        collectedDate: null as unknown as string,
        submittedDate: null,
        depositMonth: "",
        depositYear: "",
      });
    }
  }, [open, initial, setValue, reset]);

  const memberId = watch("memberId") ?? "";
  const fundId = watch("fundId") ?? "";
  const method = watch("method") ?? "";
  const collectedDate = watch("collectedDate") ?? null;
  const submittedDate = watch("submittedDate") ?? null;
  const depositMonth = watch("depositMonth") ?? "";
  const depositYear = watch("depositYear") ?? "";

  // Amount autofill (explicit user request, §15-sanctioned): selecting a
  // member defaults the amount to their shares × tenant share value. Fires
  // only when the member selection actually changes so a background refetch
  // never clobbers a hand-typed amount. Still editable for partial payments.
  const lastAutofilledMember = useRef("");
  useEffect(() => {
    if (!open || isEdit) return;
    if (!memberId || memberId === lastAutofilledMember.current) return;
    const member = (membersQuery.data ?? []).find((m) => m.id === memberId);
    const shares = Number(member?.shares ?? 0);
    if (!member || !Number.isFinite(shares) || shares <= 0) return;
    const suggested = (shares * tenantShareValue).toFixed(2);
    if (parseFloat(suggested) > 0) {
      lastAutofilledMember.current = memberId;
      setValue("amount", suggested, { shouldValidate: true });
    }
  }, [open, isEdit, memberId, membersQuery.data, tenantShareValue, setValue]);

  const memberOptions = (membersQuery.data ?? [])
    .filter((m) => m.status === "active")
    .map((m) => ({ value: m.id, label: m.name, caption: m.memberId }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const methodOptions = METHOD_VALUES.map((m) => ({ value: m, label: t(methodLabelKey(m)) }));
  const monthOptions = buildDepositMonthOptions(t);
  const yearOptions = buildDepositYearOptions();

  const close = () => {
    reset({
      memberId: "",
      fundId: "",
      amount: "",
      method: "",
      reference: "",
      notes: "",
      collectedDate: null as unknown as string,
      submittedDate: null,
      depositMonth: "",
      depositYear: "",
    });
    lastAutofilledMember.current = "";
    onClose();
  };

  const onSubmit = async (values: DepositForm) => {
    try {
      if (isEdit && initial) {
        // Edit goes through the single finance path (atomic revert + apply
        // for fund/member/amount changes). Amount crosses as a number per the
        // finance contract; cents enforcement is server-side.
        await apiClient<{ success: boolean; message?: string }>(`/finance/deposits/${initial.id}`, {
          method: "PUT",
          body: JSON.stringify({
            memberId: values.memberId,
            fundId: values.fundId,
            amount: parseFloat(values.amount.trim()),
            description: values.notes?.trim() || initial.description || "Member deposit",
            depositMethod: values.method,
            collectedDate: values.collectedDate,
            submittedDate: values.submittedDate || undefined,
          }),
        });
        queryClient.invalidateQueries({ queryKey: ["deposits"] });
        queryClient.invalidateQueries({ queryKey: ["members"] });
        queryClient.invalidateQueries({ queryKey: ["funds"] });
        toast.success(t("deposits.updatedToast"));
      } else {
        // Month + year are explicit user choices in add mode (§15) — the
        // server validates the combined YYYY-MM and uses it for
        // lastDepositMonth and the deposit ledger rows.
        if (!values.depositMonth || !values.depositYear) {
          toast.error(t("deposits.modal.selectMonth"));
          return;
        }
        const selectedMonth = `${values.depositYear}-${values.depositMonth}`;
        await apiClient<{ success: boolean; message?: string }>("/deposits", {
          method: "POST",
          body: JSON.stringify({
            memberId: values.memberId,
            fundId: values.fundId,
            amount: values.amount.trim(),
            description: values.notes?.trim() || `${selectedMonth} deposit`,
            depositMethod: values.method,
            referenceNumber: values.reference?.trim() || undefined,
            collectedDate: values.collectedDate,
            submittedDate: values.submittedDate || undefined,
            depositMonth: selectedMonth,
          }),
        });
        queryClient.invalidateQueries({ queryKey: ["deposits"] });
        queryClient.invalidateQueries({ queryKey: ["members"] });
        queryClient.invalidateQueries({ queryKey: ["funds"] });
        const memberName = membersQuery.data?.find((m) => m.id === values.memberId)?.name ?? "";
        // Localized copy is authoritative; the server `message` is an English
        // duplicate and would defeat ur/hi/bn.
        toast.success(t("deposits.recordedToast", { amount: values.amount.trim(), member: memberName }));
      }
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed"));
    }
  };

  const title = isEdit ? t("deposits.modal.titleEdit") : t("deposits.modal.titleAdd");

  return (
    <TopSheet open={open} onClose={close} title={title}>
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <ERPFormLayout>
          <ERPFormSection title={title}>
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
            <ERPFormGrid columns={2}>
              <ERPFormField
                label={t("deposits.modal.collectedDate")}
                required
                error={errors.collectedDate ? t("deposits.modal.selectCollectedDate") : undefined}
              >
                <ERPDatePicker
                  value={collectedDate}
                  onChange={(v) => setValue("collectedDate", (v ?? "") as string, { shouldValidate: true })}
                  placeholder={t("erp.datePicker.placeholder")}
                />
              </ERPFormField>
              <ERPFormField label={t("deposits.modal.submittedDate")}>
                <ERPDatePicker
                  value={submittedDate}
                  onChange={(v) => setValue("submittedDate", v)}
                  placeholder={t("deposits.modal.submittedDatePlaceholder")}
                />
              </ERPFormField>
            </ERPFormGrid>
            {!isEdit && (
              <ERPFormGrid columns={2}>
                <ERPFormField label={t("deposits.modal.depositMonth")} required>
                  <AppDropdown
                    options={monthOptions}
                    value={depositMonth || null}
                    onChange={(v) => setValue("depositMonth", v ?? "")}
                    placeholder={t("deposits.modal.selectMonth")}
                  />
                </ERPFormField>
                <ERPFormField label={t("deposits.modal.depositYear")} required>
                  <AppDropdown
                    options={yearOptions}
                    value={depositYear || null}
                    onChange={(v) => setValue("depositYear", v ?? "")}
                    placeholder={t("deposits.modal.selectYear")}
                  />
                </ERPFormField>
              </ERPFormGrid>
            )}
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("deposits.modal.reference")}>
                <input type="text" placeholder={t("deposits.modal.referencePlaceholder")} {...register("reference")} className={`${inputCls} font-mono`} disabled={isEdit} />
              </ERPFormField>
              <ERPFormField label={t("deposits.modal.notes")}>
                <input type="text" placeholder={t("deposits.modal.notesPlaceholder")} {...register("notes")} className={inputCls} />
              </ERPFormField>
            </ERPFormGrid>
          </ERPFormSection>
          <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" type="button" onClick={close} disabled={isSubmitting}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" size="sm" type="submit" loading={isSubmitting} loadingLabel={t("deposits.modal.submitting")}>
                {isEdit ? t("deposits.modal.saveChanges") : t("deposits.modal.submit")}
              </Button>
            </div>
          </ERPFormLayout>
      </form>
    </TopSheet>
  );
}
