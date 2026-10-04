"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Building2,
  Check,
  ChevronDown,
  CreditCard,
  Flag,
  Globe,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  Megaphone,
  Moon,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { LOCALES, useLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ADMIN_NAV_GROUPS = [
  {
    labelKey: "admin.nav.management",
    fallback: "Management",
    items: [
      { route: "/admin", labelKey: "admin.nav.overview", fallback: "Overview", icon: LayoutDashboard },
      { route: "/admin/tenants", labelKey: "admin.nav.tenants", fallback: "Tenants", icon: Building2 },
      { route: "/admin/users", labelKey: "admin.nav.users", fallback: "Users", icon: UserCheck },
      { route: "/admin/billing", labelKey: "admin.nav.billing", fallback: "Billing", icon: CreditCard },
      { route: "/admin/feature-flags", labelKey: "admin.nav.featureFlags", fallback: "Modules", icon: Flag },
      {
        route: "/admin/impersonate",
        labelKey: "admin.nav.impersonate",
        fallback: "Support Sessions",
        icon: KeyRound,
      },
    ],
  },
  {
    labelKey: "admin.nav.system",
    fallback: "Platform & System",
    items: [
      { route: "/admin/diagnostics", labelKey: "admin.nav.diagnostics", fallback: "Diagnostics", icon: Activity },
      { route: "/admin/audit-logs", labelKey: "admin.nav.auditLogs", fallback: "Audit Logs", icon: ShieldAlert },
      { route: "/admin/notices", labelKey: "admin.nav.notices", fallback: "Broadcasts", icon: Megaphone },
      { route: "/admin/settings", labelKey: "admin.nav.settings", fallback: "Settings", icon: Settings },
    ],
  },
];

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ur: "اردو",
  hi: "हिन्दी",
  bn: "বাংলা",
};

export function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const [mounted, setMounted] = useState(false);
  const [localeOpen, setLocaleOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const localeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (localeDropdownRef.current && !localeDropdownRef.current.contains(target)) {
        setLocaleOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      router.push("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }, [logout, router]);

  const allItems = ADMIN_NAV_GROUPS.flatMap((g) => g.items);
  const currentNav = allItems.find((item) =>
    item.route === "/admin" ? pathname === "/admin" : pathname.startsWith(item.route),
  );
  const activeTitle = currentNav
    ? t(currentNav.labelKey, { defaultValue: currentNav.fallback })
    : t("nav.superadminPanel", { defaultValue: "Platform Administration" });

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Sidebar - Pathshala-Pro System Admin styling */}
      <aside className="w-[240px] shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col py-4 px-3 overflow-hidden select-none">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 mb-6">
          <Link href="/admin" className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-2xs">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
                  InvestWise
                </span>
                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 font-mono font-bold">
                  SYSTEM
                </span>
              </div>
            </div>
          </Link>
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-1">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.labelKey} className="space-y-1">
              <div className="px-2 mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {t(group.labelKey, { defaultValue: group.fallback })}
                </p>
              </div>
              {group.items.map((item) => {
                const isActive =
                  item.route === "/admin" ? pathname === "/admin" : pathname.startsWith(item.route);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.route}
                    href={item.route}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary border border-primary/20 font-semibold shadow-2xs"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon
                      size={15}
                      className={cn(
                        "shrink-0 transition-colors",
                        isActive
                          ? "text-primary"
                          : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground",
                      )}
                    />
                    <span className="truncate flex-1">
                      {t(item.labelKey, { defaultValue: item.fallback })}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer Area */}
        <div className="pt-3 border-t border-sidebar-border px-1 space-y-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <LayoutDashboard size={14} className="text-primary shrink-0" />
            <span className="truncate flex-1">
              {t("admin.nav.backToApp", { defaultValue: "Switch to Main App" })}
            </span>
          </Link>

          <div className="flex items-center justify-between px-2 pt-1 text-[11px] text-sidebar-foreground/50">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
                {t("admin.nav.platformHealthy", { defaultValue: "Platform Healthy" })}
              </span>
            </div>
            <span className="text-[10px] font-mono text-sidebar-foreground/40">v0.1.0</span>
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Admin Top Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/50 bg-background/95 px-6 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base font-bold tracking-tight text-foreground whitespace-nowrap">
              {activeTitle}
            </h1>
            <div className="h-4 w-[1px] bg-border/80 hidden sm:block shrink-0" />
            <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap font-mono text-[11px] truncate max-w-[220px]">
                {email}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Locale Switcher */}
            <div className="relative" ref={localeDropdownRef}>
              <button
                type="button"
                onClick={() => setLocaleOpen(!localeOpen)}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  localeOpen && "bg-muted text-foreground",
                )}
                title={t("layout.language", { defaultValue: "Language" })}
                aria-label={t("layout.languageSelection", { defaultValue: "Language selection" })}
              >
                <Globe className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">
                  {LOCALE_LABELS[locale] || locale.toUpperCase()}
                </span>
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", localeOpen && "rotate-180")}
                />
              </button>
              {localeOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl border border-border/80 bg-popover p-1 shadow-xl z-50 animate-in fade-in-50 zoom-in-95">
                  {LOCALES.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => {
                        setLocale(l);
                        setLocaleOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-accent",
                        "text-popover-foreground",
                        locale === l && "bg-accent font-semibold text-primary",
                      )}
                    >
                      <span>{LOCALE_LABELS[l]}</span>
                      {locale === l && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={() => {
                const active = theme === "system" ? resolvedTheme : theme;
                setTheme(active === "dark" ? "light" : "dark");
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground relative"
              title={t("layout.toggleTheme", { defaultValue: "Toggle theme" })}
              aria-label={t("layout.toggleTheme", { defaultValue: "Toggle theme" })}
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-teal-400" />
            </button>

            {/* Logout button */}
            <button
              type="button"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-border/60 bg-card px-3 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
              title={t("auth.logout", { defaultValue: "Logout" })}
            >
              {isLoggingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {t("auth.logout", { defaultValue: "Logout" })}
              </span>
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-background">
          <div className="max-w-[1600px] mx-auto pb-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
