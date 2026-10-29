"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  FolderKanban,
  History,
  KeyRound,
  PauseCircle,
  PiggyBank,
  PlayCircle,
  Receipt,
  ShieldAlert,
  Trash2,
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
import { TopSheet } from "@/components/ui/top-sheet";
import { Input } from "@/components/ui";
import { TenantModuleAccessPanel } from "@/components/admin/tenant-module-access-panel";
import { SubscriptionControlPanel } from "@/components/admin/subscription-control-panel";
import { formatDate } from "@/lib/formatters";

interface PlatformActionLite {
  id: string;
  actionType: string;
  adminEmail: string | null;
  targetType: string | null;
  createdAt: string | null;
}

// Compact "Nd ago" for the activity card. `nowMs` is passed in (query load
// time) so the render stays pure — Date.now() in render is an eslint purity
// violation and makes server/client output differ.
function formatRelative(iso: string | null | undefined, nowMs: number): string {
  if (!iso || !nowMs) return "—";
  const diffMin = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(d / 365)}y ago`;
}

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
  lastLogin: string | null;
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
    activeUsers: number;
    totalMembers: number;
    transactions30d: number;
    lastActivityAt: string | null;
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

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<{ success: boolean; data: TenantDetailResponse }>({
    queryKey: ["admin", "tenants", id],
    queryFn: () => apiClient<{ success: boolean; data: TenantDetailResponse }>(`/admin/tenants/${id}`),
    staleTime: 30_000,
  });

  // Platform actions taken ON this tenant — the operator's "what happened
  // here" stream. Reuses /admin/action-log's server-side tenantId filter.
  const activityQuery = useQuery<{ success: boolean; data: PlatformActionLite[] }>({
    queryKey: ["admin", "action-log", "tenant", id],
    queryFn: () =>
      apiClient<{ success: boolean; data: PlatformActionLite[] }>("/admin/action-log", {
        params: { tenantId: id, limit: 5 },
      }),
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

  // High-friction platform wipe. The gate is UI friction only — the server
  // still enforces SuperAdmin + non-default slug — but a 37-table cascade
  // deserves an explicit acknowledgement of the live counts.
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeName, setWipeName] = useState("");
  const [wipeReason, setWipeReason] = useState("");
  const wipeArmed = !!tenant && wipeName.trim() === tenant.name && wipeReason.trim().length >= 8;

  const wipeMutation = useMutation({
    mutationFn: () =>
      apiClient(`/admin/tenants/${id}`, {
        method: "DELETE",
        params: { force: true, reason: wipeReason.trim().slice(0, 500) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success(t("admin.tenants.deleted", { defaultValue: "Tenant deleted" }));
      router.push("/admin/tenants");
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : t("admin.tenants.deleteFailed", { defaultValue: "Delete failed" })
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
      key: "lastLogin",
      header: t("admin.tenants.detail.userLastLogin", { defaultValue: "Last login" }),
      render: (u) =>
        u.lastLogin ? (
          <span className="font-mono text-[11px] text-foreground">
            {formatRelative(u.lastLogin, dataUpdatedAt)}
            <span className="block text-[10px] text-muted-foreground">{formatDate(u.lastLogin)}</span>
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground italic">
            {t("admin.tenants.detail.neverLoggedIn", { defaultValue: "Never logged in" })}
          </span>
        ),
    },
    {
      key: "createdAt",
      header: t("admin.tenants.detail.userJoined", { defaultValue: "Joined" }),
      render: (u) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {u.createdAt ? formatDate(u.createdAt) : "—"}
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
        {t("common.loading", { defaultValue: "Loading tenant 360° telemetry…" })}
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
      <div className="rounded-xl bg-card p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

      {/* 360° telemetry */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <ERPMetricCard
          label={t("admin.tenants.detail.quotaUsers", { defaultValue: "Accounts (quota)" })}
          value={`${stats?.totalUsers ?? 0} / ${tenant.maxUsers}`}
          note={`${stats?.activeUsers ?? 0} active`}
          icon={<Users size={16} />}
        />
        <ERPMetricCard
          label={t("admin.tenants.detail.members", { defaultValue: "Investor Members" })}
          value={stats?.totalMembers ?? 0}
          icon={<Building2 size={16} />}
        />
        <ERPMetricCard
          label={t("admin.tenants.detail.fundsProjects", { defaultValue: "Funds · Projects" })}
          value={`${stats?.totalFunds ?? 0} · ${stats?.totalProjects ?? 0}`}
          icon={<FolderKanban size={16} />}
        />
        <ERPMetricCard
          label={t("admin.tenants.detail.lastActivity", { defaultValue: "Last Activity" })}
          value={formatRelative(stats?.lastActivityAt, dataUpdatedAt)}
          note={
            stats?.lastActivityAt
              ? formatDate(stats.lastActivityAt)
              : t("admin.tenants.detail.noLoginsYet", { defaultValue: "no sign-ins yet" })
          }
          icon={<Activity size={16} />}
          tone={
            stats?.lastActivityAt
              ? dataUpdatedAt - new Date(stats.lastActivityAt).getTime() < 7 * 86_400_000
                ? "emerald"
                : "amber"
              : "slate"
          }
        />
      </div>

      {/* Financial throughput — the platform operator needs to see a tenant's
          money, not just its row counts. Rendered from server-side decimal
          sums; the client never re-adds. */}
      <div className="rounded-xl bg-card p-4 shadow-xs">
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
            note={`+${stats?.transactions30d ?? 0} in last 30 days`}
            icon={<Receipt size={16} />}
            tone={(stats?.transactions30d ?? 0) > 0 ? "emerald" : "slate"}
          />
        </div>
      </div>

      {/* Per-tenant subscription lifecycle: deadlines, grace, change timeline */}
      <SubscriptionControlPanel
        tenantId={tenant.id}
        onUpdated={() => void refetch()}
      />

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

      {/* Platform actions on this tenant — recent operator activity stream */}
      <div className="rounded-xl bg-card p-4 shadow-xs space-y-2">
        <div className="flex items-center justify-between gap-2 pb-1 border-b border-border/50">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <History size={15} className="text-primary" />
            {t("admin.tenants.detail.activityTitle", { defaultValue: "Platform Activity (audit)" })}
          </h2>
          <Link href="/admin/audit-logs" className="ml-auto text-[11px] text-primary hover:underline">
            {t("admin.tenants.detail.activityAll", { defaultValue: "View all" })}
          </Link>
        </div>
        {activityQuery.isLoading ? (
          <p className="text-[11px] text-muted-foreground py-2">{t("common.loading", { defaultValue: "Loading…" })}</p>
        ) : (activityQuery.data?.data?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-muted-foreground py-2">
            {t("admin.tenants.detail.activityEmpty", { defaultValue: "No platform actions recorded for this tenant yet." })}
          </p>
        ) : (
          <ol className="divide-y divide-border/50">
            {(activityQuery.data?.data ?? []).map((row) => (
              <li key={row.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 shrink-0">
                    {row.actionType}
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {row.adminEmail ?? "system"}
                    {row.targetType ? ` → ${row.targetType}` : ""}
                  </span>
                </span>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {row.createdAt ? formatRelative(row.createdAt, dataUpdatedAt) : "—"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Danger Zone — mirrors the tenant-detail pattern: a 37-table cascade
          gets an explicit impact readout + typed acknowledgement here too. */}
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.03] p-4 space-y-3">
        <div className="flex items-center gap-2 pb-1 border-b border-rose-500/20">
          <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          <h2 className="text-sm font-bold text-rose-700 dark:text-rose-300">
            {t("admin.tenants.detail.dangerTitle", { defaultValue: "Danger Zone — Platform Wipe" })}
          </h2>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("admin.tenants.detail.dangerDesc", {
            defaultValue:
              "Permanently deletes this tenant's users, members, funds, projects and full ledger. Irreversible — protected by a database backup, not by an undo button. Suspended-only churn is normally what you want instead.",
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            `${stats?.totalUsers ?? 0} users`,
            `${stats?.totalMembers ?? 0} members`,
            `${stats?.totalFunds ?? 0} funds`,
            `${stats?.totalProjects ?? 0} projects`,
            `${stats?.totalTransactions ?? 0} transactions`,
          ].map((chip) => (
            <span key={chip} className="font-mono text-[10px] rounded-full border border-rose-500/30 text-rose-700 dark:text-rose-300 px-2 py-0.5">
              {chip}
            </span>
          ))}
        </div>
        {tenant.slug === "default" ? (
          <p className="text-[11px] text-rose-700 dark:text-rose-300">
            {t("admin.tenants.detail.defaultProtected", {
              defaultValue: "The default tenant is platform-managed and cannot be deleted.",
            })}
          </p>
        ) : (
          <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => { setWipeName(""); setWipeReason(""); setWipeOpen(true); }}>
            <Trash2 size={14} />
            {t("admin.tenants.detail.wipeButton", { defaultValue: "Force delete tenant…" })}
          </Button>
        )}
      </div>

      <TopSheet
        isOpen={wipeOpen}
        onClose={() => setWipeOpen(false)}
        title={t("admin.tenants.detail.wipeTitle", { defaultValue: "Force delete tenant?" })}
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-[11px] text-rose-800 dark:text-rose-200 leading-relaxed">
            {t("admin.tenants.detail.wipeWarning", {
              defaultValue:
                "This wipes every user, member, fund, project and ledger row for {name} in one transaction. There is no recovery from the app. Type the tenant name and give a reason (min 8 characters) to arm the button — the reason is written to the platform audit.",
              name: tenant.name,
            })}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wipe-name" className="text-xs font-semibold text-foreground">
              {t("admin.tenants.detail.wipeNameLabel", { defaultValue: "Type the tenant name to confirm" })}
            </label>
            <Input
              id="wipe-name"
              autoComplete="off"
              value={wipeName}
              onChange={(e) => setWipeName(e.target.value)}
              placeholder={tenant.name}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wipe-reason" className="text-xs font-semibold text-foreground">
              {t("admin.tenants.detail.wipeReasonLabel", { defaultValue: "Reason (audited)" })}
            </label>
            <textarea
              id="wipe-reason"
              rows={3}
              maxLength={500}
              value={wipeReason}
              onChange={(e) => setWipeReason(e.target.value)}
              placeholder={t("admin.tenants.detail.wipeReasonPlaceholder", {
                defaultValue: "e.g. contract terminated 25-10-2026, data export delivered, customer requested erasure",
              })}
              className="w-full px-3 py-2 rounded-xl border border-border/80 bg-card text-xs text-foreground outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400/40"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
            <Button variant="outline" size="sm" onClick={() => setWipeOpen(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!wipeArmed}
              loading={wipeMutation.isPending}
              onClick={() => wipeMutation.mutate()}
            >
              <Trash2 size={14} className="mr-1.5" />
              {wipeMutation.isPending
                ? t("common.processing", { defaultValue: "Processing…" })
                : t("admin.tenants.detail.wipeConfirm", { defaultValue: "Delete permanently" })}
            </Button>
          </div>
        </div>
      </TopSheet>

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
