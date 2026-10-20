"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, ListChecks, Plus, Trash2, User, Users } from "lucide-react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { ERPFiscalMonthPicker, type FiscalMonthValue } from "@/components/ui/erp-fiscal-month-picker";
import { TopSheet } from "@/components/ui/top-sheet";
import { NumericInput } from "@/components/ui/numeric-input";
import { ApiError, apiClient } from "@/lib/api-client";
import { memberDisplayName } from "@/lib/member-display";
import { useLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/formatters";
import { fromCents, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BulkExcelImport } from "./bulk-excel-import";
import { SingleMemberBulkDeposit } from "./single-member-bulk-deposit";
import { centsToAmount, sumCents, useFundOptions, useMemberOptions, useTenantCurrency } from "./shared";
import { DEPOSIT_FUND_TYPE } from "@/lib/deposit-fund";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { useTenantPaymentMethods, useTenantSettings } from "@/lib/use-tenant-settings";
import { PAYMENT_TYPE_LABEL_KEY, type PaymentType } from "@/lib/payment-methods";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const ROW_GRID = "grid grid-cols-[1fr_64px_140px_2rem] gap-2";

// No guessed fallback: until the tenant's real share value loads, rows are not prefilled.
function toShareValueCents(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const cents = toCents(raw);
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

interface BulkRow {
  key: number;
  memberId: string;
  amount: string;
}

let rowSeq = 1;

/**
 * Two collection shapes share this sheet:
 *
 *  - "multiple" — one common fund + month, per-member amounts (manual rows or
 *    an Excel template). This is the original monthly-collection desk.
 *  - "single"   — one member, one financial year, several months at once. The
 *    month grid comes from the server, months that already hold a deposit are
 *    locked, and the chosen months post as one idempotent batch.
 *
 * Both submit to the same `POST /api/finance/deposits/bulk` contract; the only
 * difference is that the single-member shape sends a month PER ROW instead of a
 * shared `commonMonth`.
 */
export function BulkDepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const currency = useTenantCurrency();

  const [scope, setScope] = useState<"multiple" | "single">("multiple");
  const [singleDirty, setSingleDirty] = useState(false);
  const [fundId, setFundId] = useState<string | null>(null);
  const [month, setMonth] = useState<FiscalMonthValue>({ fiscalYear: null, month: null });
  const [method, setMethod] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkRow[]>([{ key: 0, memberId: "", amount: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<"manual" | "excel">("manual");
  const [excelSelected, setExcelSelected] = useState<Set<string>>(() => new Set());
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);

  // Stable identity: the single-member grid reports its dirty state on every
  // render, and an inline arrow would re-fire that effect in a loop.
  const handleSingleDirtyChange = useCallback((dirty: boolean) => setSingleDirty(dirty), []);

  const membersQuery = useMemberOptions();
  const fundsQuery = useFundOptions(DEPOSIT_FUND_TYPE);
  const shareValueCents = toShareValueCents(useTenantSettings().data?.financial?.shareValueBdt);
  const sharesById = new Map((membersQuery.data ?? []).map((m) => [m.id, m.shares ?? 0]));
  // Owner-requested §15 exception: picking a member prefills shares × share value, in integer cents.
  const suggestedAmount = (memberId: string): string => {
    const shares = sharesById.get(memberId) ?? 0;
    return shareValueCents !== null && Number.isInteger(shares) && shares > 0
      ? fromCents(shareValueCents * shares)
      : "";
  };
  // #5c: bulk and single deposit must offer the SAME method list. Both now read
  // the tenant's configured methods (Settings → Governance); the local
  // Cash/Bank/Mobile/Check/Other enum is gone. The server accepts any
  // configured name verbatim.
  const paymentMethods = useTenantPaymentMethods();

  const memberOptions = (membersQuery.data ?? [])
    // Suspended members stay visible but disabled (marker explains why).
    .filter((m) => m.status === "active" || m.status === "suspended")
    .map((m) => ({
      value: m.id,
      label: memberDisplayName(m.name, m.status),
      caption: m.memberId,
      disabled: m.status === "suspended",
    }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const methodOptions = paymentMethods.map((m) => {
    const typeLabel = t(
      PAYMENT_TYPE_LABEL_KEY[m.type as PaymentType] ?? "settings.paymentMethods.types.other",
      { defaultValue: m.type },
    );
    const label = m.name.trim().toLowerCase() === typeLabel.trim().toLowerCase()
      ? m.name
      : `${m.name} · ${typeLabel}`;
    return { value: m.name, label };
  });
  // Period options come from the tenant fiscal calendar (§8) and, for this
  // posting form, only from the year open for posting; the month value is the
  // absolute YYYY-MM of the chosen fiscal month.
  //
  // The year is seeded from the header's fiscal-year selector (the app-wide
  // period) while the MONTH stays an explicit choice — a batch must never post
  // into a month nobody picked.
  const { yearOptionsIncluding, monthsFor, defaultPostableFiscalYear } = useFiscalPeriodOptions();
  const effectiveMonth: FiscalMonthValue = {
    fiscalYear: month.fiscalYear || defaultPostableFiscalYear,
    month: month.month,
  };
  const monthOptions = monthsFor(effectiveMonth.fiscalYear);

  const validRows = rows.filter(
    (r) => r.memberId && AMOUNT_RE.test(r.amount.trim()) && parseFloat(r.amount) > 0,
  );
  const total = centsToAmount(sumCents(validRows.map((r) => r.amount.trim())));

  const close = () => {
    setScope("multiple");
    setSingleDirty(false);
    setFundId(null);
    setMonth({ fiscalYear: null, month: null });
    setMethod(null);
    setRows([{ key: 0, memberId: "", amount: "" }]);
    setTouched(false);
    setMode("manual");
    setExcelSelected(new Set());
    requestRef.current = null;
    onClose();
  };

  const onSubmit = async () => {
    setTouched(true);
    if (!fundId || !month.month || validRows.length === 0) {
      toast.error(t("deposits.bulk.minOneRow"));
      return;
    }
    const monthKey = month.month;
    const deposits = validRows.map((r) => ({
      memberId: r.memberId,
      amount: parseFloat(r.amount.trim()),
      depositMonth: monthKey,
      date: `${monthKey}-01`,
    }));
    const fingerprint = JSON.stringify({ fundId, monthKey, method, deposits });
    if (requestRef.current?.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, key: crypto.randomUUID() };
    }

    setSubmitting(true);
    try {
      await apiClient("/finance/deposits/bulk", {
        method: "POST",
        body: JSON.stringify({
          fundId,
          requestKey: requestRef.current.key,
          commonMonth: monthKey,
          depositMethod: method || undefined,
          deposits,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast.success(t("deposits.bulk.successToast", { count: validRows.length }));
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TopSheet
      open={open}
      onClose={close}
      title={t("deposits.bulk.title")}
      subtitle={scope === "single" ? t("deposits.bulkSingle.subtitleSingle") : t("deposits.bulk.subtitle")}
      wide
      // Any populated field counts as unsaved work — the sheet confirms
      // before discarding it (report issue 7). The single-member grid owns its
      // own state and reports it back.
      isDirty={
        scope === "single"
          ? singleDirty
          : !!fundId ||
            !!month.month ||
            !!method ||
            rows.some((r) => r.memberId || r.amount.trim()) ||
            excelSelected.size > 0
      }
    >
      <ERPFormLayout>
        <div
          role="tablist"
          aria-label={t("deposits.bulk.title")}
          className="inline-flex rounded-lg border border-border/80 bg-muted/30 p-0.5"
        >
          {(["multiple", "single"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              onClick={() => setScope(value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                scope === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "multiple" ? <Users size={13} /> : <User size={13} />}
              {t(value === "multiple" ? "deposits.bulkSingle.scopeMultiple" : "deposits.bulkSingle.scopeSingle")}
            </button>
          ))}
        </div>

        {scope === "multiple" && (
          <div role="tablist" aria-label={t("deposits.bulk.title")} className="inline-flex rounded-lg border border-border/80 bg-muted/30 p-0.5">
            {(["manual", "excel"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "manual" ? <ListChecks size={13} /> : <FileSpreadsheet size={13} />}
                {t(value === "manual" ? "deposits.excel.modeManual" : "deposits.excel.modeExcel")}
              </button>
            ))}
          </div>
        )}

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
            {scope === "multiple" && mode === "manual" && (
              <div className="flex items-end pb-0.5">
                <p className="text-xs text-slate-500">
                  {t("deposits.bulk.runningTotal")}:{" "}
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                    {formatMoney(total, currency)}
                  </span>
                </p>
              </div>
            )}
          </ERPFormGrid>
          {/* The single-member shape picks its year inside the month grid (it
              needs the whole year's occupancy, not one month). */}
          {scope === "multiple" && (
            <ERPFiscalMonthPicker
              fiscalYears={yearOptionsIncluding(effectiveMonth.fiscalYear)}
              months={monthOptions}
              value={effectiveMonth}
              onChange={setMonth}
            />
          )}
        </ERPFormSection>

        {scope === "single" ? (
          <SingleMemberBulkDeposit
            fundId={fundId}
            method={method}
            shareValueCents={shareValueCents}
            onDirtyChange={handleSingleDirtyChange}
            onCancel={close}
            onSubmitted={close}
          />
        ) : mode === "excel" ? (
          <BulkExcelImport
            fundId={fundId}
            month={month}
            method={method}
            shareValueCents={shareValueCents}
            selected={excelSelected}
            onSelectedChange={setExcelSelected}
            onSubmitted={close}
          />
        ) : (
          <ERPFormSection title={`${t("deposits.bulk.rows")} (${validRows.length})`}>
            {shareValueCents !== null && (
              <p className="text-[11px] text-muted-foreground">
                {t("deposits.bulk.prefillHint", { value: formatMoney(fromCents(shareValueCents), currency) })}
              </p>
            )}
            <div className="space-y-2">
              <div className={`${ROW_GRID} text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`}>
                <span>{t("deposits.bulk.member")}</span>
                <span className="text-right">{t("deposits.bulk.shares")}</span>
                <span>{t("deposits.bulk.amount")}</span>
                <span />
              </div>
              {rows.map((row) => (
                <div key={row.key} className={`${ROW_GRID} items-start`}>
                  <AppDropdown
                    options={memberOptions.filter(
                      (o) => o.value === row.memberId || !rows.some((r) => r.memberId === o.value && r.key !== row.key),
                    )}
                    value={row.memberId || null}
                    onChange={(v) => {
                      const memberId = v ?? "";
                      // The amount belongs to the member, so a member change re-derives it (§5).
                      setRows((prev) =>
                        prev.map((r) =>
                          r.key !== row.key || r.memberId === memberId
                            ? r
                            : { ...r, memberId, amount: suggestedAmount(memberId) },
                        ),
                      );
                    }}
                    placeholder={t("deposits.bulk.selectMember")}
                  />
                  <div className="px-3 py-2 rounded-lg border text-xs font-mono text-right bg-muted/40 border-border/80 text-muted-foreground">
                    {row.memberId ? (sharesById.get(row.memberId) ?? 0) : "—"}
                  </div>
                  <NumericInput
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
        )}

        {/* The single-member grid renders its own action row (its totals and
            counts live there); everything else shares this footer. */}
        {scope === "multiple" && (
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={close} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            {mode === "manual" && (
              <Button variant="primary" size="sm" onClick={onSubmit} loading={submitting} loadingLabel={t("deposits.bulk.submitting")}>
                {t("deposits.bulk.submit", { count: validRows.length })}
              </Button>
            )}
          </div>
        )}
      </ERPFormLayout>
    </TopSheet>
  );
}
