"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import {
  ERPFormField,
  ERPFormGrid,
  ERPFormLayout,
  ERPFormSection,
} from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { toCents, fromCents } from "@/lib/money";
import { useTenantCurrency } from "@/lib/use-tenant-settings";
import type { Member } from "@/types";

interface TransferRow {
  key: number;
  toMemberId: string | null;
  shares: string;
  amount: string;
}

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 font-mono";

let rowKey = 0;
const nextRow = (): TransferRow => ({ key: ++rowKey, toMemberId: null, shares: "", amount: "" });

/**
 * Share division: move one member's shares, and optionally their contribution
 * balance, to one or more other members.
 *
 * This is the UI for `POST /api/finance/equity/transfer`, which existed without
 * one. The source member is the row it was opened from and is never selectable;
 * recipients start empty (§15). Amounts are moved through the ledger, so
 * `members.shares` is only ever changed by a recorded financial event.
 */
export function ShareDivisionModal({
  open,
  source,
  onClose,
}: {
  open: boolean;
  source: Member | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const currency = useTenantCurrency();

  const [rows, setRows] = useState<TransferRow[]>([nextRow()]);
  const [memo, setMemo] = useState("");
  const [giftAcknowledged, setGiftAcknowledged] = useState(false);
  const [touched, setTouched] = useState(false);
  // One reference per opened dialog: a retry of the same attempt collides with
  // the server's duplicate check instead of moving the equity twice.
  const [referenceNumber, setReferenceNumber] = useState<string | null>(null);

  // Prefill from the FULL record — the list row is masked for some roles and
  // always lags the ledger on share counts.
  const sourceQuery = useQuery({
    queryKey: ["members", source?.id],
    queryFn: () => apiClient<{ success: boolean; data: Member }>(`/members/${source?.id}`),
    enabled: open && Boolean(source?.id),
  });
  const holder = sourceQuery.data?.data ?? source;

  const recipientsQuery = useQuery({
    queryKey: ["members", "division-recipients"],
    queryFn: () =>
      apiClient<{ data: Array<{ id: string; name: string; memberId: string; status: string; shares: number }> }>(
        "/members",
        { params: { limit: 500, status: "active" } },
      ),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setRows([nextRow()]);
    setMemo("");
    setGiftAcknowledged(false);
    setTouched(false);
    setReferenceNumber(`EQT-${crypto.randomUUID().toUpperCase()}`);
  }, [open, source?.id]);

  const recipientOptions: DropdownOption[] = useMemo(
    () =>
      (recipientsQuery.data?.data ?? [])
        .filter((m) => m.id !== holder?.id)
        .map((m) => ({ value: m.id, label: `${m.name} (${m.memberId})` })),
    [recipientsQuery.data, holder?.id],
  );

  const sharesOut = rows.reduce((sum, r) => sum + (Number.parseInt(r.shares, 10) || 0), 0);
  const amountOutCents = rows.reduce((sum, r) => {
    const raw = r.amount.trim();
    // Only a well-formed 2dp amount contributes to the running total; anything
    // else is surfaced by the submit guard rather than silently summed.
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return sum;
    return sum + toCents(raw);
  }, 0);

  const heldShares = Number(holder?.shares ?? 0);
  const heldContributionCents = toCents(String(holder?.totalContributed ?? "0"));

  // A row that moves shares without any contribution is a gift: the recipient
  // gains a claim on future surplus they never funded, so it must be explicit.
  const hasGiftRow = rows.some(
    (r) => (Number.parseInt(r.shares, 10) || 0) > 0 && !r.amount.trim(),
  );

  const rowErrors = rows.map((r) => {
    const seen = rows.filter((o) => o.toMemberId && o.toMemberId === r.toMemberId).length;
    if (!r.toMemberId) return touched ? t("dividends.selectTarget") : "";
    if (seen > 1) return touched ? t("dividends.duplicateRecipient") : "";
    if (!/^\d+$/.test(r.shares) || Number.parseInt(r.shares, 10) < 1) {
      return touched ? t("dividends.insufficientShares") : "";
    }
    return "";
  });

  const overShares = sharesOut > heldShares;
  const overContribution = amountOutCents > heldContributionCents;
  const memoMissing = !memo.trim();
  const giftUnacknowledged = hasGiftRow && !giftAcknowledged;

  const valid =
    rows.length > 0 &&
    rows.every((r) => r.toMemberId) &&
    rowErrors.every((e) => !e) &&
    sharesOut > 0 &&
    !overShares &&
    !overContribution &&
    !memoMissing &&
    !giftUnacknowledged;

  const mutation = useMutation({
    mutationFn: () =>
      apiClient("/finance/equity/transfer", {
        method: "POST",
        body: JSON.stringify({
          fromMemberId: holder?.id,
          transfers: rows.map((r) => ({
            toMemberId: r.toMemberId,
            // Omitted means no contribution moves with the shares.
            amount: r.amount.trim() ? Number(r.amount.trim()) : undefined,
            shares: Number.parseInt(r.shares, 10),
          })),
          reason: memo.trim(),
          referenceNumber,
          giftAcknowledged: hasGiftRow ? giftAcknowledged : undefined,
        }),
      }),
    onSuccess: () => {
      toast.success(t("dividends.migrationSuccess"));
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : t("dividends.transferError")),
  });

  return (
    <TopSheet
      isOpen={open}
      onClose={onClose}
      title={t("dividends.migrationEngine")}
      subtitle={t("dividends.migrationSub")}
      wide
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<ArrowLeftRight size={13} />}
            loading={mutation.isPending}
            loadingLabel={t("dividends.transferring")}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              mutation.mutate();
            }}
          >
            {t("dividends.executeMigration")}
          </Button>
        </div>
      }
    >
      <ERPFormLayout>
        <ERPFormSection title={t("dividends.sourceMember")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg border border-border/80 bg-muted/20 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("members.form.name")}
              </p>
              <p className="mt-0.5 font-medium truncate">
                {holder ? `${holder.name} (${holder.memberId})` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("dividends.portfolio")}
              </p>
              <p className="mt-0.5 font-mono font-semibold">
                {heldShares} {t("dividends.sh")}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("dividends.totalContribution")}
              </p>
              <p className="mt-0.5 font-mono font-semibold">
                {formatMoney(fromCents(heldContributionCents), currency)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">{t("dividends.transferBanner")}</p>
        </ERPFormSection>

        <ERPFormSection title={t("dividends.reallocationPlan")}>
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.key} className="flex items-start gap-2">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <ERPFormField label={t("dividends.recipientMember")} required error={rowErrors[index]}>
                    <AppDropdown
                      options={recipientOptions}
                      value={row.toMemberId}
                      onChange={(v) => {
                        setRows((prev) =>
                          prev.map((r) => (r.key === row.key ? { ...r, toMemberId: v } : r)),
                        );
                      }}
                      placeholder={t("dividends.selectTarget")}
                    />
                  </ERPFormField>
                  <ERPFormField label={t("dividends.transferShares")} required>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.shares}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d]/g, "");
                        setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, shares: v } : r)));
                      }}
                      placeholder="0"
                      className={inputCls}
                    />
                  </ERPFormField>
                  <ERPFormField label={t("dividends.transferCapital")}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d.]/g, "");
                        setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, amount: v } : r)));
                      }}
                      placeholder="0.00"
                      className={inputCls}
                    />
                  </ERPFormField>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-5"
                  icon={<Trash2 size={13} />}
                  aria-label={t("dividends.removeRecipient")}
                  disabled={rows.length === 1}
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                />
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => setRows((prev) => [...prev, nextRow()])}
            >
              {t("dividends.addTarget")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-[11px]">
            <span className="uppercase tracking-wider text-muted-foreground">
              {t("dividends.sh")} {sharesOut} / {heldShares}
            </span>
            <span
              className={`uppercase tracking-wider ${
                overContribution ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
              }`}
            >
              {formatMoney(fromCents(amountOutCents), currency)} / {" "}
              {formatMoney(fromCents(heldContributionCents), currency)}
            </span>
          </div>

          {overShares && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
              {t("dividends.insufficientShares")}
            </p>
          )}
          {overContribution && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
              {t("dividends.insufficientContribution")}
            </p>
          )}

          {hasGiftRow && (
            <label className="flex items-start gap-2 mt-3 text-[11px] text-amber-700 dark:text-amber-400">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={giftAcknowledged}
                onChange={(e) => setGiftAcknowledged(e.target.checked)}
              />
              <span>{t("dividends.giftAcknowledge")}</span>
            </label>
          )}
        </ERPFormSection>

        <ERPFormSection title={t("dividends.distMemo")}>
          <ERPFormGrid columns={1}>
            <ERPFormField label={t("dividends.transferMemo")} required error={touched && memoMissing ? t("dividends.accuracyError") : undefined}>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={t("dividends.rationalePlaceholder")}
                className={inputCls}
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>
      </ERPFormLayout>
    </TopSheet>
  );
}
