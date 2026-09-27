"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  Eye,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
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
import { hasScreenPermission } from "@/lib/permissions";
import { formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency } from "@/lib/use-tenant-settings";
import type { PaginatedResponse } from "@/lib/utils/types";
import type { Member } from "@/types";
import { MemberDetailSheet } from "./member-detail-sheet";
import { MemberFormModal } from "./member-form-modal";

function depositTotal(m: Member): number {
  return Number(m.successfulDepositTotal ?? m.totalDeposits ?? m.totalContributed ?? 0) || 0;
}

function statusTone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (s === "active") return "emerald";
  if (s === "pending") return "amber";
  if (s === "suspended") return "rose";
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
  | { kind: "suspend"; member: Member }
  | { kind: "activate"; member: Member }
  | { kind: "delete"; member: Member }
  | null;

function RowActionsMenu({
  member,
  canWrite,
  onView,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  member: Member;
  canWrite: boolean;
  onView: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const suspended = member.status === "suspended";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
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
  }, [open ]);

  const items = [
    { label: t("members.rowMenu.view"), icon: <Eye size={13} />, run: onView, danger: false, show: true },
    { label: t("members.rowMenu.edit"), icon: <Pencil size={13} />, run: onEdit, danger: false, show: canWrite },
    {
      label: suspended ? t("members.rowMenu.activate") : t("members.rowMenu.suspend"),
      icon: suspended ? <CheckCircle2 size={13} /> : <Ban size={13} />,
      run: onToggleStatus,
      danger: false,
      show: canWrite,
    },
    { label: t("members.rowMenu.delete"), icon: <Trash2 size={13} />, run: onDelete, danger: true, show: canWrite },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + window.scrollY + 4, left: Math.max(8, r.right + window.scrollX - 180) });
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
            className="z-[100] w-[180px] rounded-lg border border-border/80 bg-card shadow-lg py-1"
            style={{ position: "absolute", top: pos.top, left: pos.left }}
          >
            {items
              .filter((i) => i.show)
              .map((item) => (
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

// Master member directory table (behavioral port of client Members.tsx list).
// Server-driven search/filter/sort/pagination over GET /api/members with the
// hierarchical ["members", params] query key (Rule §7).
export function MembersListView() {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const canWrite = hasScreenPermission(user, "MEMBERS", "WRITE");

  const currency = useTenantCurrency();

  const query = useQuery({
    queryKey: ["members", { page, pageSize, search, status, sortBy, sortOrder }],
    queryFn: () =>
      apiClient<PaginatedResponse<Member>>("/members", {
        params: {
          page,
          limit: pageSize,
          search: search || undefined,
          status: status || undefined,
          sortBy,
          sortOrder,
        },
      }),
    placeholderData: (prev) => prev,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["members"] });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      apiClient(`/members/${id}`, { method: "PUT", body: JSON.stringify({ status: next }) }),
    onSuccess: (_, vars) => {
      invalidate();
      toast.success(
        t(vars.next === "suspended" ? "members.suspendedToast" : "members.activatedToast", {
          name: confirm?.member.name ?? "",
        }),
      );
      setConfirm(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("members.errors.saveFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient(`/members/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success(t("members.deletedToast", { name: confirm?.member.name ?? "" }));
      setConfirm(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("members.errors.saveFailed")),
  });

  const onSort = (field: string) => {
    if (sortBy === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const rows = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;

  const columns: ERPColumn<Member>[] = [
    {
      key: "memberId",
      header: t("members.columns.code"),
      sortable: true,
      render: (m) => (
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-blue-600/10 text-blue-700 dark:text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0">
            {initials(m.name)}
          </span>
          <span className="font-mono text-[11px] font-semibold">{m.memberId}</span>
        </div>
      ),
    },
    {
      key: "name",
      header: t("members.columns.name"),
      sortable: true,
      render: (m) => (
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">{m.name}</p>
          {m.role && <p className="text-[10px] text-slate-400">{m.role}</p>}
        </div>
      ),
    },
    {
      key: "email",
      header: t("members.columns.contact"),
      render: (m) => (
        <div className="text-[11px]">
          <p className="text-slate-600 dark:text-slate-300">{m.phone || "—"}</p>
          <p className="text-slate-400 truncate max-w-[200px]">{m.email || "—"}</p>
        </div>
      ),
    },
    {
      key: "shares",
      header: t("members.columns.shares"),
      sortable: true,
      align: "right",
      render: (m) => <span className="font-mono">{m.shares}</span>,
    },
    {
      key: "totalContributed",
      header: t("members.columns.contributed"),
      sortable: true,
      align: "right",
      render: (m) => <span className="font-mono">{formatMoney(depositTotal(m), currency)}</span>,
    },
    {
      key: "warningCount",
      header: t("members.columns.warnings"),
      align: "center",
      render: (m) => (
        <StatusBadge tone={(m.warningCount ?? 0) > 0 ? "amber" : "slate"}>
          {m.warningCount ?? 0}
        </StatusBadge>
      ),
    },
    {
      key: "status",
      header: t("members.columns.status"),
      sortable: true,
      render: (m) => (
        <StatusBadge tone={statusTone(m.status)}>
          {t(`members.statusLabels.${m.status.toLowerCase()}`, { defaultValue: m.status })}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: t("members.columns.actions"),
      align: "right",
      render: (m) => (
        <RowActionsMenu
          member={m}
          canWrite={canWrite}
          onView={() => setDetailId(m.memberId || m.id)}
          onEdit={() => {
            setEditing(m);
            setFormOpen(true);
          }}
          onToggleStatus={() =>
            setConfirm(m.status === "suspended" ? { kind: "activate", member: m } : { kind: "suspend", member: m })
          }
          onDelete={() => setConfirm({ kind: "delete", member: m })}
        />
      ),
    },
  ];

  const statusOptions = ["active", "pending", "inactive", "suspended"].map((s) => ({
    value: s,
    label: t(`members.statusLabels.${s}`),
  }));

  const confirmBusy = statusMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {t("members.stakeholders")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t("members.totalPartners")}: {total}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => query.refetch()} loading={query.isFetching} icon={<RefreshCw size={13} />}>
            {t("members.refresh")}
          </Button>
          {canWrite && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t("members.addMember")}
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
            placeholder={t("members.searchPlaceholder")}
            aria-label={t("members.searchPlaceholder")}
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
            placeholder={t("members.allStatuses")}
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
        rowKey={(m) => m.id}
        page={page}
        pageSize={pageSize}
        totalCount={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        emptyMessage={query.isError ? t("members.errors.loadFailed") : t("members.noMembers")}
        emptyAction={
          canWrite && !query.isError ? (
            <Button
              variant="outline"
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t("members.addMember")}
            </Button>
          ) : undefined
        }
      />

      <MemberFormModal
        open={formOpen}
        initial={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={invalidate}
      />

      <MemberDetailSheet
        memberId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(m) => {
          setDetailId(null);
          setEditing(m);
          setFormOpen(true);
        }}
      />

      <ERPConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "suspend"
            ? t("members.suspendTitle")
            : confirm?.kind === "activate"
              ? t("members.activateTitle")
              : t("members.deleteTitle")
        }
        description={
          confirm?.kind === "suspend"
            ? t("members.suspendMessage", { name: confirm.member.name })
            : confirm?.kind === "activate"
              ? t("members.activateMessage", { name: confirm.member.name })
              : t("members.deleteMessage", { name: confirm?.member.name ?? "" })
        }
        confirmLabel={
          confirm?.kind === "suspend"
            ? t("members.rowMenu.suspend")
            : confirm?.kind === "activate"
              ? t("members.rowMenu.activate")
              : t("members.rowMenu.delete")
        }
        cancelLabel={t("common.cancel")}
        confirmVariant={confirm?.kind === "activate" ? "primary" : "destructive"}
        pending={confirmBusy}
        onClose={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "delete") deleteMutation.mutate(confirm.member.id);
          else
            statusMutation.mutate({
              id: confirm.member.id,
              next: confirm.kind === "suspend" ? "suspended" : "active",
            });
        }}
      />
    </div>
  );
}
