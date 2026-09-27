"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Pencil } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { toCents, fromCents } from "@/lib/money";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { AppModal } from "@/components/ui/app-modal";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { ERPFormField } from "@/components/ui/erp-form-layout";
import { ERPMetricCard } from "@/components/ui/erp-metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

interface BillingPlan {
  id: string;
  slug: string;
  name: string;
  priceMonthly: string | number | null;
  maxUsers: number | null;
  isActive: boolean | null;
}

interface BillingRow {
  tenantId: string;
  slug: string;
  name: string;
  tenantStatus: string;
  maxUsers: number;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  planSlug: string | null;
  planName: string | null;
  priceMonthly: string | number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  userCount: number;
}

interface HistoryEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  fromPlanId: string | null;
  toPlanId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  createdAt: string;
}

const STATUSES = ["trial", "active", "past_due", "suspended", "cancelled", "expired"] as const;

function toneFor(status: string | null): "emerald" | "amber" | "rose" | "cyan" | "slate" {
  if (!status) return "slate";
  const s = status.toLowerCase();
  if (s === "active") return "emerald";
  if (s === "trial") return "cyan";
  if (s === "past_due") return "amber";
  if (s === "suspended" || s === "cancelled" || s === "expired") return "rose";
  return "slate";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function AdminBillingPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [changeTarget, setChangeTarget] = useState<BillingRow | null>(null);
  const [confirmPayload, setConfirmPayload] = useState<{
    tenantId: string;
    name: string;
    status: string;
    planSlug: string | null;
    reason: string;
    summary: string;
  } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<BillingRow | null>(null);

  const billingQuery = useQuery<{ success: boolean; data: BillingRow[]; plans: BillingPlan[] }>({
    queryKey: ["admin", "billing"],
    queryFn: () => apiClient<{ success: boolean; data: BillingRow[]; plans: BillingPlan[] }>("/admin/billing"),
    staleTime: 30_000,
  });
  const rows = useMemo(() => billingQuery.data?.data ?? [], [billingQuery.data]);
  const plans = useMemo(() => billingQuery.data?.plans ?? [], [billingQuery.data]);
  const planNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of plans) m.set(p.id, p.name);
    return m;
  }, [plans]);

  const cards = useMemo(() => {
    let mrrCents = 0;
    let active = 0;
    let trials = 0;
    let attention = 0;
    for (const r of rows) {
      const s = (r.subscriptionStatus ?? "").toLowerCase();
      if (s === "active") {
        active += 1;
        if (r.priceMonthly != null && r.priceMonthly !== "") {
          try {
            mrrCents += toCents(String(r.priceMonthly));
          } catch {
            // Unparseable price never blocks the console.
          }
        }
      } else if (s === "trial") {
        trials += 1;
      } else if (s === "past_due" || s === "suspended") {
        attention += 1;
      }
    }
    return { mrrCents, active, trials, attention, total: rows.length };
  }, [rows]);

  const historyQuery = useQuery<{ success: boolean; data: HistoryEntry[]; meta: { total: number } }>({
    queryKey: ["admin", "billing", "history", historyTarget?.tenantId ?? null],
    queryFn: () =>
      apiClient<{ success: boolean; data: HistoryEntry[]; meta: { total: number } }>(
        `/admin/billing/history?tenantId=${historyTarget?.tenantId}&limit=50`,
      ),
    enabled: historyTarget !== null,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (input: { tenantId: string; status: string; planSlug?: string; reason?: string }) =>
      apiClient("/admin/billing", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      if (historyTarget) void qc.invalidateQueries({ queryKey: ["admin", "billing", "history"] });
      setConfirmPayload(null);
      setChangeTarget(null);
      toast.success(t("admin.billing.updated", { defaultValue: "Subscription updated" }));
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : t("admin.billing.updateFailed", { defaultValue: "Update failed" }),
      ),
  });

  const columns: ERPColumn<BillingRow>[] = [
    {
      key: "tenant",
      header: t("admin.billing.tenant", { defaultValue: "Tenant" }),
      render: (row) => (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{row.name}</p>
          <p className="text-[11px] text-slate-500 font-mono truncate">
            {row.slug} · {row.userCount}/{row.maxUsers}
          </p>
        </div>
      ),
    },
    {
      key: "plan",
      header: t("admin.billing.plan", { defaultValue: "Plan" }),
      render: (row) => (
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {row.planName ?? row.planSlug ?? "—"}
          {row.priceMonthly != null && row.priceMonthly !== "" ? ` · ${row.priceMonthly}` : ""}
        </span>
      ),
    },
    {
      key: "subscription",
      header: t("admin.billing.subscription", { defaultValue: "Subscription" }),
      render: (row) => <StatusBadge tone={toneFor(row.subscriptionStatus)} label={row.subscriptionStatus ?? "none"} />,
    },
    {
      key: "period",
      header: t("admin.billing.periodEnd", { defaultValue: "Period End" }),
      render: (row) => (
        <div className="min-w-0">
          <p className="text-xs text-slate-600 dark:text-slate-300">{fmtDate(row.currentPeriodEnd)}</p>
          {row.subscriptionStatus?.toLowerCase() === "trial" && row.trialEndsAt ? (
            <p className="text-[11px] text-slate-500">
              {t("admin.billing.trialEnds", { defaultValue: "Trial ends" })} {fmtDate(row.trialEndsAt)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: t("admin.billing.actions", { defaultValue: "Actions" }),
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={updateMutation.isPending}
            onClick={() => setChangeTarget(row)}
            aria-label={`${t("admin.billing.change", { defaultValue: "Change Status" })}: ${row.name}`}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHistoryTarget(row)}
            aria-label={`${t("admin.billing.history", { defaultValue: "History" })}: ${row.name}`}
          >
            <History size={13} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="pb-2 border-b border-border/80">
        <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
          {t("nav.superadminPanel")}
        </p>
        <h1 className="text-lg font-bold tracking-tight text-foreground">
          {t("admin.billing.title", { defaultValue: "Billing & Subscriptions" })}
        </h1>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <ERPMetricCard
          label={t("admin.billing.mrr", { defaultValue: "MRR (active)" })}
          value={fromCents(cards.mrrCents)}
          tone="emerald"
          isLoading={billingQuery.isLoading}
        />
        <ERPMetricCard
          label={t("admin.billing.activeSubs", { defaultValue: "Active" })}
          value={`${cards.active} / ${cards.total}`}
          tone="cyan"
          isLoading={billingQuery.isLoading}
        />
        <ERPMetricCard
          label={t("admin.billing.trials", { defaultValue: "Trials" })}
          value={cards.trials}
          tone="cyan"
          isLoading={billingQuery.isLoading}
        />
        <ERPMetricCard
          label={t("admin.billing.attention", { defaultValue: "Needs attention" })}
          value={cards.attention}
          tone={cards.attention > 0 ? "amber" : "emerald"}
          isLoading={billingQuery.isLoading}
        />
      </div>

      {billingQuery.isError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-5 text-center space-y-2"
        >
          <p className="text-sm font-semibold text-foreground">
            {t("admin.billing.loadFailed", { defaultValue: "Could not load billing data" })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void billingQuery.refetch()}>
            {t("common.retry", { defaultValue: "Retry" })}
          </Button>
        </div>
      ) : (
        <ERPDataTable<BillingRow>
          data={rows}
          columns={columns}
          loading={billingQuery.isLoading}
          rowKey={(row) => row.tenantId}
          emptyMessage={t("admin.billing.empty", { defaultValue: "No subscriptions found" })}
        />
      )}

      {changeTarget ? (
        <ChangeSubscriptionForm
          key={changeTarget.tenantId}
          row={changeTarget}
          plans={plans}
          pending={updateMutation.isPending}
          onClose={() => setChangeTarget(null)}
          onSubmit={(input) => {
            const parts = [`${changeTarget.name}: ${changeTarget.subscriptionStatus ?? "none"} → ${input.status}`];
            if (input.planSlug) {
              const plan = plans.find((p) => p.slug === input.planSlug);
              parts.push(`${t("admin.billing.plan", { defaultValue: "Plan" })} → ${plan?.name ?? input.planSlug}`);
            }
            if (input.reason) parts.push(`${t("admin.billing.reason", { defaultValue: "Reason" })}: ${input.reason}`);
            setConfirmPayload({ tenantId: changeTarget.tenantId, name: changeTarget.name, ...input, summary: parts.join(" · ") });
          }}
        />
      ) : null}

      <ERPConfirmDialog
        isOpen={confirmPayload !== null}
        onClose={() => setConfirmPayload(null)}
        title={t("admin.billing.confirmTitle", { defaultValue: "Change subscription status?" })}
        description={confirmPayload?.summary ?? ""}
        confirmLabel={t("common.save", { defaultValue: "Save" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="primary"
        pending={updateMutation.isPending}
        pendingLabel={t("common.processing", { defaultValue: "Saving…" })}
        onConfirm={() => {
          if (confirmPayload) {
            const { summary: _summary, planSlug, ...rest } = confirmPayload;
            updateMutation.mutate(planSlug ? { ...rest, planSlug } : rest);
          }
        }}
      />

      <AppModal
        isOpen={historyTarget !== null}
        onClose={() => setHistoryTarget(null)}
        title={
          historyTarget
            ? `${t("admin.billing.history", { defaultValue: "History" })} — ${historyTarget.name}`
            : t("admin.billing.history", { defaultValue: "History" })
        }
        maxWidth="lg"
      >
        {historyQuery.isLoading ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            {t("common.loading", { defaultValue: "Loading…" })}
          </p>
        ) : historyQuery.isError ? (
          <div role="alert" className="py-4 text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("admin.billing.historyFailed", { defaultValue: "Could not load history" })}
            </p>
            <Button variant="outline" size="sm" onClick={() => void historyQuery.refetch()}>
              {t("common.retry", { defaultValue: "Retry" })}
            </Button>
          </div>
        ) : (historyQuery.data?.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            {t("admin.billing.noHistory", { defaultValue: "No subscription changes recorded yet" })}
          </p>
        ) : (
          <ol className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {(historyQuery.data?.data ?? []).map((h) => (
              <li key={h.id} className="rounded-lg border border-border/70 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {h.fromStatus ?? "—"} → {h.toStatus ?? "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{fmtDate(h.createdAt)}</span>
                </div>
                {(h.fromPlanId ?? h.toPlanId) ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t("admin.billing.plan", { defaultValue: "Plan" })}:{" "}
                    {h.fromPlanId ? (planNameById.get(h.fromPlanId) ?? h.fromPlanId) : "—"} →{" "}
                    {h.toPlanId ? (planNameById.get(h.toPlanId) ?? h.toPlanId) : "—"}
                  </p>
                ) : null}
                {h.reason ? <p className="text-[11px] text-foreground/80 mt-0.5">{h.reason}</p> : null}
                {h.actorEmail ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t("admin.billing.changedBy", { defaultValue: "Changed by" })} {h.actorEmail}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </AppModal>
    </div>
  );
}

function ChangeSubscriptionForm({
  row,
  plans,
  pending,
  onClose,
  onSubmit,
}: {
  row: BillingRow;
  plans: BillingPlan[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { status: string; planSlug: string | null; reason: string }) => void;
}) {
  const { t } = useLocale();
  // Keyed by tenant above, so state is always seeded from the opened row.
  const [status, setStatus] = useState<string | null>(row.subscriptionStatus);
  const [planSlug, setPlanSlug] = useState<string | null>(row.planSlug);
  const [reason, setReason] = useState("");

  const statusChanged = status !== null && status !== row.subscriptionStatus;
  const planChanged = planSlug !== null && planSlug !== row.planSlug;
  const valid = (statusChanged || planChanged) && status !== null;

  return (
    <AppModal
      isOpen
      onClose={onClose}
      title={`${t("admin.billing.change", { defaultValue: "Change Status" })} — ${row.name}`}
      footer={
        <div className="flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!valid || pending}
            loading={pending}
            loadingLabel={t("common.processing", { defaultValue: "Saving…" })}
            onClick={() =>
              status && onSubmit({ status, planSlug: planChanged ? planSlug : null, reason: reason.trim() })
            }
          >
            {t("common.continue", { defaultValue: "Continue" })}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <ERPFormField label={t("admin.billing.subscription", { defaultValue: "Subscription" })} required>
          <AppDropdown
            value={status}
            onChange={setStatus}
            clearable={false}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
            placeholder={t("admin.billing.selectStatus", { defaultValue: "Select status…" })}
          />
        </ERPFormField>
        <ERPFormField
          label={t("admin.billing.plan", { defaultValue: "Plan" })}
          hint={t("admin.billing.planHint", { defaultValue: "Empty keeps the current plan." })}
        >
          <AppDropdown
            value={planSlug}
            onChange={setPlanSlug}
            options={plans
              .filter((p) => p.isActive !== false)
              .map((p) => ({
                value: p.slug,
                label: p.name,
                caption: p.priceMonthly != null && p.priceMonthly !== "" ? String(p.priceMonthly) : undefined,
              }))}
            placeholder={t("admin.billing.selectPlan", { defaultValue: "Select plan…" })}
          />
        </ERPFormField>
        <ERPFormField label={t("admin.billing.reason", { defaultValue: "Reason" })}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t("admin.billing.reasonPlaceholder", { defaultValue: "Why is this changing? (recorded in the audit log)" })}
            className="w-full px-3 py-2 rounded-lg border border-border/80 bg-card text-foreground text-xs outline-none focus:border-primary resize-y"
          />
        </ERPFormField>
      </div>
    </AppModal>
  );
}
