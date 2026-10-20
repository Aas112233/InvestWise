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
import { ERPFiscalMonthPicker } from "@/components/ui/erp-fiscal-month-picker";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { NumericInput } from "@/components/ui/numeric-input";
import { ApiError, apiClient } from "@/lib/api-client";
import { memberDisplayName } from "@/lib/member-display";
import { useLocale } from "@/lib/i18n";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { useTenantShareValue, useTenantPaymentMethods } from "@/lib/use-tenant-settings";
import { PAYMENT_TYPE_LABEL_KEY, type PaymentType } from "@/lib/payment-methods";
import { monthKeyOf, useFundOptions, useHasOpenFiscalPeriod, useMemberOptions, type DepositRow } from "./shared";
import { DEPOSIT_FUND_TYPE } from "@/lib/deposit-fund";
import { openPrintTab, releasePrintWindow, reservePrintWindow } from "@/lib/documents";

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
  // Period the deposit is FOR, picked on the tenant's fiscal calendar and
  // required at submit in both modes; edit mode pre-fills from the saved
  // deposit month. depositMonth is the absolute YYYY-MM sent on the wire,
  // depositFiscalYear the picker's parent (fiscal start year).
  depositMonth: z.string().optional(),
  depositFiscalYear: z.string().optional(),
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
  // Fiscal period options (Rule §8): the deposit month is an accounting
  // period, so its dropdowns follow the tenant's fiscal calendar — and for a
  // posting form, only the year the ledger is open for (lib/fiscal-guard.ts
  // rejects every other one at submit).
  const { yearOptionsIncluding, monthsFor, fiscalStartYearOf, defaultPostableFiscalYear } = useFiscalPeriodOptions();

  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions(DEPOSIT_FUND_TYPE);

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
      depositFiscalYear: "",
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
      setValue("depositMonth", savedMonth);
      setValue("depositFiscalYear", savedMonth ? fiscalStartYearOf(savedMonth) ?? "" : "");
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
        depositFiscalYear: "",
      });
    }
  }, [open, initial, setValue, reset, fiscalStartYearOf]);

  const memberId = watch("memberId") ?? "";
  const fundId = watch("fundId") ?? "";
  const method = watch("method") ?? "";
  const collectedDate = watch("collectedDate") ?? null;
  const submittedDate = watch("submittedDate") ?? null;
  const depositMonth = watch("depositMonth") ?? "";
  const depositFiscalYear = watch("depositFiscalYear") ?? "";

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
      // Pending/inactive stay hidden (not yet members / dormant); suspended
      // members stay VISIBLE but disabled — the (Suspended) marker explains
      // why they can't be picked.
      .filter((m) => m.status === "active" || m.status === "suspended" || (isEdit && m.id === initial?.memberId))
      .map((m) => ({
        value: m.id,
        label: memberDisplayName(m.name, m.status),
        caption: m.memberId,
        disabled: m.status === "suspended" && !(isEdit && m.id === initial?.memberId),
      }));
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
  // Seeded from the header's fiscal year: a new deposit opens on the year the
  // desk is working in (the month itself stays an explicit choice), and the
  // officer can still pick another year for this entry. An edited row keeps its
  // own period, which prefill sets explicitly.
  const effectiveFiscalYear = depositFiscalYear || defaultPostableFiscalYear || "";
  // Keeps the row's own period visible when editing a deposit that sits in a
  // closed or never-created fiscal year.
  const yearOptions = yearOptionsIncluding(effectiveFiscalYear || null);
  const monthOptions = monthsFor(effectiveFiscalYear || null);

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
      depositFiscalYear: "",
    });
    lastAutofilledMember.current = "";
    onClose();
  };

  const onSubmit = async (values: DepositForm) => {
    // Fiscal year + month are explicit user choices (§15); the month option is
    // already the absolute YYYY-MM the server validates and stores.
    if (!values.depositMonth) {
      toast.error(t("deposits.modal.selectMonth"));
      return;
    }
    const selectedMonth = values.depositMonth;
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
        queryClient.invalidateQueries({ queryKey: ["analytics"] });
        toast.success(t("deposits.updatedToast"));
      } else {
        // Pre-open the receipt tab while this submit's user gesture is still
        // live: the POST's round trip ends the gesture, and a window.open
        // fired after that is eaten by popup blockers (see lib/documents.ts).
        reservePrintWindow();
        const res = await apiClient<{ success: boolean; message?: string; data?: { id?: string } }>("/deposits", {
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
        queryClient.invalidateQueries({ queryKey: ["analytics"] });
        const matchedMember = membersQuery.data?.find((m) => m.id === values.memberId);
        const memberName = memberDisplayName(matchedMember?.name, matchedMember?.status);
        // Localized copy is authoritative; the server `message` is an English
        // duplicate and would defeat ur/hi/bn.
        toast.success(t("deposits.recordedToast", { amount: values.amount.trim(), member: memberName }));
        // The deposit is now recorded — open its printable receipt. Only the
        // create path produces a new document (edit has none, mirroring the
        // projects flow); if the server did not return the row id, drop the
        // reserved blank tab instead of leaving an empty window behind.
        if (res?.data?.id) openPrintTab("deposit", res.data.id);
        else releasePrintWindow();
      }
      close();
    } catch (err) {
      // A refused/failed create must never leave the pre-opened blank tab.
      releasePrintWindow();
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
                <NumericInput type="text" inputMode="decimal" placeholder="0.00" {...register("amount")} className={`${inputCls} font-mono`} />
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
            <ERPFiscalMonthPicker
              fiscalYears={yearOptions}
              months={monthOptions}
              required
              value={{
                fiscalYear: effectiveFiscalYear || null,
                month: depositMonth || null,
              }}
              onChange={(v) => {
                setValue("depositFiscalYear", v.fiscalYear ?? "");
                setValue("depositMonth", v.month ?? "");
              }}
              monthLabel={t("deposits.modal.depositMonth")}
            />
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
