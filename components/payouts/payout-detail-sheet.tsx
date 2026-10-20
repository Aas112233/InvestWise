"use client";

import { CheckCircle2, History, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { TopSheet } from "@/components/ui/top-sheet";
import { useTenantCurrency, useTenantDateFormat } from "@/components/deposits/shared";
import { formatDatePattern, formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { ApiError } from "@/lib/api-client";
import { useCancelPayoutPlan, usePayoutDetail, usePayPayoutInstallment, useTopUpPayoutPlan, type PayoutPlan } from "./shared";

// §11: the server message is the toast — including for network failures, which
// the API client already phrases for the user.
const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

/**
 * One payout plan: its phases, and the three officer actions.
 *
 * Paying is deliberately the only way cash leaves a fund here, and it is
 * confirmed with the amount shown, because the handover itself happens outside
 * the app (the app records what the officer says happened).
 */
export function PayoutDetailSheet({ planId, onClose }: { planId: string | null; onClose: () => void }) {
  const { t } = useLocale();
  const currency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const detail = usePayoutDetail(planId);
  const plan = detail.data as PayoutPlan | undefined;

  const [confirm, setConfirm] = useState<"pay" | "topUp" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  const pay = usePayPayoutInstallment(planId ?? "");
  const topUp = useTopUpPayoutPlan(planId ?? "");
  const cancel = useCancelPayoutPlan(planId ?? "");

  if (!planId) return null;

  const nextPhase = (plan?.installments ?? []).find((i) => i.status === "SCHEDULED");
  const isActive = plan?.status === "ACTIVE";
  const unpaidCentsLabel = formatMoney(plan?.remainingAmount ?? 0, currency);

  const runAction = async (kind: "pay" | "topUp" | "cancel") => {
    try {
      if (kind === "pay") {
        await pay.mutateAsync();
        toast.success(t("payouts.paidToast", { defaultValue: "Installment paid" }));
      } else if (kind === "topUp") {
        await topUp.mutateAsync();
        toast.success(t("payouts.topUpToast", { defaultValue: "Project return added to the plan" }));
      } else {
        if (!reason.trim()) {
          setReasonError(true);
          return;
        }
        await cancel.mutateAsync(reason.trim());
        toast.success(t("payouts.cancelledToast", { defaultValue: "Payout plan cancelled" }));
        setConfirm(null);
        setReason("");
        onClose();
      }
    } catch (err) {
      toast.error(message(err, t("payouts.actionFailed", { defaultValue: "Action failed" })));
    }
  };

  const statusTone = (s?: string) =>
    s === "ACTIVE" ? "amber" : s === "COMPLETED" ? "emerald" : "slate";

  return (
    <>
      <TopSheet
        open
        onClose={onClose}
        maxWidth="3xl"
        title={t("payouts.detailTitle", { defaultValue: "Payout plan" })}
        subtitle={plan ? `${plan.memberName ?? ""} (${plan.memberCode ?? ""})` : undefined}
      >
        {!plan && detail.isLoading && (
          <p className="py-8 text-center text-xs text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p>
        )}
        {plan && detail.isError && (
          <p className="py-8 text-center text-xs text-rose-600">{t("payouts.loadFailed", { defaultValue: "Could not load this plan." })}</p>
        )}

        {plan && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: t("payouts.column.total", { defaultValue: "Settlement total" }), value: formatMoney(plan.totalAmount, currency) },
                { label: t("payouts.column.paid", { defaultValue: "Paid" }), value: formatMoney(plan.paidAmount, currency) },
                { label: t("payouts.column.remaining", { defaultValue: "Remaining" }), value: unpaidCentsLabel },
                { label: t("payouts.detail.fund", { defaultValue: "Paid from" }), value: plan.fundName ?? "—" },
              ].map((card) => (
                <div key={card.label} className="rounded-lg border border-slate-200 dark:border-border px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">{card.label}</p>
                  <p className="mt-1 text-sm font-semibold font-mono text-slate-800 dark:text-slate-100 truncate">{card.value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <StatusBadge tone={statusTone(plan.status)}>{t(`payouts.status.${plan.status}`, { defaultValue: plan.status })}</StatusBadge>
                <span className="text-slate-500">
                  {t("payouts.detail.schedule", {
                    count: plan.installmentCount,
                    interval: plan.intervalMonths,
                    defaultValue: `${plan.installmentCount} phase(s), every ${plan.intervalMonths} month(s)`,
                  })}
                </span>
              </div>
              <span className="text-slate-400">{formatDatePattern(plan.firstDueDate, dateFormat)}</span>
            </div>

            {plan.awaitingProjectSettlement && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {t("payouts.awaitingSettlement", {
                  defaultValue:
                    "This member still holds capital in an unsettled project. Settle that project, then add its return as another installment.",
                })}
              </div>
            )}

            <div className="rounded-lg border border-slate-200 dark:border-border overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/40 text-[10px] uppercase tracking-wider text-slate-500">
                {t("payouts.phases", { defaultValue: "Installments" })}
              </div>
              <ul className="divide-y divide-slate-200 dark:divide-border">
                {(plan.installments ?? []).map((phase) => (
                  <li key={phase.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <span className="w-16 text-slate-500">
                      {t("payouts.phaseLabel", { sequence: phase.sequence, defaultValue: `Phase ${phase.sequence}` })}
                    </span>
                    <span className="flex-1 text-slate-500">{formatDatePattern(phase.dueDate, dateFormat)}</span>
                    <span className="font-mono text-slate-800 dark:text-slate-100">{formatMoney(phase.amount, currency)}</span>
                    <StatusBadge
                      tone={phase.status === "PAID" ? "emerald" : phase.status === "CANCELLED" ? "slate" : "amber"}
                    >
                      {t(`payouts.phaseStatus.${phase.status}`, { defaultValue: phase.status })}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">{t("payouts.column.reason", { defaultValue: "Reason" })}</p>
              <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">{plan.reason}</p>
            </div>
            {plan.cancelReason && (
              <p className="text-xs text-slate-500">
                {t("payouts.detail.cancelReason", { defaultValue: "Cancelled" })}: {plan.cancelReason}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-slate-200 dark:border-border">
              {isActive && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<History size={13} />}
                    onClick={() => setConfirm("topUp")}
                  >
                    {t("payouts.addProjectReturn", { defaultValue: "Add project return" })}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    icon={<XCircle size={13} />}
                    onClick={() => {
                      setReason("");
                      setReasonError(false);
                      setConfirm("cancel");
                    }}
                  >
                    {t("payouts.cancelPlan", { defaultValue: "Cancel plan" })}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<CheckCircle2 size={13} />}
                    disabled={!nextPhase}
                    onClick={() => setConfirm("pay")}
                  >
                    {t("payouts.payNext", { defaultValue: "Pay next installment" })}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t("common.close", { defaultValue: "Close" })}
              </Button>
            </div>
          </div>
        )}
      </TopSheet>

      <ERPConfirmDialog
        isOpen={confirm === "pay"}
        title={t("payouts.confirm.payTitle", { defaultValue: "Record this payout" })}
        description={t("payouts.confirm.payBody", {
          amount: nextPhase ? formatMoney(nextPhase.amount, currency) : "—",
          sequence: nextPhase?.sequence ?? 0,
          defaultValue: `Confirm that ${nextPhase ? formatMoney(nextPhase.amount, currency) : ""} has been handed to the member for phase ${nextPhase?.sequence ?? ""}. This debits ${plan?.fundName ?? "the fund"} and cannot be undone from this screen.`,
        })}
        confirmLabel={t("payouts.confirm.payConfirm", { defaultValue: "Mark as paid" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="primary"
        pending={pay.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => runAction("pay")}
      />

      <ERPConfirmDialog
        isOpen={confirm === "topUp"}
        title={t("payouts.confirm.topUpTitle", { defaultValue: "Add the project return" })}
        description={t("payouts.confirm.topUpBody", {
          defaultValue:
            "Adds whatever the member's balance now holds (from a settled project) as one more installment, due immediately. Nothing is paid yet.",
        })}
        confirmLabel={t("payouts.addProjectReturn", { defaultValue: "Add project return" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="primary"
        pending={topUp.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => runAction("topUp")}
      />

      <ERPConfirmDialog
        isOpen={confirm === "cancel"}
        title={t("payouts.confirm.cancelTitle", { defaultValue: "Cancel this payout plan" })}
        description={t("payouts.confirm.cancelBody", {
          amount: unpaidCentsLabel,
          defaultValue: `The unpaid remainder (${unpaidCentsLabel}) returns to the member's balance. Installments already paid stay in the ledger.`,
        })}
        confirmLabel={t("payouts.cancelPlan", { defaultValue: "Cancel plan" })}
        cancelLabel={t("common.close", { defaultValue: "Close" })}
        pending={cancel.isPending}
        extra={
          <div>
            <input
              autoFocus
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (e.target.value.trim()) setReasonError(false);
              }}
              placeholder={t("payouts.confirm.cancelReasonPlaceholder", { defaultValue: "Reason for cancelling (required)" })}
              className={`w-full px-3 py-2 text-xs bg-card border rounded-lg outline-none focus:border-primary ${
                reasonError ? "border-rose-400" : "border-border/80"
              }`}
            />
            {reasonError && (
              <p className="mt-1 text-[10px] text-rose-600">
                {t("payouts.confirm.cancelReasonRequired", { defaultValue: "A reason is required" })}
              </p>
            )}
          </div>
        }
        onClose={() => setConfirm(null)}
        onConfirm={() => runAction("cancel")}
      />
    </>
  );
}
