"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { Button, Input } from "@/components/ui";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { StatusBadge } from "@/components/ui/status-badge";

interface ImpersonatableUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  tenantName: string | null;
  tenantSlug: string | null;
}

interface SearchResponse {
  data: ImpersonatableUser[];
  meta: { total: number };
}

interface ActiveSession {
  targetUserId: string;
  targetEmail: string;
  tenantId: string | null;
  expiresIn: string;
}

/**
 * Support sessions. The credential is set as an HttpOnly cookie by the server —
 * it is never rendered here, never in React state, never in the clipboard. This
 * page therefore only selects a target and navigates; there is deliberately no
 * token textarea to leak.
 */
export default function AdminImpersonatePage() {
  const { t } = useLocale();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ImpersonatableUser | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);

  const searchQuery = useQuery<SearchResponse>({
    queryKey: ["admin", "impersonate-search", search],
    queryFn: () =>
      apiClient<SearchResponse>("/admin/users", {
        params: { search: search.trim(), limit: 20, impersonatable: true },
      }),
    staleTime: 30_000,
  });

  const issueMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient<{ success: boolean; data: ActiveSession }>("/admin/impersonate", {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),
    onSuccess: (res) => {
      setActive(res.data);
      toast.success(
        t("admin.impersonate.started", {
          defaultValue: "Support session started — opening {email}",
          email: res.data.targetEmail,
        })
      );
      // Full navigation so the server layout re-reads the swapped cookie.
      router.push("/");
      router.refresh();
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.impersonate.issueFailed", { defaultValue: "Could not start session" })
      ),
  });

  const columns: ERPColumn<ImpersonatableUser>[] = [
    {
      key: "user",
      header: t("admin.impersonate.user", { defaultValue: "User" }),
      render: (row) => (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{row.fullName}</p>
          <p className="font-mono text-[11px] text-muted-foreground truncate">{row.email}</p>
        </div>
      ),
    },
    {
      key: "tenant",
      header: t("admin.impersonate.tenant", { defaultValue: "Tenant" }),
      render: (row) => (
        <div className="min-w-0">
          <p className="text-xs text-foreground truncate">{row.tenantName ?? "—"}</p>
          {row.tenantSlug && (
            <p className="font-mono text-[11px] text-muted-foreground truncate">{row.tenantSlug}</p>
          )}
        </div>
      ),
    },
    {
      key: "role",
      header: t("admin.impersonate.role", { defaultValue: "Role" }),
      render: (row) => (
        <span className="font-mono text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
          {row.role}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("admin.impersonate.actions", { defaultValue: "Action" }),
      align: "right",
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSelected(row);
            issueMutation.mutate(row.id);
          }}
          disabled={issueMutation.isPending}
          className="gap-1.5"
        >
          <LogIn size={13} />
          <span>{t("admin.impersonate.start", { defaultValue: "Start session" })}</span>
        </Button>
      ),
    },
  ];

  // Leaving /admin while impersonating is impossible via the sidebar (layout
  // gate), so offer a visible exit wherever the operator lands.
  useEffect(() => {
    if (active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (issueMutation.isSuccess) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active, issueMutation.isSuccess]);

  return (
    <div className="space-y-4">
      <div className="pb-2 border-b border-border/80">
        <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
          {t("nav.superadminPanel")}
        </p>
        <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          {t("admin.impersonate.title", { defaultValue: "Support Sessions" })}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          {t("admin.impersonate.desc", {
            defaultValue:
              "Open a 30-minute support session as a tenant user. The credential is issued as an HttpOnly cookie, and every action is audit-logged under your admin identity.",
          })}
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
        <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-[11px] text-amber-800 dark:text-amber-200">
          {t("admin.impersonate.auditNote", {
            defaultValue:
              "Platform operators cannot be impersonated. Starting a session replaces your login cookies for 30 minutes.",
          })}
        </p>
      </div>

      {selected && issueMutation.isPending && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 animate-pulse text-amber-500" />
          {t("admin.impersonate.starting", {
            defaultValue: "Opening session as {email}…",
            email: selected.email,
          })}
        </div>
      )}

      <div className="flex items-center justify-end">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("admin.impersonate.search", { defaultValue: "Search by name, email or role…" })}
          className="w-72 h-9 text-xs"
        />
      </div>

      <ERPDataTable<ImpersonatableUser>
        data={searchQuery.data?.data ?? []}
        columns={columns}
        loading={searchQuery.isLoading}
        rowKey={(row) => row.id}
        totalCount={searchQuery.data?.meta.total ?? 0}
        emptyMessage={t("admin.impersonate.empty", { defaultValue: "No impersonatable users found" })}
      />

      {searchQuery.isError && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-foreground">
              {t("admin.impersonate.searchFailed", { defaultValue: "Could not load users" })}
            </p>
            <Button variant="outline" size="sm" onClick={() => void searchQuery.refetch()}>
              {t("common.retry", { defaultValue: "Retry" })}
            </Button>
          </div>
        </div>
      )}

      {active && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <StatusBadge tone="amber" label="active" />
          <span className="font-mono">{active.targetEmail}</span>
        </div>
      )}
    </div>
  );
}
