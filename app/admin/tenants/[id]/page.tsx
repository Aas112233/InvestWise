"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  FolderKanban,
  KeyRound,
  PauseCircle,
  PiggyBank,
  PlayCircle,
  Receipt,
  ShieldAlert,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { ERPMetricCard } from "@/components/ui/erp-metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { TenantModuleAccessPanel } from "@/components/admin/tenant-module-access-panel";

// decimal(15,2) string -> display. Grouping only; no arithmetic.
function formatCentsOnly(value: string | undefined): string {
  if (!value) return "0";
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  impersonatable: boolean;
}

interface TenantDetailResponse {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    plan: string;
    isMaintenanceMode: boolean;
    maxUsers: number;
    createdAt: string;
    updatedAt: string;
    userCount: number;
  };
  moduleAccess: Record<string, boolean>;
  stats: {
    totalUsers: number;
    totalFunds: number;
    totalProjects: number;
    totalTransactions: number;
  };
  // decimal(15,2) as strings — formatted for display, never re-summed.
  financials: {
    totalDeposits: string;
    totalWithdrawals: string;
    totalExpenses: string;
    totalDividends: string;
    netReserveBalance: string;
  };
  users: TenantUser[];
}

export default function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { t } = useLocale();
  const qc = useQueryClient();
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [impersonateTarget, setImpersonateTarget] = useState<TenantUser | null>(null);

  const impersonateMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient("/admin/impersonate", { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: () => {
      // Full navigation so the server layout re-reads the swapped cookie.
      window.location.href = "/";
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.users.impersonateFailed", { defaultValue: "Could not start session" })
      ),
  });

  const { data, isLoading, refetch } = useQuery<{ success: boolean; data: TenantDetailResponse }>({
    queryKey: ["admin", "tenants", id],
    queryFn: () => apiClient<{ success: boolean; data: TenantDetailResponse }>(`/admin/tenants/${id}`),
    staleTime: 30_000,
  });

  const detail = data?.data;
  const tenant = detail?.tenant;
  const stats = detail?.stats;
  const financials = detail?.financials;
  const usersList = detail?.users ?? [];
  const moduleAccess = detail?.moduleAccess ?? {};

  const patchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient(`/admin/tenants/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      void refetch();
      setConfirmSuspend(false);
      toast.success(t("admin.tenants.updated", { defaultValue: "Tenant updated" }));
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : t("admin.tenants.updateFailed", { defaultValue: "Update failed" })
      ),
  });

  const userColumns: ERPColumn<TenantUser>[] = [
    {
      key: "name",
      header: t("admin.tenants.detail.userName", { defaultValue: "User" }),
      render: (u) => (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{u.name}</p>
          <p className="font-mono text-[11px] text-muted-foreground truncate">{u.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: t("admin.tenants.detail.userRole", { defaultValue: "Role" }),
      render: (u) => (
        <span className="font-mono text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
          {u.role}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.tenants.detail.userStatus", { defaultValue: "Status" }),
      render: (u) => (
        <StatusBadge tone={u.status === "active" ? "emerald" : "rose"} label={u.status} />
      ),
    },
    {
      key: "createdAt",
      header: t("admin.tenants.detail.userJoined", { defaultValue: "Joined" }),
      render: (u) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("admin.tenants.detail.userActions", { defaultValue: "Action" }),
      align: "right",
      render: (u) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={!u.impersonatable || impersonateMutation.isPending}
          onClick={() => setImpersonateTarget(u)}
          className="gap-1.5"
          title={
            u.impersonatable
              ? t("admin.tenants.detail.supportSession", { defaultValue: "Start support session" })
              : t("admin.users.cannotImpersonate", {
                  defaultValue: "Platform operators cannot be impersonated",
                })
          }
        >
          <KeyRound size={12} className="text-primary" />
          <span>
            {t("admin.tenants.detail.supportSessionShort", { defaultValue: "Support" })}
          </span>
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="p-8 text-center text-xs text-muted-foreground">
        {t("common.loading", { defaultValue: "Loading tenant details…" })}
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-foreground">Tenant not found</p>
        <Link href="/admin/tenants" className="text-xs text-primary hover:underline">
          Return to Tenants
        </Link>
      </div>
    );
  }

  const isSuspended = tenant.status === "suspended";

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2">
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          <span>{t("admin.tenants.detail.back", { defaultValue: "Back to Tenants" })}</span>
        </Link>
      </div>

      {/* Hero Header */}
      <div className="rounded-xl border border-border/80 bg-card p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-foreground">{tenant.name}</h1>
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">
                {tenant.slug}
              </span>
              <StatusBadge
                tone={tenant.status === "active" ? "emerald" : "rose"}
                label={tenant.status}
              />
              {tenant.isMaintenanceMode && (
                <StatusBadge tone="amber" label="Maintenance" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Plan: <span className="font-semibold text-foreground uppercase">{tenant.plan}</span> · Max Users:{" "}
              <span className="font-semibold text-foreground font-mono">{tenant.maxUsers}</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              patchMutation.mutate({ isMaintenanceMode: !tenant.isMaintenanceMode })
            }
            loading={patchMutation.isPending}
            className="gap-1.5"
          >
            <Wrench size={14} />
            <span>{tenant.isMaintenanceMode ? "Disable Maintenance" : "Enable Maintenance"}</span>
          </Button>

          <Button
            variant={isSuspended ? "default" : "destructive"}
            size="sm"
            onClick={() =>
              isSuspended
                ? patchMutation.mutate({ status: "active" })
                : setConfirmSuspend(true)
            }
            loading={patchMutation.isPending}
            className="gap-1.5"
          >
            {isSuspended ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
            <span>{isSuspended ? "Activate Tenant" : "Suspend Tenant"}</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ERPMetricCard
          label={t("admin.tenants.detail.quotaUsers", { defaultValue: "Members & Users" })}
          value={`${stats?.totalUsers ?? 0} / ${tenant.maxUsers}`}
          icon={<Users size={16} />}
        />
        <ERPMetricCard
          label={t("admin.tenants.detail.funds", { defaultValue: "Active Funds" })}
          value={stats?.totalFunds ?? 0}
          icon={<PiggyBank size={16} />}
        />
        <ERPMetricCard
          label={t("admin.tenants.detail.projects", { defaultValue: "Active Projects" })}
          value={stats?.totalProjects ?? 0}
          icon={<FolderKanban size={16} />}
        />
      </div>

      {/* Financial throughput — the platform operator needs to see a tenant's
          money, not just its row counts. Rendered from server-side decimal
          sums; the client never re-adds. */}
      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
        <h2 className="text-sm font-bold text-foreground mb-3">
          {t("admin.tenants.detail.financials", { defaultValue: "Financial Throughput" })}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <ERPMetricCard
            label={t("admin.tenants.detail.netReserve", { defaultValue: "Net Reserves" })}
            value={formatCentsOnly(financials?.netReserveBalance)}
            icon={<PiggyBank size={16} />}
            tone="cyan"
          />
          <ERPMetricCard
            label={t("common.deposit", { defaultValue: "Deposits" })}
            value={formatCentsOnly(financials?.totalDeposits)}
            icon={<ArrowDownLeft size={16} />}
            tone="emerald"
          />
          <ERPMetricCard
            label={t("common.dividend", { defaultValue: "Dividends" })}
            value={formatCentsOnly(financials?.totalDividends)}
            icon={<TrendingUp size={16} />}
          />
          <ERPMetricCard
            label={t("common.expense", { defaultValue: "Expenses" })}
            value={formatCentsOnly(financials?.totalExpenses)}
            icon={<ArrowUpRight size={16} />}
            tone="amber"
          />
          <ERPMetricCard
            label={t("admin.tenants.detail.transactions", { defaultValue: "Transactions" })}
            value={stats?.totalTransactions ?? 0}
            icon={<Receipt size={16} />}
          />
        </div>
      </div>

      {/* Per-tenant module licensing */}
      <TenantModuleAccessPanel
        tenantId={tenant.id}
        initialAccess={moduleAccess}
        onUpdated={() => void refetch()}
      />

      {/* Users Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">
            {t("admin.tenants.detail.usersTitle", { defaultValue: "Tenant Members & Accounts" })}
          </h2>
          <span className="text-xs text-muted-foreground">
            {usersList.length} of {stats?.totalUsers ?? 0} accounts
          </span>
        </div>

        <ERPDataTable<TenantUser>
          data={usersList}
          columns={userColumns}
          rowKey={(u) => u.id}
          emptyMessage="No users provisioned in this tenant yet"
        />
      </div>

      {/* Suspend Confirmation Dialog */}
      <ERPConfirmDialog
        isOpen={confirmSuspend}
        onClose={() => setConfirmSuspend(false)}
        title={t("admin.tenants.suspendTitle", { defaultValue: "Suspend tenant?" })}
        description={t("admin.tenants.suspendDesc", {
          defaultValue: "Users in this tenant will be blocked until reactivated.",
        })}
        confirmLabel={t("admin.tenants.suspend", { defaultValue: "Suspend" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="destructive"
        pending={patchMutation.isPending}
        onConfirm={() => patchMutation.mutate({ status: "suspended" })}
      />

      <ERPConfirmDialog
        isOpen={impersonateTarget !== null}
        onClose={() => setImpersonateTarget(null)}
        title={t("admin.users.impersonateTitle", { defaultValue: "Start a support session?" })}
        description={t("admin.users.impersonateDesc", {
          defaultValue:
            "You will be signed in as {email} for 30 minutes. Everything they do is attributed to you in the audit log.",
          email: impersonateTarget?.email ?? "",
        })}
        confirmLabel={t("admin.users.impersonate", { defaultValue: "Impersonate" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="primary"
        pending={impersonateMutation.isPending}
        onConfirm={() => {
          if (impersonateTarget) impersonateMutation.mutate(impersonateTarget.id);
        }}
      />
    </div>
  );
}
