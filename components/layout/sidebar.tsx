"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Crown, Search, X } from "lucide-react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n";
import { isSuperAdminRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { NAVIGATION, NavItem } from "./navigation";

interface SidebarProps {
  companyName: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

function canRead(permissions: Record<string, string> | undefined, id: string): boolean {
  if (id === "DASHBOARD") return true;
  if (!permissions) return true;
  const level = permissions[id];
  return level === "READ" || level === "WRITE";
}

function isSuperAdmin(role?: string): boolean {
  return isSuperAdminRole(role);
}

export function Sidebar({ companyName, collapsed: externalCollapsed, onToggle: externalOnToggle }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { t } = useLocale();

  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = externalCollapsed !== undefined ? externalCollapsed : internalCollapsed;

  const onToggle = useCallback(() => {
    if (externalOnToggle) {
      externalOnToggle();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  }, [externalOnToggle]);

  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl+K / Cmd+K to focus navigation search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (collapsed) {
          onToggle();
          setTimeout(() => searchInputRef.current?.focus(), 150);
        } else {
          searchInputRef.current?.focus();
        }
      }
      if (e.key === "Escape" && searchQuery) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, onToggle, searchQuery]);

  // Clear search on collapse
  useEffect(() => {
    if (collapsed) setSearchQuery("");
  }, [collapsed]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    searchInputRef.current?.focus();
  }, []);

  // Filter navigation by permissions and search query
  const filteredNav = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return NAVIGATION.map((group) => {
      const allowedItems = group.items.filter((item) => canRead(user?.permissions, item.id));
      if (!query) return { ...group, items: allowedItems };

      const matchedItems = allowedItems.filter((item) => {
        const label = t(item.labelKey).toLowerCase();
        return label.includes(query) || item.id.toLowerCase().includes(query);
      });

      return { ...group, items: matchedItems };
    }).filter((group) => group.items.length > 0);
  }, [searchQuery, user?.permissions, t]);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border/50 bg-sidebar transition-all duration-300 shadow-xs",
        collapsed ? "w-[68px]" : "w-[260px]",
      )}
    >
      {/* Brand Header */}
      <div
        className={cn(
          "relative flex h-16 items-center border-b border-sidebar-border px-4",
          collapsed ? "justify-center px-2" : "justify-between",
        )}
      >
        <Link href="/" className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <rect x="4" y="14" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.5" />
              <rect x="9" y="10" width="3" height="10" rx="0.5" fill="currentColor" opacity="0.7" />
              <rect x="14" y="6" width="3" height="14" rx="0.5" fill="currentColor" opacity="0.9" />
              <path
                d="M19 4L19 9M19 4L14 4M19 4L10 13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold tracking-tight text-sidebar-foreground truncate" title={companyName}>
                {companyName}
              </span>
            </div>
          )}
        </Link>

        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t("layout.expandSidebar", { defaultValue: "Expand sidebar" }) : t("layout.collapseSidebar", { defaultValue: "Collapse sidebar" })}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sidebar-border text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors",
            collapsed && "absolute -right-3.5 top-1/2 -translate-y-1/2 rounded-full bg-sidebar shadow-sm",
          )}
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {/* Search Input (Pathshala-Pro quick command filter) */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1">
          <div className="relative group">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60 transition-colors group-focus-within:text-primary" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("common.searchPlaceholder", { defaultValue: "Search navigation..." })}
              className="h-8 w-full rounded-lg border border-sidebar-border bg-slate-100/70 dark:bg-sidebar-accent/50 pl-8 pr-8 text-xs text-sidebar-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-emerald-600/50 focus:bg-sidebar-accent focus:ring-1 focus:ring-emerald-600/25"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label={t("ui.clearSearch", { defaultValue: "Clear search" })}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-[9px] font-mono font-medium text-muted-foreground sm:flex">
                ⌘K
              </kbd>
            )}
          </div>
        </div>
      )}

      {/* Navigation Groups */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3 no-scrollbar">
        {filteredNav.map((group) => (
          <div key={group.groupKey}>
            {!collapsed ? (
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-2 mt-2">
                {t(group.groupKey)}
              </h3>
            ) : (
              <div className="h-px bg-sidebar-border my-2 mx-1" />
            )}

            <ul className="space-y-1">
              {group.items.map((item: NavItem) => {
                const isActive =
                  pathname === item.route ||
                  (item.route !== "/" && pathname.startsWith(item.route));
                const Icon = item.icon;

                return (
                  <li key={item.id}>
                    <Link
                      href={item.route}
                      title={collapsed ? t(item.labelKey) : undefined}
                      className={cn(
                        "w-full flex items-center transition-all duration-150 font-medium text-xs rounded-xl",
                        collapsed ? "p-2.5 justify-center" : "px-3 py-2 gap-2.5",
                        isActive
                          ? "bg-emerald-50 text-emerald-800 font-semibold dark:bg-emerald-950/50 dark:text-emerald-300 shadow-2xs"
                          : "text-sidebar-foreground/80 hover:bg-slate-100/80 dark:hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      )}
                    >
                      <span className={cn(isActive ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                        <Icon size={16} />
                      </span>
                      {!collapsed && (
                        <span className="truncate flex-1 tracking-tight">
                          {t(item.labelKey)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* SuperAdmin Platform Management Link */}
        {isSuperAdmin(user?.role) && (
          <div className="pt-2 border-t border-sidebar-border">
            {!collapsed && (
              <h3 className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-1.5 px-2">
                {t("nav.platform")}
              </h3>
            )}
            <Link
              href="/admin"
              title={collapsed ? t("nav.superadminPanel") : undefined}
              className={cn(
                "w-full flex items-center transition-all duration-150 font-medium text-xs rounded-xl border border-violet-200 dark:border-violet-800/50",
                collapsed ? "p-2.5 justify-center" : "px-3 py-2 gap-2.5",
                pathname.startsWith("/admin")
                  ? "bg-violet-600 text-white font-semibold shadow-xs"
                  : "bg-violet-50/60 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40",
              )}
            >
              <Crown size={16} />
              {!collapsed && (
                <span className="truncate flex-1 font-semibold">
                  {t("nav.superadminPanel")}
                </span>
              )}
            </Link>
          </div>
        )}
      </nav>

      {/* Footer Version Tag (Pathshala-Pro style: v0.1.0 at bottom left) */}
      <div className="border-t border-sidebar-border/60 p-3 select-none">
        <div
          className={cn(
            "text-[11px] font-mono text-muted-foreground/60 transition-colors",
            collapsed ? "text-center" : "px-1.5",
          )}
        >
          {collapsed ? "v0.1" : "v0.1.0"}
        </div>
      </div>
    </aside>
  );
}
