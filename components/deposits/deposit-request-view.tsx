"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatDatePattern, formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import {
  depositStatusTone,
  useDepositsList,
  useFundOptions,
  useMemberOptions,
  useTenantCurrency,
  useTenantDateFormat,
  type DepositRow,
} from "./shared";

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

// Member-facing deposit slip portal: submit a payment proof for officer
// review (POST /api/deposits/request → PENDING) and track submission
// history below. TRX id + proof note travel in `notes` since the request
// contract carries no dedicated proof fields.
export function DepositRequestView() {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [memberId, setMemberId] = useState<string | null>(null);
  const [fundId, setFundId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string | null>(null);
  const [trxId, setTrxId] = useState("");
  const [proofNote, setProofNote] = useState("");
  const [touched, setTouched] = useState(false);

  const currency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions();

  // Default the member picker to the signed-in user's own member record
  // (matched by email). The picker itself still starts empty per Rule §15
  // until resolved here — resolution is identity, not a pre-selection.
  const linkedMemberUuid = useMemo(() => {
    if (memberId) return memberId;
    const email = user?.email?.toLowerCase();
    if (!email) return null;
    return membersQuery.data?.find((m) => m.email?.toLowerCase() === email)?.id ?? null;
  }, [user?.email, memberId, membersQuery.data]);
  const effectiveMemberId = memberId ?? linkedMemberUuid;

  const history = useDepositsList({
    page: 1,
    pageSize: 20,
    search: "",
    memberId: effectiveMemberId,
    fundId: null,
    status: null,
    startDate: null,
    endDate: null,
  });

  const submitMutation = useMutation({
    mutationFn: (payload: { memberId: string; fundId: string; amount: string; depositMethod: string; notes: string }) =>
      apiClient<{ success: boolean; message?: string }>("/deposits/request", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      toast.success(res.message ?? t("requestDeposit.success"));
      setFundId(null);
      setAmount("");
      setMethod(null);
      setTrxId("");
      setProofNote("");
      setTouched(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("requestDeposit.loadFailed")),
  });

  const amountValid = AMOUNT_RE.test(amount.trim()) && parseFloat(amount) > 0;
  const formValid =
    !!effectiveMemberId && !!fundId && amountValid && !!method && trxId.trim().length > 0;

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
    });
  };

  const memberOptions = (membersQuery.data ?? [])
    .filter((m) => m.status === "active")
    .map((m) => ({ value: m.id, label: m.name, caption: m.memberId }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const methodOptions = REQUEST_METHODS.map((m) => ({ value: m, label: t(requestMethodLabelKey(m)) }));

  const statusLabel = (s: string | null | undefined): string => {
    const u = (s || "").toUpperCase();
    if (u === "PENDING") return t("deposits.statusPending");
    if (u === "REJECTED") return t("deposits.statusRejected");
    return t("deposits.statusVerified");
  };

  const columns: ERPColumn<DepositRow>[] = [
    {
      key: "date",
      header: t("requestDeposit.columns.date"),
      render: (r) => <span className="font-mono text-[11px]">{formatDatePattern(r.date, dateFormat)}</span>,
    },
    {
      key: "fundName",
      header: t("requestDeposit.columns.fund"),
      render: (r) => <span>{r.fundName || "—"}</span>,
    },
    {
      key: "amount",
      header: t("requestDeposit.columns.amount"),
      align: "right",
      render: (r) => <span className="font-mono">{formatMoney(r.amount, currency)}</span>,
    },
    {
      key: "depositMethod",
      header: t("requestDeposit.columns.method"),
      render: (r) => <span className="text-[11px]">{r.depositMethod || "—"}</span>,
    },
    {
      key: "referenceNumber",
      header: t("requestDeposit.columns.reference"),
      render: (r) => <span className="font-mono text-[11px]">{r.referenceNumber || "—"}</span>,
    },
    {
      key: "status",
      header: t("requestDeposit.columns.status"),
      align: "right",
      render: (r) => <StatusBadge tone={depositStatusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>,
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {t("requestDeposit.title")}
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">{t("requestDeposit.subtitle")}</p>
      </div>

      <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6">
        <ERPFormLayout>
          <ERPFormSection title={t("requestDeposit.title")}>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("requestDeposit.member")} required error={touched && !effectiveMemberId ? t("requestDeposit.selectMember") : undefined}>
                <AppDropdown
                  options={memberOptions}
                  value={memberId}
                  onChange={setMemberId}
                  placeholder={t("requestDeposit.selectMember")}
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
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {t("requestDeposit.history")}
        </h2>
        <ERPDataTable
          data={history.data?.data ?? []}
          columns={columns}
          isLoading={history.isLoading}
          rowKey={(r) => r.id}
          emptyMessage={history.isError ? t("requestDeposit.loadFailed") : t("requestDeposit.emptyHistory")}
        />
      </div>
    </div>
  );
}
