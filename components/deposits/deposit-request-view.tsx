"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n";
import { useTenantShareValue } from "@/lib/use-tenant-settings";
import { DepositsListView } from "./deposits-list-view";
import { buildDepositMonthOptions, buildDepositYearOptions, useFundOptions, useMemberOptions } from "./shared";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const REQUEST_METHODS = ["BANK_TRANSFER", "BKASH", "NAGAD", "ROCKET", "CASH", "OTHER"] as const;

function requestMethodLabelKey(m: string): string {
  switch (m) {
    case "BANK_TRANSFER":
      return "requestDeposit.methods.bankTransfer";
    case "BKASH":
      return "requestDeposit.methods.bkash";
    case "NAGAD":
      return "requestDeposit.methods.nagad";
    case "ROCKET":
      return "requestDeposit.methods.rocket";
    case "CASH":
      return "requestDeposit.methods.cash";
    default:
      return "requestDeposit.methods.other";
  }
}

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

// Member-facing deposit slip desk. Shares the deposits management layout
// (DepositsListView: header, filter bar, fiscal month picker, sortable
// paginated table, receipt sheet) and opens the slip form in a TopSheet, the
// same way "Add Deposit" does. Scope is the signed-in member's own requests.
// TRX id + proof note travel in `notes` because the request contract
// (POST /api/deposits/request) carries no dedicated proof fields.
export function DepositRequestView() {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [fundId, setFundId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string | null>(null);
  const [trxId, setTrxId] = useState("");
  const [proofNote, setProofNote] = useState("");
  // Deposit month/year: the month the payment is FOR — survives approval so
  // the deposit lands in the claimed month, not the approval month.
  const [depositMonth, setDepositMonth] = useState("");
  const [depositYear, setDepositYear] = useState("");
  const [touched, setTouched] = useState(false);

  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions();
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
      setDepositYear("");
      setTouched(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("requestDeposit.loadFailed")),
  });

  const amountValid = AMOUNT_RE.test(amount.trim()) && parseFloat(amount) > 0;
  const monthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(`${depositYear}-${depositMonth}`);
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
      depositMonth: `${depositYear}-${depositMonth}`,
    });
  };

  const memberOptions = selfMember
    ? [{ value: selfMember.id, label: selfMember.name, caption: selfMember.memberId }]
    : (membersQuery.data ?? [])
        .filter((m) => m.status === "active")
        .map((m) => ({ value: m.id, label: m.name, caption: m.memberId }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const methodOptions = REQUEST_METHODS.map((m) => ({ value: m, label: t(requestMethodLabelKey(m)) }));
  const monthOptions = buildDepositMonthOptions(t);
  const yearOptions = buildDepositYearOptions();

  return (
    <>
      <DepositsListView
        onAdd={() => setSheetOpen(true)}
        memberScope={{ id: effectiveMemberId, name: scopeMember?.name }}
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
                <input
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
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("deposits.modal.depositMonth")} required error={touched && !monthValid ? t("deposits.modal.selectMonth") : undefined}>
                <AppDropdown
                  options={monthOptions}
                  value={depositMonth || null}
                  onChange={(v) => setDepositMonth(v ?? "")}
                  placeholder={t("deposits.modal.selectMonth")}
                />
              </ERPFormField>
              <ERPFormField label={t("deposits.modal.depositYear")} required error={touched && !monthValid ? t("deposits.modal.selectYear") : undefined}>
                <AppDropdown
                  options={yearOptions}
                  value={depositYear || null}
                  onChange={(v) => setDepositYear(v ?? "")}
                  placeholder={t("deposits.modal.selectYear")}
                />
              </ERPFormField>
            </ERPFormGrid>
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
