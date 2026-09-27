"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency } from "@/components/deposits/shared";
import type { FundRow } from "./shared";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

function num(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Cascading inter-fund transfer. Source balance (minus its minimum buffer)
// must cover the amount before submit; the server re-validates atomically.
export function FundTransferModal({
  open,
  funds,
  presetSourceId,
  onClose,
}: {
  open: boolean;
  funds: FundRow[];
  presetSourceId?: string | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const currency = useTenantCurrency();

  const [sourceId, setSourceId] = useState<string | null>(presetSourceId ?? null);
  const [destId, setDestId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const active = funds.filter((f) => (f.status || "ACTIVE") === "ACTIVE");
  const source = active.find((f) => f.id === sourceId) ?? null;
  const sourceOptions = active.map((f) => ({ value: f.id, label: f.name }));
  // Destination excludes the source (cascading rule).
  const destOptions = active.filter((f) => f.id !== sourceId).map((f) => ({ value: f.id, label: f.name }));

  const available = source ? num(source.balance) - num(source.minimumBalance) : 0;
  const amountValid = AMOUNT_RE.test(amount.trim()) && parseFloat(amount) > 0;
  const sufficient = amountValid && parseFloat(amount) <= available + 1e-9;
  const ready = !!sourceId && !!destId && amountValid && sufficient;

  const close = () => {
    setSourceId(presetSourceId ?? null);
    setDestId(null);
    setAmount("");
    setReason("");
    setTouched(false);
    onClose();
  };

  const onSubmit = async () => {
    setTouched(true);
    if (!sourceId || !destId) {
      toast.error(t("funds.transferModal.selectBothError"));
      return;
    }
    if (sourceId === destId) {
      toast.error(t("funds.transferModal.sameFundError"));
      return;
    }
    if (!amountValid) {
      toast.error(t("funds.transferModal.invalidAmountError"));
      return;
    }
    if (!sufficient) {
      toast.error(t("funds.transferModal.insufficientError"));
      return;
    }
    setSubmitting(true);
    try {
      await apiClient("/funds/transfer", {
        method: "POST",
        body: JSON.stringify({
          fromFundId: sourceId,
          toFundId: destId,
          amount: amount.trim(),
          description: reason.trim() || undefined,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      toast.success(t("funds.transferModal.successToast", { amount: formatMoney(amount.trim(), currency) }));
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("funds.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TopSheet open={open} onClose={close} title={t("funds.transferModal.title")}>
      <ERPFormLayout>
        <ERPFormSection title={t("funds.transferModal.title")}>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("funds.transferModal.source")} required error={touched && !sourceId ? t("funds.transferModal.selectSource") : undefined}>
              <AppDropdown
                options={sourceOptions}
                value={sourceId}
                onChange={(v) => {
                  setSourceId(v);
                  if (v === destId) setDestId(null);
                }}
                placeholder={t("funds.transferModal.selectSource")}
              />
            </ERPFormField>
            <ERPFormField label={t("funds.transferModal.destination")} required error={touched && !destId ? t("funds.transferModal.selectDestination") : undefined}>
              <AppDropdown
                options={destOptions}
                value={destId}
                onChange={setDestId}
                placeholder={t("funds.transferModal.selectDestination")}
                disabled={!sourceId}
                disabledHint={t("funds.transferModal.selectSource")}
              />
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormGrid columns={2}>
            <ERPFormField
              label={t("funds.transferModal.amount")}
              required
              error={touched && !amountValid ? t("funds.transferModal.invalidAmountError") : touched && !sufficient ? t("funds.transferModal.insufficientError") : undefined}
            >
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </ERPFormField>
            <ERPFormField label={t("funds.transferModal.available")}>
              <p className="px-3 py-2 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 font-mono text-xs">
                {source ? formatMoney(Math.max(0, available).toFixed(2), currency) : "—"}
              </p>
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormField label={t("funds.transferModal.reason")}>
            <input
              type="text"
              placeholder={t("funds.transferModal.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputCls}
            />
          </ERPFormField>
        </ERPFormSection>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={close} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSubmit}
            loading={submitting}
            loadingLabel={t("funds.transferModal.submitting")}
            disabled={touched && !ready}
          >
            {t("funds.transferModal.submit")}
          </Button>
        </div>
      </ERPFormLayout>
    </TopSheet>
  );
}
