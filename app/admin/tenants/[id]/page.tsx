"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  FolderKanban,
  KeyRound,
  PauseCircle,
  PiggyBank,
  PlayCircle,
  ShieldAlert,
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

interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
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
  stats: {
    totalUsers: number;
    totalFunds: number;
    totalProjects: number;
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

  const { data, isLoading, refetch } = useQuery<{ success: boolean; data: TenantDetailResponse }>({
    queryKey: ["admin", "tenants", id],
    queryFn: () => apiClient<{ success: boolean; data: TenantDetailResponse }>(`/admin/tenants/${id}`),
    staleTime: 30_000,
  });

  const detail = data?.data;
  const tenant = detail?.tenant;
  const stats = detail?.stats;
  const usersList = detail?.users ?? [];

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
        <Link
          href={`/admin/impersonate`}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-border/80 text-foreground hover:bg-muted/60 transition-colors"
          title="Impersonate this user"
        >
          <KeyRound size={12} className="text-primary" />
          <span>Support Session</span>
        </Link>
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
    </div>
  );
}
