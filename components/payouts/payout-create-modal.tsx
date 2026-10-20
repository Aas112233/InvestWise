"use client";

import { Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPDatePicker } from "@/components/ui/erp-date-picker";
import { ERPFormField, ERPFormGrid, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { centsToAmount, sumCents, useTenantCurrency, useTenantDateFormat } from "@/components/deposits/shared";
import { usePayoutFundOptions, useCreatePayoutPlan, useSuspendedMemberOptions } from "./shared";
import { formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { ApiError } from "@/lib/api-client";
import { toCents } from "@/lib/money";
import { useTenantSettings } from "@/lib/use-tenant-settings";
import { earliestFirstDueDate } from "@/lib/payout-schedule";

const MODE_ONE_TIME = "ONE_TIME";
const MODE_PHASED = "PHASED";

const INSTALLMENT_COUNTS = [2, 3, 4, 6, 12];
const INTERVALS = [1, 2, 3, 6];

/**
 * Creates a payout plan for a suspended member.
 *
 * The amount is never typed: it is the member's free balance, which the API
 * reserves in full. The form shows that figure and the resulting schedule so
 * the officer sees exactly what is being promised before submitting (§8: the
 * client orchestrates, the server decides).
 */
export function PayoutCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const currency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();
  const settings = useTenantSettings();

  const membersQuery = useSuspendedMemberOptions();
  const fundsQuery = usePayoutFundOptions();

  const [memberId, setMemberId] = useState<string | null>(null);
  const [fundId, setFundId] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [installmentCount, setInstallmentCount] = useState<number | null>(null);
  const [intervalMonths, setIntervalMonths] = useState<number | null>(null);
  const [firstDueDate, setFirstDueDate] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // Every field starts empty (§15) and a fresh member clears the choice that
  // depends on their balance (§5).
  useEffect(() => {
    if (open) {
      setMemberId(null);
      setFundId(null);
      setMode(null);
      setInstallmentCount(null);
      setIntervalMonths(null);
      setFirstDueDate(null);
      setReason("");
      setIsDirty(false);
    }
  }, [open]);

  const selectedMember = (membersQuery.data ?? []).find((m) => m.id === memberId) ?? null;
  // What the API will reserve for this member. Rendered from the same feed the
  // server reads, so the preview and the created plan cannot disagree.
  const freeBalanceCents = toCents(selectedMember?.totalContributed ?? "0");

  const noticeDays = Number(settings.data?.financial?.withdrawalNoticeDays ?? 0) || 0;
  const minFirstDue = useMemo(
    () => earliestFirstDueDate(new Date(), noticeDays).toISOString().slice(0, 10),
    [noticeDays],
  );

  const phases = mode === MODE_PHASED ? (installmentCount ?? 0) : mode === MODE_ONE_TIME ? 1 : 0;
  const spacing = mode === MODE_PHASED ? (intervalMonths ?? 0) : 1;

  // Local mirror of the server's split, for the preview only. The plan itself is
  // always built server-side from the locked balance.
  const preview = useMemo(() => {
    if (!phases || !firstDueDate || freeBalanceCents <= 0) return [];
    const base = Math.floor(freeBalanceCents / phases);
    const start = new Date(`${firstDueDate}T00:00:00.000Z`);
    return Array.from({ length: phases }, (_, i) => {
      const due = new Date(start.getTime());
      due.setUTCMonth(due.getUTCMonth() + i * (spacing || 1));
      return {
        sequence: i + 1,
        dueDate: due,
        amountCents: base + (i === phases - 1 ? freeBalanceCents - base * phases : 0),
      };
    });
  }, [phases, firstDueDate, freeBalanceCents, spacing]);

  const previewTotalCents = sumCents(preview.map((p) => centsToAmount(p.amountCents)));
  const scheduleMatches = preview.length > 0 && previewTotalCents === freeBalanceCents;

  const formValid =
    !!memberId &&
    !!fundId &&
    !!mode &&
    !!firstDueDate &&
    freeBalanceCents > 0 &&
    (mode === MODE_ONE_TIME || (!!installmentCount && !!intervalMonths)) &&
    reason.trim().length > 0;

  const createPlan = useCreatePayoutPlan();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValid || createPlan.isPending) return;
    try {
      await createPlan.mutateAsync({
        memberId,
        sourceFundId: fundId,
        installmentCount: mode === MODE_ONE_TIME ? 1 : Number(installmentCount),
        intervalMonths: mode === MODE_ONE_TIME ? 1 : Number(intervalMonths),
        firstDueDate,
        reason: reason.trim(),
      });
      toast.success(t("payouts.created", { defaultValue: "Payout plan created" }));
      onClose();
    } catch (err) {
      // §11: show the real server message (network failures already carry one).
      toast.error(err instanceof ApiError ? err.message : t("payouts.createFailed", { defaultValue: "Failed to create payout plan" }));
    }
  };

  const memberOptions = (membersQuery.data ?? []).map((m) => ({
    value: m.id,
    label: `${m.name} (${m.memberId}) — ${formatMoney(m.totalContributed ?? 0, currency)}`,
  }));

  return (
    <TopSheet
      open={open}
      onClose={onClose}
      isDirty={isDirty}
      onDiscard={onClose}
      title={t("payouts.createTitle", { defaultValue: "Settle a suspended member" })}
      description={t("payouts.createHint", {
        defaultValue:
          "The payout equals the member's free balance (deposits plus dividends, minus money invested in projects). Nothing is paid out until an officer confirms each installment.",
      })}
    >
      <form method="post" onSubmit={submit} className="space-y-6">
        <ERPFormSection title={t("payouts.section.member", { defaultValue: "Member and funding source" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("payouts.field.member", { defaultValue: "Suspended member" })} required>
              <AppDropdown
                options={memberOptions}
                value={memberId}
                onChange={(v) => {
                  setMemberId(v);
                  setIsDirty(true);
                }}
                loading={membersQuery.isLoading}
                error={membersQuery.isError ? t("payouts.loadFailed", { defaultValue: "Could not load payouts." }) : null}
                placeholder={t("payouts.field.memberPlaceholder", { defaultValue: "Select a suspended member…" })}
              />
            </ERPFormField>

            <ERPFormField label={t("payouts.field.fund", { defaultValue: "Paid from fund" })} required>
              <AppDropdown
                options={(fundsQuery.data ?? []).map((f) => ({ value: f.id, label: `${f.name} — ${formatMoney(f.balance, currency)}` }))}
                value={fundId}
                onChange={(v) => {
                  setFundId(v);
                  setIsDirty(true);
                }}
                loading={fundsQuery.isLoading}
                placeholder={t("payouts.field.fundPlaceholder", { defaultValue: "Select a deposit fund…" })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 dark:border-border bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {t("payouts.reservedAmount", { defaultValue: "Amount this plan will settle" })}
            </span>
            <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
              {selectedMember ? formatMoney(centsToAmount(freeBalanceCents), currency) : "—"}
            </span>
          </div>
          {selectedMember && freeBalanceCents <= 0 && (
            <p className="mt-2 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
              {t("payouts.zeroBalanceWarning", {
                defaultValue: "This member holds no free balance. Money inside a project is paid after that project is settled.",
              })}
            </p>
          )}
        </ERPFormSection>

        <ERPFormSection title={t("payouts.section.schedule", { defaultValue: "Payment schedule" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("payouts.field.mode", { defaultValue: "Payout type" })} required>
              <AppDropdown
                options={[
                  { value: MODE_ONE_TIME, label: t("payouts.mode.oneTime", { defaultValue: "One-time payment" }) },
                  { value: MODE_PHASED, label: t("payouts.mode.phased", { defaultValue: "In installments" }) },
                ]}
                value={mode}
                onChange={(v) => {
                  setMode(v);
                  setIsDirty(true);
                  // Parent change resets its children (§5).
                  if (v === MODE_ONE_TIME) {
                    setInstallmentCount(null);
                    setIntervalMonths(null);
                  }
                }}
                placeholder={t("payouts.field.modePlaceholder", { defaultValue: "Select payout type…" })}
              />
            </ERPFormField>

            <ERPFormField
              label={t("payouts.field.firstDueDate", { defaultValue: "First payment date" })}
              required
              hint={
                noticeDays > 0
                  ? t("payouts.noticePeriodHint", {
                      days: noticeDays,
                      earliest: minFirstDue,
                      defaultValue: `Notice period is ${noticeDays} days — the earliest date is ${minFirstDue}.`,
                    })
                  : undefined
              }
            >
              <ERPDatePicker
                value={firstDueDate}
                onChange={(iso) => {
                  setFirstDueDate(iso);
                  setIsDirty(true);
                }}
                displayFormat={dateFormat}
                min={minFirstDue}
                placeholder={t("payouts.field.firstDueDatePlaceholder", { defaultValue: "Select date…" })}
              />
            </ERPFormField>
          </ERPFormGrid>

          {mode === MODE_PHASED && (
            <ERPFormGrid cols={2}>
              <ERPFormField label={t("payouts.field.installments", { defaultValue: "Number of installments" })} required>
                <AppDropdown
                  options={INSTALLMENT_COUNTS.map((n) => ({
                    value: String(n),
                    label: t("payouts.field.installmentsOption", {
                      count: n,
                      defaultValue: `${n} installments`,
                    }),
                  }))}
                  value={installmentCount ? String(installmentCount) : null}
                  onChange={(v) => {
                    setInstallmentCount(v ? Number(v) : null);
                    setIsDirty(true);
                  }}
                  placeholder={t("payouts.field.installmentsPlaceholder", { defaultValue: "Select count…" })}
                />
              </ERPFormField>

              <ERPFormField label={t("payouts.field.interval", { defaultValue: "Every" })} required>
                <AppDropdown
                  options={INTERVALS.map((n) => ({
                    value: String(n),
                    label:
                      n === 1
                        ? t("payouts.field.intervalMonthly", { defaultValue: "1 month" })
                        : t("payouts.field.intervalOption", { months: n, defaultValue: `${n} months` }),
                  }))}
                  value={intervalMonths ? String(intervalMonths) : null}
                  onChange={(v) => {
                    setIntervalMonths(v ? Number(v) : null);
                    setIsDirty(true);
                  }}
                  placeholder={t("payouts.field.intervalPlaceholder", { defaultValue: "Select interval…" })}
                />
              </ERPFormField>
            </ERPFormGrid>
          )}

          {preview.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 dark:border-border overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/40 text-[10px] uppercase tracking-wider text-slate-500">
                {t("payouts.schedulePreview", { defaultValue: "Resulting schedule" })}
              </div>
              <ul className="divide-y divide-slate-200 dark:divide-border">
                {preview.map((p) => (
                  <li key={p.sequence} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="text-slate-500">
                      {t("payouts.phaseLabel", {
                        sequence: p.sequence,
                        defaultValue: `Phase ${p.sequence}`,
                      })}
                    </span>
                    <span className="text-slate-500">{p.dueDate.toISOString().slice(0, 10)}</span>
                    <span className="font-mono font-medium text-slate-800 dark:text-slate-100">
                      {formatMoney(centsToAmount(p.amountCents), currency)}
                    </span>
                  </li>
                ))}
              </ul>
              {!scheduleMatches && (
                <p className="px-3 py-2 text-[10px] text-rose-600 dark:text-rose-400">
                  {t("payouts.scheduleMismatch", { defaultValue: "Schedule preview does not match the balance." })}
                </p>
              )}
            </div>
          )}
        </ERPFormSection>

        <ERPFormSection title={t("payouts.section.reason", { defaultValue: "Reason" })}>
          <ERPFormField label={t("payouts.field.reason", { defaultValue: "Why is this member being settled" })} required>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setIsDirty(true);
              }}
              placeholder={t("payouts.field.reasonPlaceholder", {
                defaultValue: "e.g. Member resigned; balance settled per the committee decision of 12/10/2026",
              })}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </ERPFormField>
        </ERPFormSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-border">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={createPlan.isPending}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={createPlan.isPending} disabled={!formValid}>
            {!formValid && <Plus size={13} className="mr-1" />}
            {createPlan.isPending && <Loader2 size={13} className="mr-1 animate-spin" />}
            {t("payouts.createButton", { defaultValue: "Create payout plan" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
