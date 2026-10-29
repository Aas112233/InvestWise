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
import { formatMoney } from "@/lib/formatters";
import { useTenantCurrency, useTenantDateFormat, useTenantShareValue, useTenantPaymentMethods } from "@/lib/use-tenant-settings";
import { PAYMENT_TYPE_LABEL_KEY, type PaymentType } from "@/lib/payment-methods";
import { DEPOSIT_FUND_TYPE } from "@/lib/deposit-fund";
import {
  monthKeyOf,
  useFundOptions,
  useHasOpenFiscalPeriod,
  useMemberDepositMonths,
  useMemberOptions,
  type DepositRow,
} from "./shared";
import { offerPrintDocument } from "@/lib/documents";

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
  depositMonth: z.string().optional(),
  depositFiscalYear: z.string().optional(),
});

type DepositForm = z.infer<typeof depositSchema>;

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

/**
 * Period key of a date INPUT's value, or "" when it cannot be known.
 *
 * An ISO `YYYY-MM-DD` string is sliced rather than parsed: `new Date("2026-10-01")` is UTC midnight,
 * so reading `getMonth()` in a negative-offset timezone would call it September and file the
 * deposit in the wrong period. Only a non-ISO value falls back to `monthKeyOf`.
 */
function monthKeyFromDateInput(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  // monthKeyOf already answers "" for an unusable value.
  return monthKeyOf(raw);
}

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
  const currency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
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
    // Inactive (dormant) members are selectable — a dormant member can still
    // deposit. Suspended members stay VISIBLE but disabled: the (Suspended)
    // marker explains why they can't be picked, and the write path refuses
    // them anyway (assertMemberNotSuspended). An edited row always keeps its
    // own member, whatever their status.
    const filtered = list.filter((m) => {
      if (isEdit && m.id === initial?.memberId) return true;
      return m.status === "active" || m.status === "inactive" || m.status === "suspended";
    });
    return filtered.map((m) => ({
      value: m.id,
      label: memberDisplayName(m.name, m.status),
      caption: m.memberId,
      disabled: m.status === "suspended" && !(isEdit && m.id === initial?.memberId),
    }));
  }, [membersQuery.data, isEdit, initial]);

  const fundOptions = useMemo(() => {
    const list = [...(fundsQuery.data ?? [])];
    if (isEdit && initial?.fundId && !list.some((f) => f.id === initial.fundId)) {
      list.push({ id: initial.fundId, name: initial.fundName ?? "", balance: "0" });
    }
    return list.map((f) => ({ value: f.id, label: f.name }));
  }, [fundsQuery.data, isEdit, initial]);

  const paymentMethods = useTenantPaymentMethods();
  const hasOpenFiscalPeriod = useHasOpenFiscalPeriod();
  const methodOptions = useMemo(() => {
    const opts = paymentMethods.map((m) => {
      const typeLabel = t(
        PAYMENT_TYPE_LABEL_KEY[m.type as PaymentType] ?? 'settings.paymentMethods.types.other',
        { defaultValue: m.type },
      );
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

  // Months this member already holds in the chosen fiscal year — the SAME
  // server grid the single-member bulk collection uses, so a month greyed out
  // here is exactly a month the write path would refuse. Enabled only once the
  // member is chosen: the endpoint answers one member per call.
  const monthGrid = useMemberDepositMonths(memberId || null, effectiveFiscalYear || null);

  /**
   * FLEXIBLE schedules: the month is ATTRIBUTION, not a decision with consequences.
   *
   * Under monthly the officer must choose it deliberately, because "paying June's instalment in
   * July" is a real and common act and the choice drives compliance. Under flexible nothing is owed
   * for any month, so making them pick one from a blank list adds a click and one way to be wrong:
   * a `deposit_month` that disagrees with the collected date silently relocates the money between
   * fiscal years and reports, and there is no obligation for it to disagree WITH.
   *
   * So the month follows the collected date the officer already typed (the server stamps
   * `transactions.date` from that same field) and remains fully editable — visible in the picker,
   * never hidden, and an explicit pick always wins. Monthly tenants get exactly the old behaviour:
   * `derivedMonth` stays empty because `flexibleGrid` is false.
   */
  const flexibleGrid = monthGrid.data?.obligationEnforced === false;
  const derivedMonth = flexibleGrid ? monthKeyFromDateInput(collectedDate) : "";
  /**
   * Only derive a month the picker can actually show. A deposit back-dated across a fiscal-year
   * boundary would otherwise be posted into a period the officer never sees selected on screen —
   * the opposite of the reason for deriving it. When that happens the field stays an explicit
   * choice, exactly as it was before.
   */
  const canDeriveMonth =
    derivedMonth !== "" && monthsFor(effectiveFiscalYear || null).some((o) => o.value === derivedMonth);
  const effectiveMonth = depositMonth || (canDeriveMonth ? derivedMonth : "");
  const occupiedMonths = useMemo(() => {
    const taken = new Map<string, string | null>();
    for (const cell of monthGrid.data?.months ?? []) if (cell.occupied) taken.set(cell.month, cell.amount);
    return taken;
  }, [monthGrid.data]);

  /**
   * H6 — periods that already hold settled money, for a FLEXIBLE member.
   *
   * `occupiedMonths` is empty on a flexible schedule (correctly: nothing is reserved), which would
   * leave this picker offering a month the member has already paid into three times with no hint
   * of it. Captions are figures only, because the existing "month taken" wording is precisely
   * what is NOT true here. Monthly cells carry `depositCount: null`, so this map stays empty and
   * the monthly picker is untouched.
   */
  const monthProgress = useMemo(() => {
    const seen = new Map<string, string>();
    for (const cell of monthGrid.data?.months ?? []) {
      // `typeof` rather than a null check: a payload from a server predating the flexible model
      // omits the field entirely, and that must mean "nothing to show", never "undefined".
      if (typeof cell.depositCount !== "number" || cell.depositCount <= 0) continue;
      seen.set(
        cell.month,
        `${cell.depositCount} · ${cell.periodTotal ? formatMoney(cell.periodTotal, currency) : ""}`.trim(),
      );
    }
    return seen;
  }, [monthGrid.data, currency]);

  const monthOptions = useMemo(() => {
    const options = monthsFor(effectiveFiscalYear || null);
    if (!memberId) return options;
    return options.map((option) => {
      const amount = occupiedMonths.get(option.value);
      if (amount === undefined) {
        const progress = monthProgress.get(option.value);
        return progress ? { ...option, caption: progress } : option;
      }
      return {
        ...option,
        // The month this row ALREADY sits in stays selectable: the occupancy
        // grid includes the deposit being edited, so locking it would block an
        // edit of the amount alone.
        disabled: option.value !== effectiveMonth,
        caption: `${t("erp.fiscalMonth.monthTaken")}${amount ? ` · ${formatMoney(amount, currency)}` : ""}`,
      };
    });
  }, [monthsFor, effectiveFiscalYear, memberId, occupiedMonths, monthProgress, effectiveMonth, t, currency]);

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
    // The same rule the picker displays: an explicit pick always wins, otherwise a flexible
    // schedule attributes the money to the period of its collected date — and only when that period
    // is one the officer can actually see selected on screen.
    const selectedMonth = values.depositMonth || (canDeriveMonth ? derivedMonth : "");
    if (!selectedMonth) {
      toast.error(t("deposits.modal.selectMonth"));
      return;
    }
    // A month this member already holds is disabled in the picker; refuse it
    // here too, so a keyboard path or a stale grid cannot post a duplicate.
    // Re-saving the row's OWN month is the edit case and stays allowed.
    const heldAmount = occupiedMonths.get(selectedMonth);
    if (heldAmount !== undefined && selectedMonth !== (initial?.depositMonth || null)) {
      toast.error(t("erp.fiscalMonth.monthTaken"));
      return;
    }
    try {
      if (isEdit && initial) {
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
        // No print window is opened here. This used to reserve a blank browser
        // tab before the request so the receipt could be navigated into it
        // afterwards, which meant pressing Save opened a tab for a result that
        // had not been decided yet — and on a failed write the tab had to be
        // closed again. Printing is now offered from the success toast instead.
        const res = await apiClient<{
          success: boolean;
          message?: string;
          data?: { id?: string; depositNumber?: string; referenceNumber?: string };
        }>("/deposits", {
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
        // The member label carries the status marker (e.g. "Suspended"), so the
        // toast must use the same helper as the picker — never the bare name.
        const matchedMember = membersQuery.data?.find((m) => m.id === values.memberId);
        const memberName = memberDisplayName(matchedMember?.name, matchedMember?.status);
        // Localized copy is authoritative; the server `message` is an English
        // duplicate and would defeat ur/hi/bn.
        // One toast, carrying the print offer: the document becomes available
        // only after the transaction succeeded, and the tab opens from this
        // click rather than from the Save that started the request. If it is
        // dismissed the receipt is still reachable from the row's Print action.
        const recordedMessage = t("deposits.recordedToast", { amount: values.amount.trim(), member: memberName });
        if (res?.data?.id) {
          offerPrintDocument({
            kind: "deposit",
            id: res.data.id,
            title: recordedMessage,
            actionLabel: t("deposits.actions.print", { defaultValue: "Print Receipt" }),
            reference: res.data.depositNumber ?? res.data.referenceNumber,
          });
        } else {
          toast.success(recordedMessage);
        }
      }
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed"));
    }
  };

  const title = isEdit ? t("deposits.modal.titleEdit") : t("deposits.modal.titleAdd");

  return (
    <TopSheet open={open} onClose={close} title={title} isDirty={isDirty}>
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <ERPFormLayout>
          <ERPFormSection title={title}>
            {hasOpenFiscalPeriod.data === false && (
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
                  displayFormat={dateFormat}
                  placeholder={t("erp.datePicker.placeholder")}
                />
              </ERPFormField>
              <ERPFormField label={t("deposits.modal.submittedDate")}>
                <ERPDatePicker
                  value={submittedDate}
                  onChange={(v) => setValue("submittedDate", v)}
                  displayFormat={dateFormat}
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
                // Shows the derived period rather than a blank field, so the attribution the
                // server will store is the attribution the officer can see.
                month: effectiveMonth || null,
              }}
              onChange={(v) => {
                setValue("depositFiscalYear", v.fiscalYear ?? "");
                setValue("depositMonth", v.month ?? "");
              }}
              monthLabel={t("deposits.modal.depositMonth")}
              monthsLoading={monthGrid.isLoading}
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

