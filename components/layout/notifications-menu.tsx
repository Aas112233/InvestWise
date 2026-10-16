"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api-client";
import { normalizeRole } from "@/lib/roles";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n";
import { useTenantDateFormat } from "@/lib/use-tenant-settings";
import { formatDatePattern } from "@/lib/formatters";
import { Skeleton, StatusBadge, type StatusTone } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface AuditNotification {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  userName: string | null;
  createdAt: string;
}

/**
 * Mirrors actionTone() in components/audit/audit-logs-view.tsx so an event
 * keeps the same colour whether it is read here or in the full audit log.
 */
function actionTone(action: string): StatusTone {
  const a = action.toUpperCase();
  if (a.includes("DELETE") || a.includes("LOCK") || a.includes("SUSPEND") || a.includes("REVOKE") || a.includes("FAIL")) {
    return "rose";
  }
  if (a.includes("CREATE") || a.includes("LOGIN") || a.includes("APPROVE") || a.includes("SUCCESS")) {
    return "emerald";
  }
  if (a.includes("UPDATE") || a.includes("EDIT") || a.includes("WARN") || a.includes("PENDING")) {
    return "amber";
  }
  if (a.includes("EXPORT") || a.includes("SYNC") || a.includes("NOTIF")) {
    return "cyan";
  }
  return "slate";
}

/** The audit feed is restricted to the same roles the route itself allows. */
const NOTIFICATION_ROLES = new Set(["SuperAdmin", "Admin", "Manager"]);

/**
 * #56: the feed used to print the raw audit constant ("UPDATE_SETTINGS") and
 * the internal handle ("asa"). Translate the constant into a sentence; fall
 * back to a de-underscored, title-cased rendering for actions with no key yet
 * rather than leaking SCREAMING_SNAKE_CASE.
 */
function actionLabel(t: (key: string, opts?: { defaultValue?: string }) => string, action: string): string {
  const fallback = action
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return t(`layout.notificationsActions.${action}`, { defaultValue: fallback });
}

/** A handle like "asa" or "munshi" is not a display name — title-case it. */
function displayName(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  // Emails: show the local part, title-cased.
  const local = value.includes("@") ? value.split("@")[0] : value;
  if (!local) return value;
  // A single lowercase token with no spaces reads as a handle.
  if (/^[a-z0-9._-]+$/.test(local)) {
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return local;
}

const SEEN_STORAGE_KEY = "iw.notifications.lastSeenAt";
const POLL_MS = 60_000;

function readLastSeen(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Header bell + activity panel. The feed is the tenant's own audit trail
 * (GET /api/audit/notifications — last 20 write events within 48h), so there is
 * no separate notification store to keep in sync.
 */
export function NotificationsMenu() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLocale();
  const dateFormat = useTenantDateFormat();

  const [open, setOpen] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Notification timestamps are rendered client-side only — a server/client
  // clock difference would trip React hydration, same as the header date.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const canView = useMemo(
    () => NOTIFICATION_ROLES.has(normalizeRole(user?.role)),
    [user?.role],
  );

  useEffect(() => {
    if (mounted) setLastSeenAt(readLastSeen());
  }, [mounted]);

  const query = useQuery({
    queryKey: ["audit", "notifications"],
    queryFn: () => apiClient<AuditNotification[]>("/audit/notifications"),
    enabled: canView,
    staleTime: 30_000,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    // 403 here means "role cannot read the audit feed", which the panel renders
    // as an explicit state — not a failure worth retrying.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 403) && failureCount < 2,
  });

  // Memoized so the empty fallback is a stable reference — otherwise `items`
  // is a new array every render and the unread useMemo below never caches.
  const items = useMemo(() => query.data ?? [], [query.data]);
  const restricted = query.error instanceof ApiError && query.error.status === 403;

  const unreadCount = useMemo(() => {
    if (lastSeenAt === 0) return 0;
    return items.filter((item) => new Date(item.createdAt).getTime() > lastSeenAt).length;
  }, [items, lastSeenAt]);

  const markSeen = useCallback(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    window.localStorage.setItem(SEEN_STORAGE_KEY, String(now));
    setLastSeenAt(now);
  }, []);

  // Opening the panel counts as reading it, so the badge clears on open and
  // only re-appears for events that arrive afterwards.
  useEffect(() => {
    if (open && !query.isLoading && !query.isError) markSeen();
  }, [open, query.isLoading, query.isError, markSeen]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const relativeTime = useCallback(
    (iso: string) => {
      const then = new Date(iso).getTime();
      if (!Number.isFinite(then)) return "";
      const minutes = Math.floor((Date.now() - then) / 60_000);
      if (minutes < 1) return t("layout.notificationsJustNow", { defaultValue: "Just now" });
      if (minutes < 60) {
        return t("layout.notificationsMinutesAgo", {
          defaultValue: "{count}m ago",
          count: minutes,
        });
      }
      const hours = Math.floor(minutes / 60);
      if (hours < 24) {
        return t("layout.notificationsHoursAgo", { defaultValue: "{count}h ago", count: hours });
      }
      return t("layout.notificationsDaysAgo", { defaultValue: "{count}d ago", count: Math.floor(hours / 24) });
    },
    [t],
  );

  const renderBody = () => {
    if (!canView || restricted) {
      return (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <div className="rounded-full bg-muted p-2.5 text-muted-foreground">
            <BellOff className="h-4 w-4" />
          </div>
          <p className="text-xs font-semibold text-foreground">
            {t("layout.notificationsRestricted", {
              defaultValue: "No activity feed for your role",
            })}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("layout.notificationsRestrictedHint", {
              defaultValue: "Admins and managers can review recent changes.",
            })}
          </p>
        </div>
      );
    }

    if (query.isLoading) {
      return (
        <div className="space-y-3 p-3" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-2.5">
              <Skeleton width="2rem" height="2rem" borderRadius="0.5rem" />
              <div className="flex-1 space-y-1.5">
                <Skeleton width="70%" height="0.625rem" borderRadius="0.25rem" />
                <Skeleton width="40%" height="0.5rem" borderRadius="0.25rem" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (query.isError) {
      return (
        <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
          <p className="text-xs font-semibold text-destructive">
            {t("layout.notificationsLoadFailed", { defaultValue: "Could not load notifications" })}
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className={cn("h-3 w-3", query.isFetching && "animate-spin")} />
            {t("layout.notificationsRetry", { defaultValue: "Retry" })}
          </button>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <div className="rounded-full bg-muted p-2.5 text-muted-foreground">
            <Bell className="h-4 w-4" />
          </div>
          <p className="text-xs font-semibold text-foreground">
            {t("layout.notificationsEmpty", { defaultValue: "You're all caught up" })}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("layout.notificationsEmptyHint", {
              defaultValue: "Changes from the last 48 hours appear here.",
            })}
          </p>
        </div>
      );
    }

    return (
      <ul className="divide-y divide-border/50">
        {items.map((item) => {
          const stamp = new Date(item.createdAt).getTime();
          const isUnread = lastSeenAt > 0 && stamp > lastSeenAt;
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/50",
                isUnread && "bg-primary/[0.04]",
              )}
            >
              {isUnread && (
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                  aria-label={t("layout.notificationsNew", { defaultValue: "New" })}
                />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <StatusBadge tone={actionTone(item.action)}>{actionLabel(t, item.action)}</StatusBadge>
                  {item.resourceType && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {item.resourceType}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-foreground">
                  {displayName(item.userName) ||
                    t("layout.notificationsUnknownUser", { defaultValue: "System" })}
                </p>
                <p
                  className="text-[10px] text-muted-foreground"
                  title={formatDatePattern(item.createdAt, dateFormat, true)}
                >
                  {mounted ? relativeTime(item.createdAt) : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t("layout.notifications", { defaultValue: "Notifications" })}
        title={t("layout.notifications", { defaultValue: "Notifications" })}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          open && "bg-muted text-foreground",
        )}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-background">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        {unreadCount === 0 && query.isFetching && (
          <Loader2 className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-spin text-muted-foreground/60" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-96 max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-border/80 dark:border-white/10 bg-popover shadow-xl z-50 animate-in fade-in-50 zoom-in-95">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                {t("layout.notifications", { defaultValue: "Notifications" })}
              </span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                  {unreadCount > 9 ? "9+" : unreadCount} {t("layout.notificationsNew", { defaultValue: "new" })}
                </span>
              )}
            </div>
            {canView && !query.isError && (
              <button
                type="button"
                onClick={() => query.refetch()}
                aria-label={t("layout.notificationsRefresh", { defaultValue: "Refresh notifications" })}
                title={t("layout.notificationsRefresh", { defaultValue: "Refresh" })}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")} />
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">{renderBody()}</div>

          {canView && !query.isError && !query.isLoading && items.length > 0 && (
            <div className="border-t border-border/60 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push("/audit");
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
              >
                <ScrollText className="h-3.5 w-3.5" />
                {t("layout.notificationsViewAll", { defaultValue: "View full audit log" })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
