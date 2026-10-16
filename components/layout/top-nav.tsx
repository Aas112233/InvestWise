"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  Calendar,
  CalendarRange,
  Check,
  ChevronDown,
  Globe,
  Loader2,
  LogOut,
  Moon,
  Shield,
  ShieldAlert,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { apiClient, ApiError } from "@/lib/api-client";
import { useTenantSettings, useTenantDateFormat } from "@/lib/use-tenant-settings";
import { formatDatePattern } from "@/lib/formatters";
import { fiscalStartYearForDate, resolveFiscalBounds } from "@/lib/fiscal-periods";
import { LOCALES, useLocale, type Locale } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationsMenu } from "./notifications-menu";
import { cn } from "@/lib/utils";

export interface TenantOption {
  id: string;
  name: string;
}

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ur: "اردو",
  hi: "हिन्दी",
  bn: "বাংলা",
};

function getBreadcrumbKey(pathname: string): string {
  if (pathname === "/" || !pathname) return "nav.dashboard";
  const segment = pathname.split("/").filter(Boolean)[0];
  const map: Record<string, string> = {
    dashboard: "nav.dashboard",
    members: "nav.members",
    meetings: "nav.meetings",
    governance: "nav.governance",
    goals: "nav.goals",
    deposits: "nav.deposits",
    transactions: "nav.transactions",
    dividends: "nav.dividends",
    fiscal: "nav.fiscal",
    expenses: "nav.expenses",
    projects: "nav.projectMgmt",
    funds: "nav.fundsMgmt",
    analysis: "nav.analysis",
    reports: "nav.reports",
    audit: "nav.audit",
    settings: "nav.settings",
    admin: "nav.superadminPanel",
  };
  return map[segment ?? ""] ?? "nav.dashboard";
}

export function TopNav({
  tenants = [],
  tenantsLoading = false,
}: {
  tenants?: TenantOption[];
  tenantsLoading?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { user, isLoading: authLoading, logout, tenantId, setTenantId } = useAuth();
  // Settings own the tenant display name (single ["settings"] query, shared
  // cache — no extra fetch) so the pill can skeleton while /api/settings
  // resolves instead of flashing the uuid fallback.
  const { data: tenantSettings, isLoading: tenantNameLoading } = useTenantSettings();
  const { locale, setLocale, t } = useLocale();

  const [localeOpen, setLocaleOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isExitingImpersonation, setIsExitingImpersonation] = useState(false);
  // Today's date renders client-side only — a server/client `new Date()`
  // mismatch across midnight would trip React hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const localeDropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const tenantMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (localeDropdownRef.current && !localeDropdownRef.current.contains(target)) {
        setLocaleOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setProfileOpen(false);
      }
      if (tenantMenuRef.current && !tenantMenuRef.current.contains(target)) {
        setTenantMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
      setProfileOpen(false);
    }
    // The shell paints regardless of auth state, so without navigation the
    // user sits on a dead session looking "not signed out".
    router.push("/login");
  };

  const breadcrumbKey = getBreadcrumbKey(pathname);
  const pageTitle = t(breadcrumbKey, { defaultValue: "Dashboard" });

  // Browser tab reflects the open module ("Reports | InvestWise"), reactive to
  // both route and locale switches. Brand suffix matches the layout metadata
  // template ("%s | InvestWise"), which stays as the SSR/hydration default.
  useEffect(() => {
    document.title = `${pageTitle} | InvestWise`;
  }, [pageTitle]);

  // Support session (impersonation) bar: the /api/auth/me payload carries the
  // admin's impersonatedBy claim. Exiting restores the stashed admin cookies
  // server-side (DELETE /api/admin/impersonate) and returns to the platform
  // panel via full navigation, so the server layout re-reads swapped cookies.
  const impersonating = !!user?.impersonatedBy;
  const handleExitImpersonation = async () => {
    setIsExitingImpersonation(true);
    try {
      await apiClient("/admin/impersonate", { method: "DELETE" });
      window.location.href = "/admin";
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("layout.exitImpersonationFailed", { defaultValue: "Could not exit the session" })
      );
      setIsExitingImpersonation(false);
    }
  };

  // Current date in the tenant's display format (§8 — default DD/MM/YYYY).
  const dateFormat = useTenantDateFormat();
  const todayLabel = formatDatePattern(new Date(), dateFormat);

  // Header context line reads "Today - 05/10/2026": the relative word carries
  // the meaning, the tenant-formatted date stays the precise value.
  const todayText = mounted
    ? `${t("common.today", { defaultValue: "Today" })} - ${todayLabel}`
    : todayLabel;

  // Current fiscal year, derived from the tenant's configured start/end months
  // (§ fiscal periods). Defaults match signup/settings so the pill is correct
  // even before /api/settings resolves. A malformed month name in settings must
  // not take the whole header down, so the helpers are allowed to throw and
  // degrade to the start year alone.
  const fiscalStartMonth = tenantSettings?.financial?.fiscalYearStart || "July";
  const fiscalEndMonth = tenantSettings?.financial?.fiscalYearEnd || "June";
  let currentFiscalYear = "";
  try {
    const startYear = fiscalStartYearForDate(new Date(), fiscalStartMonth);
    currentFiscalYear = resolveFiscalBounds(startYear, fiscalStartMonth, fiscalEndMonth).label;
  } catch {
    currentFiscalYear = "";
  }

  const currentTenant = tenants.find((item) => item.id === tenantId);
  // Header carries the TENANT identity (user spec, 2026-10-04): multi-tenant
  // list match first, then settings companyName, then a scoped uuid, then the
  // app name for SuperAdmin (no tenant scope). While settings resolve, the
  // pill renders as a skeleton instead of flashing the uuid fallback.
  const tenantDisplay =
    currentTenant?.name ??
    tenantSettings?.organization?.companyName ??
    (user?.tenantId ? `Tenant ${user.tenantId.slice(0, 8)}` : "InvestWise");

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // No fake identity fallbacks: an empty state must look empty, or a dead
  // session renders as a "logged in" demo user (the Dr. Garrison Spinka bug).
  const userRole = user?.role ? user.role.replace("_", " ") : "";

  return (
    <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-md">
      {impersonating && (
        <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-amber-950 dark:bg-amber-500/90">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {t("layout.impersonationBanner", {
              defaultValue: "Support session active — you are viewing as {email}. All actions are audit-logged.",
              email: user?.email ?? "",
            })}
          </span>
          <button
            type="button"
            onClick={handleExitImpersonation}
            disabled={isExitingImpersonation}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-amber-900/30 bg-amber-300/70 px-2 py-0.5 text-[11px] font-semibold text-amber-950 transition-colors hover:bg-amber-200 disabled:opacity-50"
          >
            {isExitingImpersonation ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <LogOut className="h-3 w-3" />
            )}
            <span>{t("layout.exitImpersonation", { defaultValue: "Exit impersonation" })}</span>
          </button>
        </div>
      )}
      <div className="flex h-16 items-center justify-between border-b border-border/50 px-6">
      {/* Left - Route Breadcrumb & Tenant Context */}
      <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
        <h1 className="text-base font-bold tracking-tight text-foreground whitespace-nowrap shrink-0">
          {pageTitle}
        </h1>
        <div className="h-4 w-[1px] bg-border/80 hidden sm:block shrink-0" />

        {/* Tenant Organization Pill or Dropdown */}
        {tenants.length > 1 ? (
          <div className="relative hidden sm:block" ref={tenantMenuRef}>
            <button
              type="button"
              onClick={() => setTenantMenuOpen(!tenantMenuOpen)}
              disabled={tenantsLoading}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-emerald-200/90 bg-emerald-50/90 px-2.5 py-1 text-xs font-medium text-emerald-800 transition-all hover:bg-emerald-100/80 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300",
                tenantMenuOpen && "ring-1 ring-emerald-500",
              )}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <span className="whitespace-nowrap tracking-tight truncate max-w-[180px]">
                {tenantDisplay}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 transition-transform",
                  tenantMenuOpen && "rotate-180",
                )}
              />
            </button>
            {tenantMenuOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-56 rounded-xl border border-border/80 dark:border-white/10 bg-popover p-1 shadow-xl z-50 animate-in fade-in-50 zoom-in-95">
                <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("layout.organization", { defaultValue: "Organization" })}
                </div>
                {tenants.map((tn) => (
                  <button
                    key={tn.id}
                    type="button"
                    onClick={() => {
                      setTenantId(tn.id);
                      setTenantMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-accent text-popover-foreground",
                      tenantId === tn.id && "bg-accent font-semibold text-primary",
                    )}
                  >
                    <span className="truncate">{tn.name}</span>
                    {tenantId === tn.id && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-1" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : tenantNameLoading ? (
          <div
            className="hidden sm:flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 w-fit"
            aria-busy="true"
          >
            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <Skeleton width="7rem" height="0.75rem" borderRadius="0.25rem" />
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-emerald-200/90 bg-emerald-50/90 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 w-fit max-w-full truncate">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <span className="whitespace-nowrap tracking-tight truncate">{tenantDisplay}</span>
          </div>
        )}

        {/* Current fiscal year (tenant start/end months) */}
        {mounted && currentFiscalYear && (
          <div
            className="hidden xl:flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground whitespace-nowrap shrink-0"
            title={t("layout.currentFiscalYear", { defaultValue: "Current fiscal year" })}
          >
            <CalendarRange className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t("layout.fiscalYearAbbrev", { defaultValue: "FY" })} {currentFiscalYear}
            </span>
          </div>
        )}

        {/* Today - dd/mm/yyyy (tenant display format) */}
        {mounted && (
          <div
            className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap shrink-0"
            title={todayLabel}
          >
            <Calendar className="h-3.5 w-3.5" />
            {todayText}
          </div>
        )}
      </div>

      {/* Right - Global Controls */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Notifications */}
        <NotificationsMenu />

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
            <span className="hidden sm:inline">{LOCALE_LABELS[locale] || locale.toUpperCase()}</span>
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", localeOpen && "rotate-180")}
            />
          </button>
          {localeOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl border border-border/80 dark:border-white/10 bg-popover p-1 shadow-xl z-50 animate-in fade-in-50 zoom-in-95">
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

        {/* Separator */}
        <div className="h-6 w-[1px] bg-border/80 mx-0.5 hidden sm:block" />

        {/* User Profile Pill */}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setProfileOpen(!profileOpen)}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-2 py-1.5 text-left transition-all hover:bg-muted/60",
              profileOpen && "bg-muted",
            )}
            aria-label={t("layout.userProfileMenu", { defaultValue: "User profile menu" })}
            aria-expanded={profileOpen}
          >
            <div className="relative">
              {authLoading ? (
                <Skeleton variant="circular" width="2rem" height="2rem" className="shrink-0" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#064E3B] dark:bg-emerald-800 text-xs font-bold text-white shadow-2xs">
                  {initials}
                </div>
              )}
              {!authLoading && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
              )}
            </div>
            {authLoading ? (
              <div className="hidden lg:flex flex-col gap-1.5" aria-busy="true">
                <Skeleton width="6rem" height="0.625rem" borderRadius="0.25rem" />
                <Skeleton width="3.25rem" height="0.5625rem" borderRadius="0.25rem" />
              </div>
            ) : (
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-semibold text-foreground leading-tight max-w-[140px] truncate">
                  {user?.name ?? ""}
                </span>
                <span className="text-[11px] text-muted-foreground capitalize leading-tight">
                  {userRole}
                </span>
              </div>
            )}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                profileOpen && "rotate-180",
              )}
            />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-border/80 dark:border-white/10 bg-popover p-1.5 shadow-xl z-50 animate-in fade-in-50 zoom-in-95">
              <div className="border-b border-border/60 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold tracking-wide text-foreground uppercase">
                    {userRole}
                  </span>
                </div>
                <p className="text-xs font-semibold text-foreground mt-1 truncate">
                  {user?.name}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
              </div>
              <div className="py-1">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                >
                  {isLoggingOut ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  <span>{isLoggingOut ? t("common.signingOut", { defaultValue: "Signing out…" }) : t("common.signOut", { defaultValue: "Sign out" })}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </header>
  );
}
