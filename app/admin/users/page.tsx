"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Pencil,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { AppModal } from "@/components/ui/app-modal";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { TopSheet } from "@/components/ui/top-sheet";
import { ERPFormField, ERPFormGrid, ERPFormSection } from "@/components/ui/erp-form-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button, Input } from "@/components/ui";

interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  rawRole: string;
  status: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  impersonatable: boolean;
}

interface UsersResponse {
  data: AdminUserRow[];
  roles: string[];
  meta: { total: number; page: number; limit: number; pages: number };
}

const STATUSES = ["active", "inactive", "suspended"] as const;

function statusTone(status: string): "emerald" | "amber" | "rose" | "slate" {
  if (status === "active") return "emerald";
  if (status === "inactive") return "slate";
  if (status === "suspended") return "rose";
  return "slate";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function AdminUsersPage() {
  const { t } = useLocale();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
  const [editRole, setEditRole] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const [passwordUser, setPasswordUser] = useState<AdminUserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [toggleTarget, setToggleTarget] = useState<AdminUserRow | null>(null);
  const [impersonateTarget, setImpersonateTarget] = useState<AdminUserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);

  const usersQuery = useQuery<UsersResponse>({
    queryKey: ["admin", "users", { page, pageSize, search, roleFilter, statusFilter }],
    queryFn: () =>
      apiClient<UsersResponse>("/admin/users", {
        params: {
          page,
          limit: pageSize,
          search: search.trim(),
          role: roleFilter ?? undefined,
          status: statusFilter ?? undefined,
        },
      }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const roles = usersQuery.data?.roles ?? [];

  const updateMutation = useMutation({
    mutationFn: (input: { userId: string; body: Record<string, unknown> }) =>
      apiClient(`/admin/users?userId=${input.userId}`, {
        method: "PATCH",
        body: JSON.stringify(input.body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setEditUser(null);
      setToggleTarget(null);
      toast.success(t("admin.users.updated", { defaultValue: "User updated" }));
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.users.updateFailed", { defaultValue: "Update failed" })
      ),
  });

  const passwordMutation = useMutation({
    mutationFn: (input: { userId: string; password: string }) =>
      apiClient(`/admin/users?userId=${input.userId}`, {
        method: "POST",
        body: JSON.stringify({ password: input.password }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      setPasswordUser(null);
      setNewPassword("");
      toast.success(
        t("admin.users.passwordReset", { defaultValue: "Password reset — share it out of band" })
      );
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.users.passwordFailed", { defaultValue: "Password reset failed" })
      ),
  });

  // Irreversible: removes the login account only. The server keeps the ledger,
  // members and audit history, so the tenant's money is untouched — but the
  // member rows lose their linked login, so refetch members too.
  const deleteMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient("/admin/users", { method: "DELETE", params: { userId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      void qc.invalidateQueries({ queryKey: ["members"] });
      setDeleteTarget(null);
      toast.success(t("admin.users.deleted", { defaultValue: "User deleted" }));
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.users.deleteFailed", { defaultValue: "Delete failed" })
      ),
  });

  const impersonateMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient("/admin/impersonate", { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.users.impersonateFailed", { defaultValue: "Could not start session" })
      ),
  });

  const openEdit = (row: AdminUserRow) => {
    setEditUser(row);
    setEditRole(row.role);
    setEditStatus(row.status);
    setEditName(row.fullName);
  };

  const columns: ERPColumn<AdminUserRow>[] = [
    {
      key: "user",
      header: t("admin.users.user", { defaultValue: "User" }),
      render: (row) => (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{row.fullName}</p>
          <p className="font-mono text-[11px] text-muted-foreground truncate">{row.email}</p>
        </div>
      ),
    },
    {
      key: "tenant",
      header: t("admin.users.tenant", { defaultValue: "Tenant" }),
      render: (row) =>
        row.tenantName ? (
          <div className="min-w-0">
            <p className="text-xs text-foreground truncate">{row.tenantName}</p>
            <p className="font-mono text-[11px] text-muted-foreground truncate">{row.tenantSlug}</p>
          </div>
        ) : (
          <span className="font-mono text-[11px] text-primary">
            {t("admin.users.platform", { defaultValue: "Platform" })}
          </span>
        ),
    },
    {
      key: "role",
      header: t("admin.users.role", { defaultValue: "Role" }),
      render: (row) => (
        <span className="font-mono text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
          {row.role}
        </span>
      ),
    },
    {
      key: "status",
      header: t("admin.users.status", { defaultValue: "Status" }),
      render: (row) => <StatusBadge tone={statusTone(row.status)} label={row.status} />,
    },
    {
      key: "lastLogin",
      header: t("admin.users.lastLogin", { defaultValue: "Last login" }),
      render: (row) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {fmtDate(row.lastLoginAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("admin.users.actions", { defaultValue: "Actions" }),
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openEdit(row)}
            title={t("admin.users.edit", { defaultValue: "Edit user" })}
            aria-label={`${t("admin.users.edit", { defaultValue: "Edit user" })}: ${row.email}`}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPasswordUser(row);
              setNewPassword("");
            }}
            title={t("admin.users.resetPassword", { defaultValue: "Reset password" })}
            aria-label={`${t("admin.users.resetPassword", { defaultValue: "Reset password" })}: ${row.email}`}
          >
            <KeyRound size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setToggleTarget(row)}
            title={
              row.status === "active"
                ? t("admin.users.deactivate", { defaultValue: "Deactivate" })
                : t("admin.users.activate", { defaultValue: "Activate" })
            }
            aria-label={`${
              row.status === "active"
                ? t("admin.users.deactivate", { defaultValue: "Deactivate" })
                : t("admin.users.activate", { defaultValue: "Activate" })
            }: ${row.email}`}
          >
            <Power size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!row.impersonatable || impersonateMutation.isPending}
            onClick={() => setImpersonateTarget(row)}
            title={
              row.impersonatable
                ? t("admin.users.impersonate", { defaultValue: "Impersonate" })
                : t("admin.users.cannotImpersonate", { defaultValue: "Platform operators cannot be impersonated" })
            }
            aria-label={`${t("admin.users.impersonate", { defaultValue: "Impersonate" })}: ${row.email}`}
          >
            <UserCheck size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={deleteMutation.isPending}
            onClick={() => setDeleteTarget(row)}
            title={t("admin.users.delete", { defaultValue: "Delete user" })}
            aria-label={`${t("admin.users.delete", { defaultValue: "Delete user" })}: ${row.email}`}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  const dirty =
    editUser !== null &&
    (editRole !== editUser.role ||
      editStatus !== editUser.status ||
      editName.trim() !== editUser.fullName);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel")}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" />
            {t("admin.users.title", { defaultValue: "Global Users" })}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t("admin.users.desc", {
              defaultValue:
                "Every account across every tenant. Change roles, disable access, reset a forgotten password, open a support session, or delete an account.",
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("admin.users.search", { defaultValue: "Search name, email or role…" })}
              className="pl-8 w-64 h-9 text-xs"
            />
          </div>
          <div className="w-36">
            <AppDropdown
              value={roleFilter}
              onChange={(v) => {
                setRoleFilter(v);
                setPage(1);
              }}
              clearable
              options={roles.map((r) => ({ value: r, label: r }))}
              placeholder={t("admin.users.filterRole", { defaultValue: "All roles" })}
            />
          </div>
          <div className="w-36">
            <AppDropdown
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              clearable
              options={STATUSES.map((s) => ({ value: s, label: s }))}
              placeholder={t("admin.users.filterStatus", { defaultValue: "All statuses" })}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void usersQuery.refetch()}
            disabled={usersQuery.isFetching}
            loading={usersQuery.isFetching}
            aria-label={t("common.refresh", { defaultValue: "Refresh" })}
          >
            {!usersQuery.isFetching && <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {usersQuery.isError ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-5 text-center space-y-2">
          <p className="text-sm font-semibold text-foreground">
            {t("admin.users.loadFailed", { defaultValue: "Could not load users" })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void usersQuery.refetch()}>
            {t("common.retry", { defaultValue: "Retry" })}
          </Button>
        </div>
      ) : (
        <ERPDataTable<AdminUserRow>
          data={usersQuery.data?.data ?? []}
          columns={columns}
          loading={usersQuery.isLoading}
          rowKey={(row) => row.id}
          page={page}
          pageSize={pageSize}
          totalCount={usersQuery.data?.meta.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          emptyMessage={t("admin.users.empty", { defaultValue: "No users match these filters" })}
        />
      )}

      {/* Edit role / status / name */}
      <TopSheet
        isOpen={editUser !== null}
        onClose={() => setEditUser(null)}
        title={t("admin.users.editTitle", { defaultValue: "Edit user" })}
        subtitle={editUser?.email ?? ""}
        maxWidth="lg"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="outline" onClick={() => setEditUser(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              disabled={!dirty || updateMutation.isPending}
              loading={updateMutation.isPending}
              onClick={() => {
                if (!editUser) return;
                const body: Record<string, unknown> = {};
                if (editRole !== editUser.role) body.role = editRole;
                if (editStatus !== editUser.status) body.status = editStatus;
                if (editName.trim() !== editUser.fullName) body.name = editName.trim();
                updateMutation.mutate({ userId: editUser.id, body });
              }}
            >
              {t("common.save", { defaultValue: "Save" })}
            </Button>
          </div>
        }
      >
        <ERPFormSection title={t("admin.users.account", { defaultValue: "Account" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("admin.users.fullName", { defaultValue: "Full name" })}>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-xs" />
            </ERPFormField>
            <ERPFormField
              label={t("admin.users.role", { defaultValue: "Role" })}
              hint={t("admin.users.roleHint", {
                defaultValue: "SuperAdmin is platform-wide. Admin is scoped to one tenant.",
              })}
            >
              <AppDropdown
                value={editRole}
                onChange={setEditRole}
                clearable={false}
                options={roles.map((r) => ({ value: r, label: r }))}
              />
            </ERPFormField>
            <ERPFormField
              label={t("admin.users.status", { defaultValue: "Status" })}
              hint={t("admin.users.statusHint", {
                defaultValue: "Deactivated users cannot sign in but keep their data.",
              })}
            >
              <AppDropdown
                value={editStatus}
                onChange={setEditStatus}
                clearable={false}
                options={STATUSES.map((s) => ({ value: s, label: s }))}
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>
      </TopSheet>

      {/* Password reset */}
      <AppModal
        isOpen={passwordUser !== null}
        onClose={() => {
          setPasswordUser(null);
          setNewPassword("");
        }}
        title={t("admin.users.resetPassword", { defaultValue: "Reset password" })}
        maxWidth="md"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button
              variant="outline"
              onClick={() => {
                setPasswordUser(null);
                setNewPassword("");
              }}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              disabled={!newPassword.trim() || passwordMutation.isPending}
              loading={passwordMutation.isPending}
              onClick={() =>
                passwordUser &&
                passwordMutation.mutate({ userId: passwordUser.id, password: newPassword.trim() })
              }
            >
              {t("admin.users.resetAction", { defaultValue: "Reset password" })}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-[11px] text-amber-800 dark:text-amber-200">
              {t("admin.users.passwordWarning", {
                defaultValue:
                  "This overwrites the user's credential immediately. Share it over a channel you trust and ask them to change it.",
              })}
            </p>
          </div>
          <ERPFormField
            label={t("admin.users.newPassword", { defaultValue: "New password" })}
            required
          >
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="text-xs"
            />
          </ERPFormField>
        </div>
      </AppModal>

      <ERPConfirmDialog
        isOpen={toggleTarget !== null}
        onClose={() => setToggleTarget(null)}
        title={
          toggleTarget?.status === "active"
            ? t("admin.users.deactivateTitle", { defaultValue: "Deactivate this user?" })
            : t("admin.users.activateTitle", { defaultValue: "Reactivate this user?" })
        }
        description={
          toggleTarget?.status === "active"
            ? t("admin.users.deactivateDesc", {
                defaultValue: "{email} will no longer be able to sign in.",
                email: toggleTarget?.email ?? "",
              })
            : t("admin.users.activateDesc", {
                defaultValue: "{email} will be able to sign in again.",
                email: toggleTarget?.email ?? "",
              })
        }
        confirmLabel={
          toggleTarget?.status === "active"
            ? t("admin.users.deactivate", { defaultValue: "Deactivate" })
            : t("admin.users.activate", { defaultValue: "Activate" })
        }
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant={toggleTarget?.status === "active" ? "destructive" : "primary"}
        pending={updateMutation.isPending}
        onConfirm={() => {
          if (!toggleTarget) return;
          updateMutation.mutate({
            userId: toggleTarget.id,
            body: { status: toggleTarget.status === "active" ? "inactive" : "active" },
          });
        }}
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

      <ERPConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("admin.users.deleteTitle", { defaultValue: "Delete this user?" })}
        description={t("admin.users.deleteDesc", {
          defaultValue:
            "{email} is removed and can never sign in again; their sessions and personal goals go with them. The tenant, its members, the ledger and the audit history are kept. This cannot be undone.",
          email: deleteTarget?.email ?? "",
        })}
        confirmLabel={t("common.delete", { defaultValue: "Delete" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
