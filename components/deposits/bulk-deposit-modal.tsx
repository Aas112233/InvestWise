"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { ERPFiscalMonthPicker, type FiscalMonthValue } from "@/components/ui/erp-fiscal-month-picker";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/formatters";
import { centsToAmount, recentYears, sumCents, useFundOptions, useMemberOptions, useTenantCurrency } from "./shared";

const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

interface BulkRow {
  key: number;
  memberId: string;
  amount: string;
}

let rowSeq = 1;

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

// Batch monthly collection: one common fund + month, per-member amounts.
// Amounts stay strings (2dp); the running total is summed in integer cents.
export function BulkDepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const currency = useTenantCurrency();

  const [fundId, setFundId] = useState<string | null>(null);
  const [month, setMonth] = useState<FiscalMonthValue>({ fiscalYear: null, month: null });
  const [method, setMethod] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkRow[]>([{ key: 0, memberId: "", amount: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions();

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

  const validRows = rows.filter(
    (r) => r.memberId && AMOUNT_RE.test(r.amount.trim()) && parseFloat(r.amount) > 0,
  );
  const total = centsToAmount(sumCents(validRows.map((r) => r.amount.trim())));

  const close = () => {
    setFundId(null);
    setMonth({ fiscalYear: null, month: null });
    setMethod(null);
    setRows([{ key: 0, memberId: "", amount: "" }]);
    setTouched(false);
    onClose();
  };

  const onSubmit = async () => {
    setTouched(true);
    if (!fundId || !month.fiscalYear || !month.month || validRows.length === 0) {
      toast.error(t("deposits.bulk.minOneRow"));
      return;
    }
    const monthKey = `${month.fiscalYear}-${month.month}`;
    setSubmitting(true);
    try {
      await apiClient("/finance/deposits/bulk", {
        method: "POST",
        body: JSON.stringify({
          fundId,
          commonMonth: monthKey,
          depositMethod: method || undefined,
          deposits: validRows.map((r) => ({
            memberId: r.memberId,
            amount: r.amount.trim(),
            depositMonth: monthKey,
            date: `${monthKey}-01`,
          })),
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      toast.success(t("deposits.bulk.successToast", { count: validRows.length }));
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TopSheet open={open} onClose={close} title={t("deposits.bulk.title")} subtitle={t("deposits.bulk.subtitle")} wide>
      <ERPFormLayout>
        <ERPFormSection title={t("deposits.bulk.title")}>
          <ERPFormGrid columns={3}>
            <ERPFormField label={t("deposits.bulk.fund")} required error={touched && !fundId ? t("deposits.bulk.selectFund") : undefined}>
              <AppDropdown
                options={fundOptions}
                value={fundId}
                onChange={setFundId}
                placeholder={t("deposits.bulk.selectFund")}
              />
            </ERPFormField>
            <ERPFormField label={t("deposits.bulk.method")}>
              <AppDropdown
                options={methodOptions}
                value={method}
                onChange={setMethod}
                placeholder={t("deposits.bulk.selectMethod")}
              />
            </ERPFormField>
            <div className="flex items-end pb-0.5">
              <p className="text-xs text-slate-500">
                {t("deposits.bulk.runningTotal")}:{" "}
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                  {formatMoney(total, currency)}
                </span>
              </p>
            </div>
          </ERPFormGrid>
          <ERPFiscalMonthPicker
            fiscalYears={years}
            months={monthOptions}
            value={month}
            onChange={setMonth}
            yearLabel={t("deposits.bulk.month")}
            monthLabel={t("deposits.bulk.month")}
          />
        </ERPFormSection>

        <ERPFormSection title={`${t("deposits.bulk.rows")} (${validRows.length})`}>
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.key} className="grid grid-cols-[1fr_140px_auto] gap-2 items-start">
                <AppDropdown
                  options={memberOptions.filter(
                    (o) => o.value === row.memberId || !rows.some((r) => r.memberId === o.value && r.key !== row.key),
                  )}
                  value={row.memberId || null}
                  onChange={(v) =>
                    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, memberId: v ?? "" } : r)))
                  }
                  placeholder={t("deposits.bulk.selectMember")}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={row.amount}
                  onChange={(e) =>
                    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))
                  }
                  aria-label={t("deposits.bulk.amount")}
                  className="px-3 py-2 rounded-lg border text-xs font-mono bg-card border-border/80 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
            onClick={() => setRows((prev) => [...prev, { key: rowSeq++, memberId: "", amount: "" }])}
          >
            {t("deposits.bulk.addRow")}
          </Button>
        </ERPFormSection>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={close} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={onSubmit} loading={submitting} loadingLabel={t("deposits.bulk.submitting")}>
            {t("deposits.bulk.submit", { count: validRows.length })}
          </Button>
        </div>
      </ERPFormLayout>
    </TopSheet>
  );
}
