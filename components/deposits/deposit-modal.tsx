"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef } from "react";
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
import { useTenantShareValue, useTenantPaymentMethods } from "@/lib/use-tenant-settings";
import { PAYMENT_TYPE_LABEL_KEY, type PaymentType } from "@/lib/payment-methods";
import { buildDepositMonthOptions, buildDepositYearOptions, monthKeyOf, useFundOptions, useHasOpenFiscalPeriod, useMemberOptions, type DepositRow } from "./shared";

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
  // Month/year dropdowns — the month the deposit is FOR. Required at submit
  // in both modes; edit mode pre-fills from the saved deposit month.
  depositMonth: z.string().optional(),
  depositYear: z.string().optional(),
});

type DepositForm = z.infer<typeof depositSchema>;

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

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
    formState: { errors, isSubmitting, isDirty },
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
      const savedMonth = initial.depositMonth || monthKeyOf(initial.date);
      setValue("depositYear", savedMonth ? savedMonth.slice(0, 4) : "");
      setValue("depositMonth", savedMonth ? savedMonth.slice(5, 7) : "");
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

  // New deposits are limited to active members, but edit mode must never
  // hide the RECORDED member: a deposit belonging to a since-deactivated
  // member (or one whose options row hasn't loaded) would otherwise render
  // an empty member field that looks like missing data.
  const memberOptions = useMemo(() => {
    const list = [...(membersQuery.data ?? [])];
    if (isEdit && initial?.memberId && !list.some((m) => m.id === initial.memberId)) {
      list.push({
        id: initial.memberId,
        memberId: initial.memberIdStr ?? "",
        name: initial.memberName ?? "",
        status: "active",
      });
    }
    return list
      .filter((m) => m.status === "active" || (isEdit && m.id === initial?.memberId))
      .map((m) => ({ value: m.id, label: m.name, caption: m.memberId }));
  }, [membersQuery.data, isEdit, initial]);
  // Funds carry no status filter, but the same guard applies when the options
  // feed fails: fall back to the row's own fund so edit never blanks it.
  const fundOptions = useMemo(() => {
    const list = [...(fundsQuery.data ?? [])];
    if (isEdit && initial?.fundId && !list.some((f) => f.id === initial.fundId)) {
      list.push({ id: initial.fundId, name: initial.fundName ?? "", balance: "0" });
    }
    return list.map((f) => ({ value: f.id, label: f.name }));
  }, [fundsQuery.data, isEdit, initial]);
  // Method picker from the tenant's configured payment methods (Settings →
  // Governance). An edited deposit whose stored method is no longer configured
  // (legacy row, or the org renamed it) is kept as a raw extra option — the
  // form must never silently blank real history.
  const paymentMethods = useTenantPaymentMethods();
  const hasOpenFiscalPeriod = useHasOpenFiscalPeriod();
  const methodOptions = useMemo(() => {
    const opts = paymentMethods.map((m) => {
      const typeLabel = t(
        PAYMENT_TYPE_LABEL_KEY[m.type as PaymentType] ?? 'settings.paymentMethods.types.other',
        { defaultValue: m.type },
      );
      // #71: the bilingual pattern `name · type` collapses to a duplicate when
      // the org names a method after its own type ("Cash" / CASH → "Cash · Cash").
      // Show the type qualifier only when it adds information.
      const label = m.name.trim().toLowerCase() === typeLabel.trim().toLowerCase()
        ? m.name
        : `${m.name} · ${typeLabel}`;
      return { value: m.name, label };
    });
    const saved = initial?.depositMethod;
    if (isEdit && saved && !opts.some((o) => o.value === saved)) {
      opts.unshift({ value: saved, label: saved });
    }
    return opts;
  }, [paymentMethods, t, isEdit, initial?.depositMethod]);
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
    // Month + year are explicit user choices (§15) — the server validates
    // the combined YYYY-MM and stores it as the deposit month.
    if (!values.depositMonth || !values.depositYear) {
      toast.error(t("deposits.modal.selectMonth"));
      return;
    }
    const selectedMonth = `${values.depositYear}-${values.depositMonth}`;
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
            depositMonth: selectedMonth,
          }),
        });
        queryClient.invalidateQueries({ queryKey: ["deposits"] });
        queryClient.invalidateQueries({ queryKey: ["members"] });
        queryClient.invalidateQueries({ queryKey: ["funds"] });
        toast.success(t("deposits.updatedToast"));
      } else {
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
    // `isDirty` comes straight from react-hook-form: any touched field makes
    // the sheet confirm before discarding (report issue 7).
    <TopSheet open={open} onClose={close} title={title} isDirty={isDirty}>
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <ERPFormLayout>
          <ERPFormSection title={title}>
            {hasOpenFiscalPeriod.data === false && (
              // #65 / #0: the write path fails closed with no OPEN fiscal
              // period. Surface it up front so a fully-filled form never ends
              // in an unexplained refusal.
              <div
                role="alert"
                className="mb-3 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
              >
                {t("deposits.modal.noOpenFiscalPeriod", {
                  defaultValue:
                    "No fiscal year is open. Start one in Fiscal Years before recording deposits — otherwise the save will be refused.",
                })}
              </div>
            )}
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
