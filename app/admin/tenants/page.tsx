"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PauseCircle, PlayCircle, Plus, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { TopSheet } from "@/components/ui/top-sheet";
import { Button, Input } from "@/components/ui";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  isMaintenanceMode: boolean;
  maxUsers: number;
  createdAt: string;
  userCount?: number;
}

interface TenantListResponse {
  data: Tenant[];
  meta: { total: number; page: number; limit: number; pages: number };
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function AdminTenantsPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirm, setConfirm] = useState<{ tenant: Tenant; action: "suspend" | "delete" } | null>(null);

  const { data, isLoading } = useQuery<TenantListResponse>({
    queryKey: ["admin", "tenants", { page, pageSize, search }],
    queryFn: () =>
      apiClient<TenantListResponse>("/admin/tenants", { params: { page, limit: pageSize, search } }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
    void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
  };

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiClient(`/admin/tenants/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      toast.success(t("admin.tenants.updated", { defaultValue: "Tenant updated" }));
    },
    onError: (err) => toast.error(errMsg(err, t("admin.tenants.updateFailed", { defaultValue: "Update failed" }))),
  });

  // Full onboarding: tenant + org-admin login + settings + 14-day trial in one
  // transaction (POST /admin/tenants/onboard). The plain tenant-create endpoint
  // leaves a tenant with no admin user and no subscription, so the panel only
  // exposes the complete flow.
  const onboardMutation = useMutation({
    mutationFn: () =>
      apiClient("/admin/tenants/onboard", {
        method: "POST",
        body: JSON.stringify({
          slug: slug.trim(),
          name: name.trim(),
          ...(plan.trim() ? { plan: plan.trim() } : {}),
          ...(maxUsers.trim() ? { maxUsers: Number(maxUsers) } : {}),
          ...(adminName.trim() ? { adminName: adminName.trim() } : {}),
          adminEmail: adminEmail.trim(),
          adminPassword,
        }),
      }),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setSlug("");
      setName("");
      setPlan("");
      setMaxUsers("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      toast.success(t("admin.tenants.onboarded", { defaultValue: "Tenant onboarded" }));
    },
    onError: (err) => toast.error(errMsg(err, t("admin.tenants.onboardFailed", { defaultValue: "Onboarding failed" }))),
  });

  // The dialog is explicitly destructive, so this is the platform wipe
  // (?force=true) rather than the guarded delete that refuses while the
  // tenant still has users or business data.
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/admin/tenants/${id}`, { method: "DELETE", params: { force: true } }),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      toast.success(t("admin.tenants.deleted", { defaultValue: "Tenant deleted" }));
    },
    onError: (err) => toast.error(errMsg(err, t("admin.tenants.deleteFailed", { defaultValue: "Delete failed" }))),
  });

  const busy = patchMutation.isPending || deleteMutation.isPending;

  const columns: ERPColumn<Tenant>[] = [
    {
      key: "name",
      header: t("admin.tenants.name", { defaultValue: "Tenant" }),
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/admin/tenants/${row.id}`}
            className="text-xs font-semibold text-foreground hover:text-primary transition-colors hover:underline truncate block"
          >
            {row.name}
          </Link>
          <p className="text-[11px] text-muted-foreground font-mono truncate">{row.slug}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: t("admin.tenants.plan", { defaultValue: "Plan" }),
      render: (row) => <span className="text-xs text-slate-600 dark:text-slate-300">{row.plan}</span>,
    },
    {
      key: "users",
      header: t("admin.tenants.users", { defaultValue: "Users" }),
      align: "right",
      render: (row) => <span className="text-xs tabular-nums">{row.userCount ?? "—"}</span>,
    },
    {
      key: "status",
      header: t("admin.tenants.status", { defaultValue: "Status" }),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={row.status === "active" ? "emerald" : "rose"} label={row.status} />
          {row.isMaintenanceMode && <StatusBadge tone="amber" label="maintenance" />}
        </div>
      ),
    },
    {
      key: "actions",
      header: t("admin.tenants.actions", { defaultValue: "Actions" }),
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            disabled={busy}
            title={row.status === "active" ? "Suspend" : "Activate"}
            onClick={() =>
              row.status === "active"
                ? setConfirm({ tenant: row, action: "suspend" })
                : patchMutation.mutate({ id: row.id, body: { status: "active" } })
            }
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {row.status === "active" ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
          </button>
          <button
            type="button"
            disabled={busy}
            title="Toggle maintenance"
            onClick={() => patchMutation.mutate({ id: row.id, body: { isMaintenanceMode: !row.isMaintenanceMode } })}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Wrench size={15} />
          </button>
          <button
            type="button"
            disabled={busy}
            title="Force delete"
            onClick={() => setConfirm({ tenant: row, action: "delete" })}
            className="p-1.5 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel")}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground">
            {t("admin.tenants.title", { defaultValue: "Tenants" })}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("admin.tenants.search", { defaultValue: "Search tenants…" })}
            className="w-52 h-9 text-xs"
          />
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
          >
            <Plus size={14} />
            {t("admin.tenants.create", { defaultValue: "New Tenant" })}
          </Button>
        </div>
      </div>

      <ERPDataTable<Tenant>
        data={data?.data ?? []}
        columns={columns}
        loading={isLoading}
        rowKey={(row) => row.id}
        page={page}
        pageSize={pageSize}
        totalCount={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={t("admin.tenants.empty", { defaultValue: "No tenants found" })}
      />

      <TopSheet
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("admin.tenants.onboardTitle", { defaultValue: "Onboard tenant" })}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="button"
              size="sm"
              loading={onboardMutation.isPending}
              disabled={
                onboardMutation.isPending ||
                !slug.trim() ||
                !name.trim() ||
                !adminEmail.trim() ||
                !adminPassword
              }
              onClick={() => onboardMutation.mutate()}
            >
              {t("common.save", { defaultValue: "Save" })}
            </Button>
          </div>
        }
      >
        <p className="px-4 pt-4 text-xs text-muted-foreground">
          {t("admin.tenants.onboardDesc", {
            defaultValue:
              "Creates the tenant, its admin login, settings and a 14-day trial in one step.",
          })}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
          <label className="text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.tenants.fieldSlug", { defaultValue: "Slug" })}</span>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-corp"
              className="text-xs font-mono"
            />
          </label>
          <label className="text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.tenants.fieldName", { defaultValue: "Name" })}</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              className="text-xs"
            />
          </label>
          <label className="text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.tenants.fieldPlan", { defaultValue: "Plan" })}</span>
            <Input
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="standard"
              className="text-xs"
            />
          </label>
          <label className="text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.tenants.fieldMaxUsers", { defaultValue: "Max users" })}</span>
            <Input
              value={maxUsers}
              onChange={(e) => setMaxUsers(e.target.value)}
              placeholder="100"
              isNumeric
              className="text-xs font-mono"
            />
          </label>
          <label className="text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.tenants.adminName", { defaultValue: "Admin name" })}</span>
            <Input
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              className="text-xs"
            />
          </label>
          <label className="text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.tenants.adminEmail", { defaultValue: "Admin email" })}</span>
            <Input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@acme-corp.com"
              className="text-xs"
            />
          </label>
          <label className="text-xs font-medium text-foreground space-y-1 sm:col-span-2">
            <span>{t("admin.tenants.adminPassword", { defaultValue: "Admin password" })}</span>
            <Input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="text-xs font-mono"
            />
          </label>
        </div>
      </TopSheet>

      <ERPConfirmDialog
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm?.action === "delete"
            ? t("admin.tenants.deleteTitle", { defaultValue: "Force delete tenant?" })
            : t("admin.tenants.suspendTitle", { defaultValue: "Suspend tenant?" })
        }
        description={
          confirm?.action === "delete"
            ? t("admin.tenants.deleteDesc", {
                defaultValue: "This irreversibly wipes all tenant data. The default tenant is protected.",
              })
            : t("admin.tenants.suspendDesc", {
                defaultValue: "Users in this tenant will be blocked until reactivated.",
              })
        }
        confirmLabel={
          confirm?.action === "delete"
            ? t("common.delete", { defaultValue: "Delete" })
            : t("admin.tenants.suspend", { defaultValue: "Suspend" })
        }
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="destructive"
        pending={patchMutation.isPending || deleteMutation.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.action === "delete") deleteMutation.mutate(confirm.tenant.id);
          else patchMutation.mutate({ id: confirm.tenant.id, body: { status: "suspended" } });
        }}
      />
    </div>
  );
}
