"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CheckCircle2, Loader2 } from "lucide-react";
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
import { useFundsList } from "@/components/funds/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency, useTenantSettings } from "@/lib/use-tenant-settings";

interface MemberBreakdownRow {
  /** Member uuid — stable key for the preview table. */
  memberId: string;
  /** Human-readable member code (MEM-0001). */
  memberIdStr: string;
  name: string;
  shares: number;
  grossAmount: string;
  ratePerShare: string;
}

interface CalculationResult {
  grossEarnings: string;
  statutoryReservePercent: string;
  statutoryReserveAmount: string;
  netDistributable: string;
  totalActiveShares: number;
  ratePerShare: string;
  memberBreakdown: MemberBreakdownRow[];
  recipientCount: number;
}

/**
 * Dividend payout configuration.
 *
 * The preview and the payout post the SAME payload to endpoints that now share
 * one calculation engine, so what is authorized here is what gets paid. The run
 * also carries a client-generated reference: a double submit or a retry hits
 * the server's duplicate check instead of paying the members twice.
 */
export function DividendDistributionModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const currency = useTenantCurrency();
  const { data: settings } = useTenantSettings();

  const [distributableFundId, setDistributableFundId] = useState<string | null>(null);
  const [reserveFundId, setReserveFundId] = useState<string | null>(null);
  const [grossEarnings, setGrossEarnings] = useState("");
  const [reservePercent, setReservePercent] = useState("");
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [runReference, setRunReference] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // The tenant's configured retention is the starting point, not a hardcoded
  // 10% — and it is still editable per run.
  const configuredReservePercent = settings?.financial?.statutoryReservePercent;
  useEffect(() => {
    if (!isOpen) return;
    setReservePercent(
      configuredReservePercent === undefined || configuredReservePercent === null
        ? ""
        : String(configuredReservePercent),
    );
  }, [isOpen, configuredReservePercent]);

  useEffect(() => {
    if (isOpen) return;
    setDistributableFundId(null);
    setReserveFundId(null);
    setGrossEarnings("");
    setCalculation(null);
    setRunReference(null);
    setTouched(false);
  }, [isOpen]);

  const fundsQuery = useFundsList({ type: null, status: "ACTIVE" });
  const funds = useMemo(() => fundsQuery.data?.data ?? [], [fundsQuery.data]);

  const reserveFunds = useMemo(
    () => funds.filter((f) => (f.type ?? "").toUpperCase() === "RESERVE"),
    [funds],
  );

  const sourceOptions: DropdownOption[] = funds
    // A reserve fund is a destination, never a payout source.
    .filter((f) => (f.type ?? "").toUpperCase() !== "RESERVE")
    .map((f) => ({ value: f.id, label: `${f.name} (${formatMoney(f.balance, currency)})` }));

  const reserveOptions: DropdownOption[] = reserveFunds.map((f) => ({
    value: f.id,
    label: f.name,
  }));

  // Any input change invalidates the preview: an authorization must match the
  // numbers it was granted on.
  const invalidate = () => {
    setCalculation(null);
    setRunReference(null);
  };

  const payload = () => ({
    grossEarnings,
    distributableFundId,
    statutoryReservePercent: reservePercent,
    reserveFundId: reserveFundId || undefined,
  });

  const canSubmit = Boolean(distributableFundId) && /^\d+(\.\d{1,2})?$/.test(grossEarnings);

  const simulateMutation = useMutation({
    mutationFn: () =>
      apiClient<{ success: boolean; data: CalculationResult }>("/dividends/calculate", {
        method: "POST",
        body: JSON.stringify(payload()),
      }),
    onSuccess: (res) => {
      setCalculation(res.data ?? null);
      // One reference per authorized preview, reused on retry (§12).
      setRunReference(`DIV-${crypto.randomUUID().toUpperCase()}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("dividends.simulationFailed")),
  });

  const distributeMutation = useMutation({
    mutationFn: () =>
      apiClient("/dividends/distribute", {
        method: "POST",
        body: JSON.stringify({ ...payload(), referenceNumber: runReference }),
      }),
    onSuccess: () => {
      toast.success(t("dividends.distSuccess"));
      queryClient.invalidateQueries({ queryKey: ["dividends"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("dividends.distError")),
  });

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("dividends.payoutConfig")}
      subtitle={t("dividends.configSub")}
      wide
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <Button variant="ghost" onClick={onClose} disabled={distributeMutation.isPending}>
            {t("common.cancel")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Calculator size={13} />}
              onClick={() => {
                // Validate on the first attempt rather than disabling silently,
                // so the reason is always stated on screen (§11).
                if (!canSubmit) {
                  setTouched(true);
                  return;
                }
                simulateMutation.mutate();
              }}
              loading={simulateMutation.isPending}
              loadingLabel={t("common.preview")}
            >
              {t("common.preview")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<CheckCircle2 size={13} />}
              onClick={() => distributeMutation.mutate()}
              loading={distributeMutation.isPending}
              loadingLabel={t("dividends.distributing")}
              // Authorization requires a fresh preview of these exact inputs.
              disabled={!calculation || !runReference || !canSubmit}
            >
              {t("dividends.authorize")}
            </Button>
          </div>
        </div>
      }
    >
      <ERPFormLayout>
        <ERPFormSection title={t("dividends.distType")} description={t("dividends.configSub")}>
          <ERPFormGrid columns={2}>
            <ERPFormField
              label={t("dividends.selectSourceFund")}
              required
              error={touched && !distributableFundId ? t("dividends.selectFundError") : undefined}
            >
              <AppDropdown
                options={sourceOptions}
                value={distributableFundId}
                onChange={(v) => {
                  setDistributableFundId(v);
                  invalidate();
                }}
                placeholder={t("dividends.selectPrimaryFund")}
              />
            </ERPFormField>

            <ERPFormField label={t("dividends.reserveFund")} required>
              <AppDropdown
                options={reserveOptions}
                value={reserveFundId}
                onChange={(v) => {
                  setReserveFundId(v);
                  invalidate();
                }}
                placeholder={t("dividends.selectReserveFundPlaceholder")}
              />
            </ERPFormField>

            <ERPFormField
              label={t("dividends.payoutAmount")}
              required
              error={touched && !canSubmit ? t("dividends.invalidAmount") : undefined}
            >
              <input
                type="text"
                inputMode="decimal"
                value={grossEarnings}
                onChange={(e) => {
                  setGrossEarnings(e.target.value.trim());
                  invalidate();
                }}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 font-mono"
              />
            </ERPFormField>

            <ERPFormField label={t("dividends.reservePercent")} required>
              <input
                type="text"
                inputMode="decimal"
                value={reservePercent}
                onChange={(e) => {
                  setReservePercent(e.target.value.trim());
                  invalidate();
                }}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 font-mono"
              />
            </ERPFormField>
          </ERPFormGrid>

          {reserveFunds.length === 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {t("dividends.noReserveFund")}
            </p>
          )}
        </ERPFormSection>

        {calculation ? (
          <ERPFormSection title={t("dividends.payoutPreview")} description={t("dividends.logicDesc")}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-muted/30 rounded-lg border border-border/80 text-xs">
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("dividends.grossSurplus")}
                </span>
                <span className="font-mono font-semibold">{formatMoney(calculation.grossEarnings, currency)}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("dividends.statutoryReserve")} ({calculation.statutoryReservePercent}%)
                </span>
                <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                  {formatMoney(calculation.statutoryReserveAmount, currency)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("dividends.netDistributable")}
                </span>
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatMoney(calculation.netDistributable, currency)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("dividends.valuePerShare")}
                </span>
                <span className="font-mono font-semibold">
                  {formatMoney(calculation.ratePerShare, currency)}
                </span>
              </div>
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("dividends.floatingShares")}: {calculation.totalActiveShares} ·{" "}
              {t("dividends.totalRecipients")}: {calculation.recipientCount}
            </p>

            <div className="mt-3">
              <span className="text-xs font-semibold block mb-2">{t("dividends.stakeholderMatrix")}</span>
              {calculation.memberBreakdown.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border/80 rounded-lg">
                  {t("dividends.noActiveShares")}
                </p>
              ) : (
                <div className="max-h-60 overflow-y-auto border border-border/80 rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
                          {t("dividends.recipient")}
                        </th>
                        <th className="text-center px-3 py-2 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
                          {t("members.columns.shares")}
                        </th>
                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
                          {t("dividends.payout")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {calculation.memberBreakdown.map((row) => (
                        <tr key={row.memberId} className="hover:bg-muted/30">
                          <td className="px-3 py-2">
                            {row.name}{" "}
                            <span className="text-muted-foreground font-mono text-[10px]">({row.memberIdStr})</span>
                          </td>
                          <td className="px-3 py-2 text-center font-mono">{row.shares}</td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-700 dark:text-emerald-400">
                            {formatMoney(row.grossAmount, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </ERPFormSection>
        ) : (
          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border/80 rounded-lg">
            {t("dividends.previewEmpty")}
          </p>
        )}
      </ERPFormLayout>
    </TopSheet>
  );
}
