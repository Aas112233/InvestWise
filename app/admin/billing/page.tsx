"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";

interface BillingRow {
  tenantId: string;
  slug: string;
  name: string;
  tenantStatus: string;
  maxUsers: number;
  subscriptionStatus: string | null;
  planSlug: string | null;
  planName: string | null;
  priceMonthly: string | number | null;
  currentPeriodEnd: string | null;
  userCount: number;
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

export default function AdminBillingPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ row: BillingRow; status: string } | null>(null);

  const { data, isLoading } = useQuery<{ success: boolean; data: BillingRow[] }>({
    queryKey: ["admin", "billing"],
    queryFn: () => apiClient<{ success: boolean; data: BillingRow[] }>("/admin/billing"),
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ tenantId, status }: { tenantId: string; status: string }) =>
      apiClient("/admin/billing", {
        method: "POST",
        body: JSON.stringify({ tenantId, status }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      setPending(null);
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
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {row.currentPeriodEnd ? new Date(row.currentPeriodEnd).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "change",
      header: t("admin.billing.change", { defaultValue: "Change Status" }),
      align: "right",
      render: (row) => (
        <select
          value=""
          disabled={updateMutation.isPending}
          onChange={(e) => {
            const status = e.target.value;
            e.target.value = "";
            if (status) setPending({ row, status });
          }}
          className="px-2 py-1 rounded-lg border border-border/80 bg-card text-foreground text-xs disabled:opacity-50 outline-none focus:border-primary"
          aria-label={`Change subscription status for ${row.name}`}
        >
          <option value="">Select…</option>
          {STATUSES.filter((s) => s !== row.subscriptionStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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

      <ERPDataTable<BillingRow>
        data={data?.data ?? []}
        columns={columns}
        loading={isLoading}
        rowKey={(row) => row.tenantId}
        emptyMessage={t("admin.billing.empty", { defaultValue: "No subscriptions found" })}
      />

      <ERPConfirmDialog
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        title={t("admin.billing.confirmTitle", { defaultValue: "Change subscription status?" })}
        description={
          pending
            ? `${pending.row.name}: ${pending.row.subscriptionStatus ?? "none"} → ${pending.status}`
            : ""
        }
        confirmLabel={t("common.save", { defaultValue: "Save" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="primary"
        pending={updateMutation.isPending}
        pendingLabel={t("common.processing", { defaultValue: "Saving…" })}
        onConfirm={() => {
          if (pending) updateMutation.mutate({ tenantId: pending.row.tenantId, status: pending.status });
        }}
      />
    </div>
  );
}
