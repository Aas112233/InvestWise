"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useFormatDate } from "@/lib/use-tenant-settings";
import { useLocale } from "@/lib/i18n";
import { normalizeRole } from "@/lib/roles";
import type { PaginatedResponse } from "@/lib/utils/types";
import { ResetPasswordModal } from "./reset-password-modal";
import type { TenantUser } from "./types";
import { UserFormModal } from "./user-form-modal";

function statusTone(status: string): StatusTone {
  const s = (status || "").toLowerCase();
  if (s === "active") return "emerald";
  if (s === "suspended") return "rose";
  return "slate";
}

function roleTone(role: string): StatusTone {
  const r = normalizeRole(role);
  if (r === "Admin") return "emerald";
  if (r === "Manager") return "cyan";
  if (r === "Auditor") return "amber";
  return "slate";
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type ConfirmState =
  | { kind: "deactivate"; user: TenantUser }
  | { kind: "activate"; user: TenantUser }
  | null;

function RowActionsMenu({
  target,
  onEdit,
  onResetPassword,
  onToggleStatus,
}: {
  target: TenantUser;
  onEdit: () => void;
  onResetPassword: () => void;
  onToggleStatus: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const deactivated = target.status !== "active";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node;
      if (btnRef.current?.contains(el) || menuRef.current?.contains(el)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { label: t("users.rowMenu.edit"), icon: <Pencil size={13} />, run: onEdit },
    { label: t("users.rowMenu.resetPassword"), icon: <KeyRound size={13} />, run: onResetPassword },
    {
      label: deactivated ? t("users.rowMenu.activate") : t("users.rowMenu.deactivate"),
      icon: deactivated ? <CheckCircle2 size={13} /> : <Ban size={13} />,
      run: onToggleStatus,
      danger: !deactivated,
    },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={t("users.rowMenu.actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + window.scrollY + 4, left: Math.max(8, r.right + window.scrollX - 200) });
          setOpen(!open);
        }}
        className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
      >
        <MoreVertical size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="z-[100] w-[200px] rounded-lg border border-border/80 bg-card shadow-lg py-1"
            style={{ position: "absolute", top: pos.top, left: pos.left }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  item.danger
                    ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    : "text-foreground hover:bg-muted/60"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

// Tenant-level user directory (Admin/Manager). The platform-only console at
// /admin/users stays untouched; every request here is tenant-scoped server-side.
export function UsersListView() {
  const { t } = useLocale();
  const { user, refreshProfile } = useAuth();

  const callerRole = user ? normalizeRole(user.role) : null;
  const canView = callerRole === "Admin" || callerRole === "Manager" || callerRole === "SuperAdmin";
  const canManage = callerRole === "Admin" || callerRole === "SuperAdmin";

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantUser | null>(null);
  const [resetTarget, setResetTarget] = useState<TenantUser | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = useQuery({
    queryKey: ["users", { page, pageSize, search, status, sortBy, sortOrder }],
    queryFn: () =>
      apiClient<PaginatedResponse<TenantUser>>("/auth/users", {
        params: {
          page,
          limit: pageSize,
          search: search || undefined,
          status: status || undefined,
          sortBy,
          sortOrder,
        },
      }),
    enabled: canView,
    placeholderData: (prev) => prev,
  });

  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      apiClient(`/auth/users/${id}`, { method: "PATCH", body: JSON.stringify({ status: next }) }),
    onSuccess: () => {
      invalidate();
      if (confirm?.user.id === user?.id) void refreshProfile();
      toast.success(
        t(confirm?.kind === "activate" ? "users.activatedToast" : "users.deactivatedToast", {
          name: confirm?.user.name ?? "",
        }),
      );
      setConfirm(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("users.errors.saveFailed")),
  });

  const onSort = (field: string) => {
    if (sortBy === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const formatDate = useFormatDate();
  const rows = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;

  const columns: ERPColumn<TenantUser>[] = [
    {
      key: "name",
      header: t("users.columns.user"),
      sortable: true,
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold flex items-center justify-center shrink-0">
            {initials(u.name)}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{u.name}</p>
            <p className="text-[11px] text-slate-400 truncate max-w-[220px]">{u.email}</p>
            {(u.memberName || u.memberCode) && (
              <p className="text-[10px] uppercase tracking-wider text-slate-400 truncate max-w-[220px]">
                {u.memberCode ? `${u.memberName ?? ""} · ${u.memberCode}` : (u.memberName ?? "")}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: t("users.columns.role"),
      sortable: true,
      render: (u) => (
        <StatusBadge tone={roleTone(u.role)}>
          {t(`users.roleLabels.${normalizeRole(u.role)}`, { defaultValue: u.role })}
        </StatusBadge>
      ),
    },
    {
      key: "status",
      header: t("users.columns.status"),
      sortable: true,
      render: (u) => (
        <StatusBadge tone={statusTone(u.status)}>
          {t(`users.statusLabels.${(u.status || "active").toLowerCase()}`, { defaultValue: u.status })}
        </StatusBadge>
      ),
    },
    {
      key: "lastLogin",
      header: t("users.columns.lastLogin"),
      sortable: true,
      render: (u) =>
        u.lastLogin ? (
          <span className="text-[11px] whitespace-nowrap">{formatDate(u.lastLogin, true)}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "createdAt",
      header: t("users.columns.created"),
      sortable: true,
      render: (u) => <span className="text-[11px] whitespace-nowrap">{formatDate(u.createdAt)}</span>,
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: t("users.columns.actions"),
            align: "right" as const,
            render: (u: TenantUser) => (
              <RowActionsMenu
                target={u}
                onEdit={() => {
                  setEditing(u);
                  setFormOpen(true);
                }}
                onResetPassword={() => setResetTarget(u)}
                onToggleStatus={() =>
                  setConfirm(
                    u.status === "active"
                      ? { kind: "deactivate", user: u }
                      : { kind: "activate", user: u },
                  )
                }
              />
            ),
          },
        ]
      : []),
  ];

  const statusOptions = ["active", "inactive", "suspended"].map((s) => ({
    value: s,
    label: t(`users.statusLabels.${s}`),
  }));

  if (!canView) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("users.noAccess")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {t("users.title")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t("users.totalUsers", { count: total })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => query.refetch()} loading={query.isFetching} icon={<RefreshCw size={13} />}>
            {t("users.refresh")}
          </Button>
          {canManage && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t("users.addUser")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("users.searchPlaceholder")}
            aria-label={t("users.searchPlaceholder")}
            className="w-full bg-card pl-9 pr-3 py-2 rounded-lg border border-border/80 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
        </div>
        <div className="w-full sm:w-48">
          <AppDropdown
            options={statusOptions}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            placeholder={t("users.allStatuses")}
          />
        </div>
      </div>

      <ERPDataTable
        data={rows}
        columns={columns}
        isLoading={query.isLoading}
        loadingRowCount={pageSize}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={onSort}
        rowKey={(u) => u.id}
        page={page}
        pageSize={pageSize}
        totalCount={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        emptyMessage={query.isError ? t("users.errors.loadFailed") : t("users.empty")}
      />

      <UserFormModal
        open={formOpen}
        initial={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={invalidate}
      />

      <ResetPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} />

      <ERPConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "activate" ? t("users.activateTitle") : t("users.deactivateTitle")}
        description={
          confirm?.kind === "activate"
            ? t("users.activateMessage", { name: confirm.user.name })
            : t("users.deactivateMessage", { name: confirm?.user.name ?? "" })
        }
        confirmLabel={confirm?.kind === "activate" ? t("users.rowMenu.activate") : t("users.rowMenu.deactivate")}
        cancelLabel={t("common.cancel")}
        confirmVariant={confirm?.kind === "activate" ? "primary" : "destructive"}
        pending={statusMutation.isPending}
        onClose={() => {
          if (!statusMutation.isPending) setConfirm(null);
        }}
        onConfirm={() => {
          if (!confirm) return;
          statusMutation.mutate({
            id: confirm.user.id,
            next: confirm.kind === "deactivate" ? "suspended" : "active",
          });
        }}
      />
    </div>
  );
}
