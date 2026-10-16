"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { ERPFiscalMonthPicker } from "@/components/ui/erp-fiscal-month-picker";
import { TopSheet } from "@/components/ui/top-sheet";
import { NumericInput } from "@/components/ui/numeric-input";
import { ApiError, apiClient } from "@/lib/api-client";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { useLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/formatters";
import { fromCents, toCents } from "@/lib/money";
import { useTenantPaymentMethods, useTenantSettings } from "@/lib/use-tenant-settings";
import { PAYMENT_TYPE_LABEL_KEY, type PaymentType } from "@/lib/payment-methods";
import {
  centsToAmount,
  sumCents,
  useFundOptions,
  useMemberOptions,
  useTenantCurrency,
} from "./shared";
import { DEPOSIT_FUND_TYPE } from "@/lib/deposit-fund";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const OPEN_ROW_GRID = "grid grid-cols-[1fr_110px_1fr_2rem] gap-2";
const SELF_ROW_GRID = "grid grid-cols-[1fr_1fr_2rem] gap-2";

// No guessed fallback: until the tenant's real share value loads, rows are not
// prefilled (same contract as the deposit screen's bulk modal).
function toShareValueCents(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const cents = toCents(raw);
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

interface BulkRequestRow {
  key: number;
  memberId: string;
  amount: string;
  trxId: string;
}

let rowSeq = 1;

// Batch deposit REQUEST desk: the request-screen twin of the deposit screen's
// bulk modal. Same UX shape (common fund + month + method, one row per entry)
// but every row is a PENDING slip awaiting officer approval — never a direct
// balance-moving deposit. When the signed-in member is resolved (self-scoped),
// the member column is locked to that member; otherwise any active member can
// be requested for, mirroring the single request form's fallback.
// Amounts stay strings (2dp); the running total is summed in integer cents.
export function BulkDepositRequestModal({
  open,
  onClose,
  selfMemberId,
}: {
  open: boolean;
  onClose: () => void;
  selfMemberId?: string | null;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const currency = useTenantCurrency();

  const [fundId, setFundId] = useState<string | null>(null);
  const [depositMonth, setDepositMonth] = useState("");
  const [depositFiscalYear, setDepositFiscalYear] = useState("");
  const [method, setMethod] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkRequestRow[]>(() => [
    { key: 0, memberId: selfMemberId ?? "", amount: "", trxId: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions(DEPOSIT_FUND_TYPE);
  const shareValueCents = toShareValueCents(useTenantSettings().data?.financial?.shareValueBdt);
  const sharesById = new Map((membersQuery.data ?? []).map((m) => [m.id, m.shares ?? 0]));
  // §15 exception (same as the deposit forms): picking a member prefills
  // shares × share value, in integer cents. Editable for partial payments.
  const suggestedAmount = (memberId: string): string => {
    const shares = sharesById.get(memberId) ?? 0;
    return shareValueCents !== null && Number.isInteger(shares) && shares > 0
      ? fromCents(shareValueCents * shares)
      : "";
  };
  // Bulk and single request offer the SAME tenant-configured method list.
  const paymentMethods = useTenantPaymentMethods();

  const selfMember = selfMemberId
    ? (membersQuery.data ?? []).find((m) => m.id === selfMemberId) ?? null
    : null;

  const memberOptions = (membersQuery.data ?? [])
    .filter((m) => m.status === "active")
    .map((m) => ({ value: m.id, label: m.name, caption: m.memberId }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const methodOptions = paymentMethods.map((m) => {
    const typeLabel = t(
      PAYMENT_TYPE_LABEL_KEY[m.type as PaymentType] ?? "settings.paymentMethods.types.other",
      { defaultValue: m.type },
    );
    // #71: drop the type qualifier when it merely repeats the method name.
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

  const rowValid = (r: BulkRequestRow) =>
    !!r.memberId && AMOUNT_RE.test(r.amount.trim()) && parseFloat(r.amount) > 0 && r.trxId.trim().length > 0;
  const validRows = rows.filter(rowValid);
  const total = centsToAmount(sumCents(validRows.map((r) => r.amount.trim())));
  const monthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(depositMonth);

  const close = () => {
    setFundId(null);
    setDepositMonth("");
    setDepositFiscalYear("");
    setMethod(null);
    setRows([{ key: 0, memberId: selfMemberId ?? "", amount: "", trxId: "" }]);
    setTouched(false);
    onClose();
  };

  const onSubmit = async () => {
    setTouched(true);
    if (!fundId || !monthValid || validRows.length === 0) {
      toast.error(t("requestDeposit.bulk.minOneRow"));
      return;
    }
    // The fiscal month picker's value is already the absolute YYYY-MM period.
    const monthKey = depositMonth;
    setSubmitting(true);
    try {
      await apiClient<{ success: boolean }>("/deposits/request/bulk", {
        method: "POST",
        body: JSON.stringify({
          fundId,
          depositMonth: monthKey,
          depositMethod: method || undefined,
          // Raw 2dp strings, same wire contract as the single request route
          // (amount parsing + 2dp ceiling are enforced server-side).
          deposits: validRows.map((r) => ({
            memberId: r.memberId,
            amount: r.amount.trim(),
            trxId: r.trxId.trim(),
          })),
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      toast.success(t("requestDeposit.bulk.successToast", { count: validRows.length }));
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("requestDeposit.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const isDirty =
    !!fundId || !!depositMonth || !!depositFiscalYear || !!method ||
    rows.some((r) => r.memberId || r.amount.trim() || r.trxId.trim());

  return (
    <TopSheet
      open={open}
      onClose={close}
      title={t("requestDeposit.bulk.title")}
      subtitle={t("requestDeposit.bulk.subtitle")}
      wide
      // Any populated field counts as unsaved work — the sheet confirms
      // before discarding it (report issue 7).
      isDirty={isDirty}
    >
      <ERPFormLayout>
        <ERPFormSection title={t("requestDeposit.bulk.title")}>
          <ERPFormGrid columns={3}>
            <ERPFormField label={t("requestDeposit.bulk.fund")} required error={touched && !fundId ? t("requestDeposit.bulk.selectFund") : undefined}>
              <AppDropdown
                options={fundOptions}
                value={fundId}
                onChange={setFundId}
                placeholder={t("requestDeposit.bulk.selectFund")}
              />
            </ERPFormField>
            <ERPFormField label={t("requestDeposit.bulk.method")}>
              <AppDropdown
                options={methodOptions}
                value={method}
                onChange={setMethod}
                placeholder={t("requestDeposit.bulk.selectMethod")}
              />
            </ERPFormField>
            <div className="flex items-end pb-0.5">
              <p className="text-xs text-slate-500">
                {t("requestDeposit.bulk.runningTotal")}:{" "}
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                  {formatMoney(total, currency)}
                </span>
              </p>
            </div>
          </ERPFormGrid>
          <ERPFiscalMonthPicker
            fiscalYears={yearOptions}
            months={monthOptions}
            required
            monthLabel={t("requestDeposit.bulk.month")}
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
        </ERPFormSection>

        <ERPFormSection title={`${t("requestDeposit.bulk.rows")} (${validRows.length})`}>
          <div className="space-y-2">
            <div className={`${selfMember ? SELF_ROW_GRID : OPEN_ROW_GRID} text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`}>
              {!selfMember && <span>{t("requestDeposit.bulk.member")}</span>}
              <span className="text-right">{t("requestDeposit.bulk.amount")}</span>
              <span>{t("requestDeposit.bulk.trxId")}</span>
              <span />
            </div>
            {rows.map((row) => (
              <div key={row.key} className={`${selfMember ? SELF_ROW_GRID : OPEN_ROW_GRID} items-start`}>
                {!selfMember && (
                  <AppDropdown
                    options={memberOptions.filter(
                      (o) => o.value === row.memberId || !rows.some((r) => r.memberId === o.value && r.key !== row.key),
                    )}
                    value={row.memberId || null}
                    onChange={(v) => {
                      const memberId = v ?? "";
                      // The amount belongs to the member, so a member change
                      // re-derives it (§5).
                      setRows((prev) =>
                        prev.map((r) =>
                          r.key !== row.key || r.memberId === memberId
                            ? r
                            : { ...r, memberId, amount: suggestedAmount(memberId) },
                        ),
                      );
                    }}
                    placeholder={t("requestDeposit.bulk.selectMember")}
                  />
                )}
                <NumericInput
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={row.amount}
                  onChange={(e) =>
                    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))
                  }
                  aria-label={t("requestDeposit.bulk.amount")}
                  className={`px-3 py-2 rounded-lg border text-xs font-mono bg-card border-border/80 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary ${
                    touched && row.memberId && row.amount.trim() && !AMOUNT_RE.test(row.amount.trim())
                      ? "border-rose-500"
                      : ""
                  }`}
                />
                <input
                  type="text"
                  placeholder={t("requestDeposit.bulk.trxPlaceholder")}
                  value={row.trxId}
                  onChange={(e) =>
                    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, trxId: e.target.value } : r)))
                  }
                  aria-label={t("requestDeposit.bulk.trxId")}
                  className={`px-3 py-2 rounded-lg border text-xs font-mono bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary ${
                    touched && row.memberId && row.amount.trim() && !row.trxId.trim()
                      ? "border-rose-500"
                      : ""
                  }`}
                />
                <button
                  type="button"
                  aria-label="Remove row"
                  disabled={rows.length <= 1}
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  className="p-2 rounded text-slate-400 hover:text-rose-500 disabled:opacity-30 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() =>
              setRows((prev) => [...prev, { key: rowSeq++, memberId: selfMemberId ?? "", amount: "", trxId: "" }])
            }
          >
            {t("requestDeposit.bulk.addRow")}
          </Button>
        </ERPFormSection>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={close} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={onSubmit} loading={submitting} loadingLabel={t("requestDeposit.bulk.submitting")}>
            {t("requestDeposit.bulk.submit", { count: validRows.length })}
          </Button>
        </div>
      </ERPFormLayout>
    </TopSheet>
  );
}
