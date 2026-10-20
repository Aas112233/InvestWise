"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Lock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormSection } from "@/components/ui/erp-form-layout";
import { NumericInput } from "@/components/ui/numeric-input";
import { ApiError, apiClient } from "@/lib/api-client";
import { memberDisplayName } from "@/lib/member-display";
import { useLocale } from "@/lib/i18n";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { formatMoney } from "@/lib/formatters";
import { fromCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  centsToAmount,
  sumCents,
  useMemberDepositMonths,
  useMemberOptions,
  useTenantCurrency,
  type MemberDepositMonthCell,
} from "./shared";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Single-member, multi-month bulk collection.
 *
 * The desk picks ONE member and a financial year; the server returns that
 * member's fiscal-year months and marks the ones that already hold a deposit
 * (settled money or a pending request — the same rule the write path enforces).
 * Occupied months are greyed out and cannot be selected. The officer then picks
 * the remaining months, confirms the amount per month, and saves them as ONE
 * idempotent batch.
 *
 * Amounts stay strings (2dp) and every total is summed in integer cents — no
 * float arithmetic on money (§12).
 */
export function SingleMemberBulkDeposit({
  fundId,
  method,
  shareValueCents,
  onDirtyChange,
  onCancel,
  onSubmitted,
}: {
  /** Common fund for the whole batch (chosen once in the parent sheet). */
  fundId: string | null;
  /** Common payment method, or null for the server default. */
  method: string | null;
  /** Tenant share value in integer cents, or null until it loads. */
  shareValueCents: number | null;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const currency = useTenantCurrency();

  const membersQuery = useMemberOptions();
  const { yearOptions, monthsFor, defaultPostableFiscalYear } = useFiscalPeriodOptions();

  const [memberId, setMemberId] = useState<string | null>(null);
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);

  // Seeded from the header's fiscal year (the app-wide period) until the desk
  // picks another one for this collection.
  const fiscalYear = pickedYear || defaultPostableFiscalYear;
  const setFiscalYear = setPickedYear;

  const grid = useMemberDepositMonths(memberId, fiscalYear);

  // Suspended members stay visible but disabled — the marker explains why, and
  // the write path refuses them anyway (assertMemberNotSuspended).
  const memberOptions = useMemo(
    () =>
      (membersQuery.data ?? [])
        .filter((m) => m.status === "active" || m.status === "suspended")
        .map((m) => ({
          value: m.id,
          label: memberDisplayName(m.name, m.status),
          caption: m.memberId,
          disabled: m.status === "suspended",
        })),
    [membersQuery.data],
  );

  // Localized month labels, keyed by the absolute YYYY-MM the server returns.
  // Both sides expand the year with `fiscalMonthKeys`, so the keys always match;
  // an unknown key falls back to its raw form rather than a wrong label.
  const monthLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (fiscalYear) for (const option of monthsFor(fiscalYear)) map.set(option.value, option.label);
    return map;
  }, [fiscalYear, monthsFor]);

  const cells: MemberDepositMonthCell[] = useMemo(() => {
    if (grid.data?.months?.length) return grid.data.months;
    // Skeleton rows while the grid loads: the months of the chosen year, all
    // treated as unavailable so nothing can be selected before we know which
    // months are already taken.
    if (!fiscalYear || grid.isError) return [];
    return monthsFor(fiscalYear).map((option) => ({
      month: option.value,
      occupied: true,
      status: null,
      category: null,
      amount: null,
      transactionId: null,
      referenceNumber: null,
      pendingRequest: false,
    }));
  }, [grid.data, grid.isError, fiscalYear, monthsFor]);

  const availableMonths = useMemo(() => cells.filter((cell) => !cell.occupied), [cells]);

  /** shares × share value — the same prefill the multi-member sheet uses. */
  const suggestedAmount = useMemo(() => {
    if (shareValueCents === null) return "";
    const shares = grid.data?.member.shares ?? 0;
    if (!Number.isInteger(shares) || shares <= 0) return "";
    return fromCents(shareValueCents * shares);
  }, [grid.data, shareValueCents]);

  // Cascade (§5): a new member or a new year invalidates every month, amount
  // and selection made for the previous one — they belong to a different grid.
  const resetMonths = useCallback(() => {
    setSelected(new Set());
    setAmounts({});
    requestRef.current = null;
  }, []);

  // The seeded year is not user input — only a member, an explicit year pick or
  // a month selection makes the sheet dirty (report issue 7).
  const dirty = memberId !== null || pickedYear !== null || selected.size > 0;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const toggleMonth = (cell: MemberDepositMonthCell) => {
    if (cell.occupied) return;
    const willSelect = !selected.has(cell.month);
    setSelected((prev) => {
      const next = new Set(prev);
      if (willSelect) next.add(cell.month);
      else next.delete(cell.month);
      return next;
    });
    // Prefill only when the field is still untouched, so a typed amount is
    // never clobbered by a later select-all.
    if (willSelect) {
      setAmounts((current) =>
        current[cell.month]?.trim() ? current : { ...current, [cell.month]: suggestedAmount },
      );
    }
  };

  const selectAllAvailable = () => {
    const months = availableMonths.map((cell) => cell.month);
    setSelected(new Set(months));
    setAmounts((current) => {
      const next = { ...current };
      for (const month of months) if (!next[month]?.trim()) next[month] = suggestedAmount;
      return next;
    });
  };

  const selectedMonths = useMemo(() => [...selected].sort(), [selected]);
  const total = centsToAmount(
    sumCents(selectedMonths.map((month) => amounts[month]?.trim() || "0")),
  );
  const memberName = grid.data?.member.name ?? "";
  const memberLabel = memberName ? memberDisplayName(memberName, grid.data?.member.status ?? "active") : "";

  const onSubmit = async () => {
    if (!fundId) {
      toast.error(t("deposits.bulk.selectFund"));
      return;
    }
    if (!memberId || !fiscalYear) {
      toast.error(t("deposits.bulkSingle.selectMemberFirst"));
      return;
    }
    if (selectedMonths.length === 0) {
      toast.error(t("deposits.bulkSingle.minOneMonth"));
      return;
    }
    const invalid = selectedMonths.some((month) => {
      const value = amounts[month]?.trim() ?? "";
      return !AMOUNT_RE.test(value) || !(parseFloat(value) > 0);
    });
    if (invalid) {
      toast.error(t("deposits.bulkSingle.invalidAmount"));
      return;
    }

    const deposits = selectedMonths.map((month) => ({
      memberId,
      amount: parseFloat(amounts[month]!.trim()),
      depositMonth: month,
      // Ledger date = the first of the month the deposit is FOR; the month
      // itself is what the one-per-month rule and the reports key on.
      date: `${month}-01`,
    }));

    // Same idempotency contract as the multi-member sheet: an unchanged payload
    // keeps its key, so a retried request replays instead of double-posting.
    const fingerprint = JSON.stringify({ fundId, memberId, method, deposits });
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
          depositMethod: method || undefined,
          deposits,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast.success(
        t("deposits.bulkSingle.successToast", { count: deposits.length, member: memberLabel || memberName }),
      );
      onSubmitted();
    } catch (err) {
      // The month was taken between the grid load and this save (another
      // officer posted it): show the server's §11 message verbatim and reload
      // the grid so the month greys out instead of being retried blindly.
      toast.error(err instanceof ApiError ? err.message : t("deposits.loadFailed"));
      if (err instanceof ApiError && err.status === 409) {
        setSelected(new Set());
        await grid.refetch();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const loading = grid.isLoading;
  const failed = grid.isError;
  const noSelection = !memberId || !fiscalYear;

  return (
    <>
      <ERPFormSection title={t("deposits.bulkSingle.months")}>
        <ERPFormGrid columns={2}>
          <ERPFormField label={t("deposits.bulkSingle.member")} required>
            <AppDropdown
              options={memberOptions}
              value={memberId}
              onChange={(value) => {
                setMemberId(value);
                resetMonths();
              }}
              placeholder={t("deposits.bulkSingle.selectMember")}
              loading={membersQuery.isLoading}
            />
          </ERPFormField>
          <ERPFormField label={t("deposits.bulkSingle.fiscalYear")} required>
            <AppDropdown
              options={yearOptions}
              value={fiscalYear}
              onChange={(value) => {
                setFiscalYear(value);
                resetMonths();
              }}
              placeholder={t("deposits.bulkSingle.selectFiscalYear")}
            />
          </ERPFormField>
        </ERPFormGrid>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">{t("deposits.bulkSingle.monthsHint")}</p>
          {!noSelection && !failed && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("deposits.bulkSingle.selected", { count: selectedMonths.length })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAllAvailable}
                disabled={loading || availableMonths.length === 0 || submitting}
              >
                {t("deposits.bulkSingle.selectAll")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetMonths}
                disabled={selectedMonths.length === 0 || submitting}
              >
                {t("deposits.bulkSingle.clear")}
              </Button>
            </div>
          )}
        </div>

        {shareValueCents !== null && suggestedAmount && (
          <p className="text-[11px] text-muted-foreground">
            {t("deposits.bulkSingle.prefillHint", {
              value: formatMoney(fromCents(shareValueCents), currency),
            })}
          </p>
        )}

        {noSelection ? (
          <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
            {t("deposits.bulkSingle.selectMemberFirst")}
          </p>
        ) : failed ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-rose-300/60 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
          >
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle size={13} />
              {t("deposits.bulkSingle.loadFailed")}
            </span>
            <Button variant="outline" size="sm" icon={<RefreshCw size={12} />} onClick={() => grid.refetch()}>
              {t("deposits.bulkSingle.retry")}
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {loading && (
              <p className="text-[11px] text-muted-foreground">{t("deposits.bulkSingle.loading")}</p>
            )}
            {cells.map((cell) => {
              const isSelected = selected.has(cell.month);
              const locked = cell.occupied;
              const label = monthLabels.get(cell.month) ?? cell.month;
              const inputId = `bulk-month-${cell.month}`;
              return (
                <div
                  key={cell.month}
                  className={cn(
                    "grid grid-cols-[1.25rem_1fr_auto_8.5rem] items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                    locked
                      ? "border-border/60 bg-muted/40 opacity-60"
                      : isSelected
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/80 bg-card hover:border-border",
                  )}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={isSelected}
                    disabled={locked || loading || submitting}
                    onChange={() => toggleMonth(cell)}
                    aria-label={label}
                    className="h-3.5 w-3.5 accent-primary disabled:cursor-not-allowed"
                  />
                  <label
                    htmlFor={inputId}
                    className={cn(
                      "flex min-w-0 items-center gap-2 text-xs",
                      locked ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-foreground",
                    )}
                  >
                    <span className="truncate font-medium">{label}</span>
                    {locked ? (
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                          cell.pendingRequest
                            ? "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                            : "border-border/80 bg-muted text-muted-foreground",
                        )}
                      >
                        <Lock size={9} />
                        {cell.pendingRequest
                          ? t("deposits.bulkSingle.pendingRequest")
                          : t("deposits.bulkSingle.deposited")}
                      </span>
                    ) : isSelected ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        <Check size={9} />
                        {t("deposits.bulkSingle.chosen")}
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("deposits.bulkSingle.available")}
                      </span>
                    )}
                  </label>
                  <span className="whitespace-nowrap text-right font-mono text-[11px] text-muted-foreground">
                    {locked && cell.amount ? formatMoney(cell.amount, currency) : ""}
                  </span>
                  <NumericInput
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amounts[cell.month] ?? ""}
                    disabled={locked || !isSelected || submitting}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAmounts((current) => ({ ...current, [cell.month]: value }));
                    }}
                    aria-label={t("deposits.bulkSingle.amountFor", { month: label })}
                    className="rounded-lg border border-border/80 bg-card px-3 py-1.5 text-right font-mono text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground"
                  />
                </div>
              );
            })}
            <p className="pt-1 text-[11px] text-muted-foreground">{t("deposits.bulkSingle.lockedNote")}</p>
          </div>
        )}
      </ERPFormSection>

      <div className="flex items-center justify-between gap-2 pt-2">
        <p className="text-xs text-muted-foreground">
          {t("deposits.bulkSingle.total")}:{" "}
          <span className="font-mono font-semibold text-foreground">{formatMoney(total, currency)}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSubmit}
            loading={submitting}
            loadingLabel={t("deposits.bulkSingle.submitting")}
            disabled={selectedMonths.length === 0}
          >
            {t("deposits.bulkSingle.submit", { count: selectedMonths.length })}
          </Button>
        </div>
      </div>
    </>
  );
}
