"use client";

// Per-tenant subscription lifecycle control (port of the Pathshala-Pro
// SubscriptionControlPanel, re-skinned for InvestWise). Reads via the
// read-only GET /api/admin/subscriptions/[tenantId] view and writes through
// POST /api/admin/billing — the single validated/audited mutation path.
// Patch construction (including the grace-anchor rule) lives in
// lib/admin/subscription-patch.ts so it is unit-tested without a DOM.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Hourglass, Loader2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { daysUntil } from "@/lib/admin/date-input";
import {
  buildSubscriptionPatch,
  deriveGraceDays,
  isoToLocalInput,
  type SubscriptionBaseline,
} from "@/lib/admin/subscription-patch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { ERPFormField, ERPFormGrid } from "@/components/ui/erp-form-layout";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/formatters";

const STATUSES = ["trial", "active", "past_due", "suspended", "cancelled", "expired"] as const;

interface PlanDto {
  id: string;
  slug: string;
  name: string;
  priceMonthly: string | number | null;
  maxUsers: number | null;
  isActive: boolean | null;
}

interface SubscriptionDto {
  id: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  planId: string | null;
  planSlug: string | null;
  planName: string | null;
  priceMonthly: string | number | null;
  planMaxUsers: number | null;
  planIsActive: boolean | null;
}

interface HistoryDto {
  id: string;
  action: string;
  actorEmail: string | null;
  fromPlanId: string | null;
  toPlanId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  createdAt: string | null;
}

interface LifecycleResponse {
  success: boolean;
  data: {
    tenant: { id: string; slug: string; name: string };
    subscription: SubscriptionDto | null;
    history: HistoryDto[];
    plans: PlanDto[];
  };
}

function toneFor(status: string | null | undefined): "emerald" | "amber" | "rose" | "cyan" | "slate" {
  if (!status) return "slate";
  const s = status.toLowerCase();
  if (s === "active") return "emerald";
  if (s === "trial") return "cyan";
  if (s === "past_due") return "amber";
  if (s === "suspended" || s === "cancelled" || s === "expired") return "rose";
  return "slate";
}

interface Props {
  tenantId: string;
  onUpdated?: () => void;
}

export function SubscriptionControlPanel({ tenantId, onUpdated }: Props) {
  const { t } = useLocale();
  const qc = useQueryClient();

  const query = useQuery<LifecycleResponse>({
    queryKey: ["admin", "subscriptions", tenantId],
    queryFn: () => apiClient<LifecycleResponse>(`/admin/subscriptions/${tenantId}`),
    staleTime: 15_000,
  });

  const subscription = query.data?.data.subscription ?? null;
  const plans = useMemo(() => query.data?.data.plans ?? [], [query.data]);
  const history = useMemo(() => query.data?.data.history ?? [], [query.data]);

  const baseline: SubscriptionBaseline = useMemo(
    () => ({
      status: subscription?.status ?? null,
      planSlug: subscription?.planSlug ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      trialEndsAt: subscription?.trialEndsAt ?? null,
      graceEndsAt: subscription?.graceEndsAt ?? null,
    }),
    [subscription],
  );

  // Draft state, re-seeded when a refetch lands. Render-phase sync (the
  // documented "adjust state when input changes" pattern) instead of an
  // effect: a fresh subscription object means fresh data, and any in-progress
  // edit is stale the moment the row reloads.
  const [draft, setDraft] = useState(() => seedDraft(baseline));
  const [syncedBaseline, setSyncedBaseline] = useState(baseline);
  if (syncedBaseline !== baseline) {
    setSyncedBaseline(baseline);
    setDraft(seedDraft(baseline));
  }

  const patch = buildSubscriptionPatch(baseline, draft);
  const dirty = patch.ok && patch.changedFields.length > 0;

  // Effective deadline the expiry sweep acts on — mirrors the billing table:
  // a trial counts its trial deadline, everything else the paid-through date.
  const effectiveStatus = draft.status || baseline.status || "";
  const deadlineIso =
    effectiveStatus === "trial"
      ? (draft.trialEndsAt || baseline.trialEndsAt || draft.currentPeriodEnd || baseline.currentPeriodEnd)
      : (draft.currentPeriodEnd || baseline.currentPeriodEnd);
  const days = daysUntil(deadlineIso ? new Date(deadlineIso) : null);
  const settled = ["suspended", "cancelled", "expired"].includes(effectiveStatus);

  // Compare against the moment the view loaded, not Date.now(): a render must
  // be pure, and staleness of seconds does not matter for a day-granular banner.
  const graceRunning =
    subscription?.graceEndsAt != null &&
    new Date(subscription.graceEndsAt).getTime() > query.dataUpdatedAt;

  const [confirmOpen, setConfirmOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!patch.ok) throw new Error(patch.message);
      return apiClient("/admin/billing", {
        method: "POST",
        body: JSON.stringify({ tenantId, ...patch.patch }),
      });
    },
    onSuccess: () => {
      setConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "subscriptions", tenantId] });
      void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success(t("admin.subscription.saved", { defaultValue: "Subscription updated" }));
      onUpdated?.();
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.subscription.saveFailed", { defaultValue: "Subscription update failed" }),
      ),
  });

  const planNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of plans) m.set(p.id, p.name);
    return m;
  }, [plans]);

  const planOptions: DropdownOption[] = useMemo(
    () =>
      plans
        .filter((p) => p.isActive !== false || p.slug === baseline.planSlug)
        .map((p) => ({
          value: p.slug,
          label: p.name,
          caption: p.priceMonthly != null && p.priceMonthly !== "" ? String(p.priceMonthly) : undefined,
        })),
    [plans, baseline.planSlug],
  );

  const summary = useMemo(() => {
    if (!patch.ok) return patch.message;
    const parts: string[] = [];
    for (const f of patch.changedFields) {
      if (f === "status") parts.push(`${baseline.status ?? "none"} → ${draft.status}`);
      if (f === "plan") parts.push(`${t("admin.billing.plan", { defaultValue: "Plan" })} → ${draft.planSlug ?? "—"}`);
      if (f === "currentPeriodEnd") parts.push(`${t("admin.subscription.paidThrough", { defaultValue: "Paid through" })} → ${draft.currentPeriodEnd || "—"}`);
      if (f === "trialEndsAt") parts.push(`${t("admin.subscription.trialEnds", { defaultValue: "Trial ends" })} → ${draft.trialEndsAt || "—"}`);
      if (f === "gracePeriodDays") parts.push(`${t("admin.subscription.graceDays", { defaultValue: "Grace days" })} → ${draft.graceDays}`);
    }
    return parts.join(" · ");
  }, [patch, baseline.status, draft, t]);

  return (
    <Card className="border border-border/80 shadow-xs">
      <CardHeader className="p-4 pb-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {t("admin.subscription.title", { defaultValue: "Subscription Lifecycle" })}
          </CardTitle>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(seedDraft(baseline))}
                className="h-7 text-xs"
                disabled={saveMutation.isPending}
              >
                {t("common.cancel", { defaultValue: "Discard" })}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="h-7 text-xs gap-1.5"
              aria-label={t("common.refresh", { defaultValue: "Refresh" })}
            >
              {query.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!patch.ok) {
                  toast.error(patch.message);
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={!dirty || saveMutation.isPending}
              className="h-7 text-xs gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {t("common.save", { defaultValue: "Save" })}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {query.isLoading ? (
          <p className="text-xs text-muted-foreground py-4">{t("common.loading", { defaultValue: "Loading…" })}</p>
        ) : query.isError || !subscription ? (
          <p className="text-xs text-muted-foreground py-4">
            {query.isError
              ? t("admin.subscription.loadFailed", { defaultValue: "Could not load subscription" })
              : t("admin.subscription.none", { defaultValue: "No subscription row yet — one is created with the first change." })}
          </p>
        ) : (
          <>
            {/* Current state strip */}
            <div className="flex items-center gap-3 flex-wrap rounded-lg border border-border/60 bg-muted/20 p-3">
              <StatusBadge tone={toneFor(subscription.status)} label={subscription.status} />
              <span className="text-xs text-muted-foreground">
                {subscription.planName ?? subscription.planSlug ?? t("admin.subscription.noPlan", { defaultValue: "No plan" })}
                {subscription.priceMonthly != null && subscription.priceMonthly !== "" ? ` · ${subscription.priceMonthly}` : ""}
              </span>
              {days !== null && !settled && (
                <span
                  className={`text-[11px] font-mono ${
                    days < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : days <= 7
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {days < 0
                    ? t("admin.billing.overdueBy", { defaultValue: "{days}d overdue", days: Math.abs(days) })
                    : t("admin.billing.daysLeft", { defaultValue: "{days}d left", days })}
                </span>
              )}
            </div>

            {graceRunning && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200">
                <Hourglass className="h-3.5 w-3.5 shrink-0" />
                {t("admin.subscription.graceActive", {
                  defaultValue: "Grace window runs until {date}",
                  date: formatDate(subscription.graceEndsAt as string),
                })}
              </div>
            )}
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("admin.billing.subscription", { defaultValue: "Subscription" })} required>
                <AppDropdown
                  value={draft.status || null}
                  onChange={(v) => setDraft((d) => ({ ...d, status: v ?? d.status }))}
                  options={STATUSES.map((s) => ({ value: s, label: s }))}
                  clearable={false}
                  placeholder={t("admin.billing.selectStatus", { defaultValue: "Select status…" })}
                />
              </ERPFormField>
              <ERPFormField
                label={t("admin.billing.plan", { defaultValue: "Plan" })}
                hint={t("admin.billing.planHint", { defaultValue: "Empty keeps the current plan." })}
              >
                <AppDropdown
                  value={draft.planSlug}
                  onChange={(v) => setDraft((d) => ({ ...d, planSlug: v }))}
                  options={planOptions}
                  placeholder={t("admin.billing.selectPlan", { defaultValue: "Select plan…" })}
                />
              </ERPFormField>
              <ERPFormField
                label={t("admin.subscription.paidThrough", { defaultValue: "Paid through" })}
                hint={t("admin.subscription.paidThroughHint", {
                  defaultValue: "The sweep moves the tenant to past_due when this instant passes.",
                })}
              >
                <Input
                  type="datetime-local"
                  value={draft.currentPeriodEnd}
                  onChange={(e) => setDraft((d) => ({ ...d, currentPeriodEnd: e.target.value }))}
                  className="text-xs font-mono"
                />
              </ERPFormField>
              <ERPFormField
                label={t("admin.subscription.trialEnds", { defaultValue: "Trial ends" })}
                hint={t("admin.subscription.trialEndsHint", {
                  defaultValue: "Only consulted while the status is trial.",
                })}
              >
                <Input
                  type="datetime-local"
                  value={draft.trialEndsAt}
                  onChange={(e) => setDraft((d) => ({ ...d, trialEndsAt: e.target.value }))}
                  className="text-xs font-mono"
                />
              </ERPFormField>
              <ERPFormField
                label={t("admin.subscription.graceDays", { defaultValue: "Grace days" })}
                hint={t("admin.subscription.graceDaysHint", {
                  defaultValue: "0–3650. Measured from the paid-through date; saved together with it.",
                })}
              >
                <Input
                  type="number"
                  min={0}
                  max={3650}
                  value={draft.graceDays}
                  onChange={(e) => setDraft((d) => ({ ...d, graceDays: e.target.value }))}
                  placeholder="0"
                  className="text-xs font-mono"
                />
              </ERPFormField>
              <ERPFormField label={t("admin.billing.reason", { defaultValue: "Reason" })}>
                <input
                  type="text"
                  value={draft.reason}
                  maxLength={500}
                  onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
                  placeholder={t("admin.billing.reasonPlaceholder", {
                    defaultValue: "Why is this changing? (recorded in the audit log)",
                  })}
                  className="w-full px-3 py-2 rounded-xl border border-border/80 bg-card text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
              </ERPFormField>
            </ERPFormGrid>
            <div className="rounded-lg border border-border/60 bg-background p-3 space-y-2">
              <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <CalendarClock className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-bold text-foreground">
                  {t("admin.subscription.history", { defaultValue: "Recent changes" })}
                </h4>
              </div>
              {history.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1">
                  {t("admin.billing.noHistory", { defaultValue: "No subscription changes recorded yet" })}
                </p>
              ) : (
                <ol className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {history.map((h) => (
                    <li key={h.id} className="rounded-md border border-border/60 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] font-semibold text-foreground">
                          {h.fromStatus ?? "—"} → {h.toStatus ?? "—"}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {h.createdAt ? formatDate(h.createdAt) : "—"}
                        </span>
                      </div>
                      {(h.fromPlanId ?? h.toPlanId) ? (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {h.fromPlanId ? planNameById.get(h.fromPlanId) ?? h.fromPlanId : "—"} →{" "}
                          {h.toPlanId ? planNameById.get(h.toPlanId) ?? h.toPlanId : "—"}
                        </p>
                      ) : null}
                      {h.reason ? (
                        <p className="text-[10px] text-foreground/80 mt-0.5">{h.reason}</p>
                      ) : null}
                      {h.actorEmail ? (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {t("admin.billing.changedBy", { defaultValue: "Changed by" })} {h.actorEmail}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </CardContent>

      <ERPConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("admin.subscription.confirmTitle", { defaultValue: "Apply subscription changes?" })}
        description={summary}
        confirmLabel={t("common.save", { defaultValue: "Save" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="primary"
        pending={saveMutation.isPending}
        pendingLabel={t("common.processing", { defaultValue: "Saving…" })}
        onConfirm={() => saveMutation.mutate()}
      />
    </Card>
  );
}

function seedDraft(base: SubscriptionBaseline) {
  return {
    status: base.status ?? "",
    planSlug: base.planSlug ?? null,
    currentPeriodEnd: isoToLocalInput(base.currentPeriodEnd),
    trialEndsAt: isoToLocalInput(base.trialEndsAt),
    graceDays: base.graceEndsAt && base.currentPeriodEnd ? String(deriveGraceDays(base) ?? "") : "",
    reason: "",
  };
}
