"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { ERPFiscalMonthPicker } from "@/components/ui/erp-fiscal-month-picker";
import { TopSheet } from "@/components/ui/top-sheet";
import { NumericInput } from "@/components/ui/numeric-input";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { useLocale } from "@/lib/i18n";
import { useTenantShareValue, useTenantPaymentMethods } from "@/lib/use-tenant-settings";
import { PAYMENT_TYPE_LABEL_KEY, type PaymentType } from "@/lib/payment-methods";
import { DepositsListView } from "./deposits-list-view";
import { BulkDepositRequestModal } from "./bulk-deposit-request-modal";
import { useFundOptions, useMemberOptions } from "./shared";
import { DEPOSIT_FUND_TYPE } from "@/lib/deposit-fund";
import { hasScreenPermission } from "@/lib/permissions";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

// Member-facing deposit slip desk. Shares the deposits management layout
// (DepositsListView: header, filter bar, fiscal month picker, sortable
// paginated table, receipt sheet) and opens the slip form in a TopSheet, the
// same way "Add Deposit" does.
// Two audiences, one screen: a plain member (REQUEST_DEPOSIT write only) is
// scoped to their own requests — submit and track; an officer (DEPOSITS READ,
// the same audience as the deposits desk) sees the request INBOX — every
// member's requests, with verify/reject on pending rows. Pending requests are
// hidden from the desk table, so this screen is where they live end to end.
// TRX id + proof note travel in `notes` because the request contract
// (POST /api/deposits/request) carries no dedicated proof fields.
export function DepositRequestView() {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [fundId, setFundId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string | null>(null);
  const [trxId, setTrxId] = useState("");
  const [proofNote, setProofNote] = useState("");
  // Deposit period: the fiscal month the payment is FOR — survives approval so
  // the deposit lands in the claimed month, not the approval month.
  // depositMonth is the absolute YYYY-MM the API takes; depositFiscalYear is
  // the picker's parent selection (fiscal start year).
  const [depositMonth, setDepositMonth] = useState("");
  const [depositFiscalYear, setDepositFiscalYear] = useState("");
  const [touched, setTouched] = useState(false);

  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions(DEPOSIT_FUND_TYPE);
  const tenantShareValue = useTenantShareValue();

  // Scope the directory to the signed-in user's own member record (matched by
  // email). That is identity, not a pre-selection: every money field below
  // still starts empty (Rule §15). Falls back to an open member filter until
  // (or unless) the match resolves.
  const selfMember = useMemo(() => {
    const email = user?.email?.toLowerCase();
    if (!email) return null;
    return membersQuery.data?.find((m) => m.email?.toLowerCase() === email) ?? null;
  }, [user?.email, membersQuery.data]);

  const effectiveMemberId = selfMember?.id ?? memberId ?? null;
  const scopeMember = selfMember ?? (membersQuery.data ?? []).find((m) => m.id === memberId) ?? null;

  // Officer (DEPOSITS READ — the deposits-desk audience) sees the request
  // inbox: all members' requests, review actions included. A plain member
  // stays scoped to their own record (member privacy — a member must never
  // see another member's requests).
  const officer = hasScreenPermission(user, "DEPOSITS", "READ");

  // Amount autofill (same contract as the deposit form): fires only when the
  // member identity actually changes — including the moment the signed-in
  // member's own record resolves — so a background refetch never clobbers a
  // hand-typed amount. Still editable for partial or extra payments.
  const lastAutofilledMember = useRef("");
  useEffect(() => {
    if (!sheetOpen) return;
    if (!effectiveMemberId || effectiveMemberId === lastAutofilledMember.current) return;
    const member = (membersQuery.data ?? []).find((m) => m.id === effectiveMemberId);
    const shares = Number(member?.shares ?? 0);
    if (!member || !Number.isFinite(shares) || shares <= 0) return;
    const suggested = (shares * tenantShareValue).toFixed(2);
    if (parseFloat(suggested) > 0) {
      lastAutofilledMember.current = effectiveMemberId;
      setAmount(suggested);
    }
  }, [sheetOpen, effectiveMemberId, membersQuery.data, tenantShareValue]);

  const submitMutation = useMutation({
    mutationFn: (payload: { memberId: string; fundId: string; amount: string; depositMethod: string; notes: string; depositMonth: string }) =>
      apiClient<{ success: boolean; message?: string }>("/deposits/request", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      // Localized copy is authoritative; the server `message` is an English
      // duplicate and would defeat ur/hi/bn.
      toast.success(t("requestDeposit.success"));
      setSheetOpen(false);
      setFundId(null);
      setAmount("");
      setMethod(null);
      setTrxId("");
      setProofNote("");
      setDepositMonth("");
      setDepositFiscalYear("");
      setTouched(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("requestDeposit.loadFailed")),
  });

  const amountValid = AMOUNT_RE.test(amount.trim()) && parseFloat(amount) > 0;
  const monthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(depositMonth);
  const formValid =
    !!effectiveMemberId && !!fundId && amountValid && !!method && trxId.trim().length > 0 && monthValid;

  const onSubmit = () => {
    setTouched(true);
    if (!formValid || !effectiveMemberId || !fundId || !method) return;
    const parts: string[] = [`TRX ID: ${trxId.trim()}`];
    if (proofNote.trim()) parts.push(proofNote.trim());
    submitMutation.mutate({
      memberId: effectiveMemberId,
      fundId,
      amount: amount.trim(),
      depositMethod: method,
      notes: parts.join(" | "),
      depositMonth,
    });
  };

  const memberOptions = selfMember
    ? [{ value: selfMember.id, label: selfMember.name, caption: selfMember.memberId }]
    : (membersQuery.data ?? [])
        .filter((m) => m.status === "active")
        .map((m) => ({ value: m.id, label: m.name, caption: m.memberId }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  // Method picker comes from the tenant's Settings → Governance list (name +
  // channel type); the stored value is the configured name itself.
  const paymentMethods = useTenantPaymentMethods();
  const methodOptions = paymentMethods.map((m) => {
    const typeLabel = t(
      PAYMENT_TYPE_LABEL_KEY[m.type as PaymentType] ?? 'settings.paymentMethods.types.other',
      { defaultValue: m.type },
    );
    // #71: drop the type qualifier when it merely repeats the method name
    // ("Cash" / CASH → "Cash", not "Cash · Cash").
    const label = m.name.trim().toLowerCase() === typeLabel.trim().toLowerCase()
      ? m.name
      : `${m.name} · ${typeLabel}`;
    return { value: m.name, label };
  });
  // Posting form: only the fiscal year the ledger is open for is offered, plus
  // any year already selected so the field never renders blank.
  const { yearOptionsIncluding, monthsFor } = useFiscalPeriodOptions();
  const yearOptions = yearOptionsIncluding(depositFiscalYear || null);
  const monthOptions = monthsFor(depositFiscalYear || null);

  return (
    <>
      <DepositsListView
        onAdd={() => setSheetOpen(true)}
        onBulk={() => setBulkOpen(true)}
        requestScreen
        // Officers get the open inbox (no member lock); members stay scoped
        // to their own requests.
        memberScope={officer ? undefined : { id: effectiveMemberId, name: scopeMember?.name }}
      />
      <BulkDepositRequestModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        selfMemberId={effectiveMemberId}
      />

      <TopSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t("requestDeposit.title")}
        subtitle={t("requestDeposit.subtitle")}
      >
        <ERPFormLayout>
          <ERPFormSection title={t("requestDeposit.title")}>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("requestDeposit.member")} required error={touched && !effectiveMemberId ? t("requestDeposit.selectMember") : undefined}>
                <AppDropdown
                  options={memberOptions}
                  value={effectiveMemberId}
                  onChange={setMemberId}
                  placeholder={selfMember ? selfMember.name : t("requestDeposit.selectMember")}
                  disabled={!!selfMember}
                  clearable={!selfMember}
                />
              </ERPFormField>
              <ERPFormField label={t("requestDeposit.fund")} required error={touched && !fundId ? t("requestDeposit.selectFund") : undefined}>
                <AppDropdown
                  options={fundOptions}
                  value={fundId}
                  onChange={setFundId}
                  placeholder={t("requestDeposit.selectFund")}
                />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("requestDeposit.amount")} required error={touched && !amountValid ? t("deposits.modal.amount") : undefined}>
                <NumericInput
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${inputCls} font-mono`}
                />
              </ERPFormField>
              <ERPFormField label={t("requestDeposit.method")} required error={touched && !method ? t("requestDeposit.selectMethod") : undefined}>
                <AppDropdown
                  options={methodOptions}
                  value={method}
                  onChange={setMethod}
                  placeholder={t("requestDeposit.selectMethod")}
                />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFiscalMonthPicker
              fiscalYears={yearOptions}
              months={monthOptions}
              required
              monthLabel={t("deposits.modal.depositMonth")}
              error={touched && !monthValid ? t("deposits.modal.selectMonth") : undefined}
              value={{
                fiscalYear: depositFiscalYear || null,
                month: depositMonth || null,
              }}
              onChange={(v) => {
                setDepositFiscalYear(v.fiscalYear ?? "");
                setDepositMonth(v.month ?? "");
              }}
            />
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("requestDeposit.trxId")} required error={touched && !trxId.trim() ? t("requestDeposit.trxId") : undefined}>
                <input
                  type="text"
                  placeholder={t("requestDeposit.trxPlaceholder")}
                  value={trxId}
                  onChange={(e) => setTrxId(e.target.value)}
                  className={`${inputCls} font-mono`}
                />
              </ERPFormField>
              <ERPFormField label={t("requestDeposit.proofNote")}>
                <input
                  type="text"
                  placeholder={t("requestDeposit.proofPlaceholder")}
                  value={proofNote}
                  onChange={(e) => setProofNote(e.target.value)}
                  className={inputCls}
                />
              </ERPFormField>
            </ERPFormGrid>
          </ERPFormSection>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setSheetOpen(false)} disabled={submitMutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onSubmit}
              loading={submitMutation.isPending}
              loadingLabel={t("requestDeposit.submitting")}
            >
              {t("requestDeposit.submit")}
            </Button>
          </div>
        </ERPFormLayout>
      </TopSheet>
    </>
  );
}
