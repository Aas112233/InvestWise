"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  Globe,
  Loader2,
  LogOut,
  Moon,
  Search,
  Shield,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { LOCALES, useLocale, type Locale } from "@/lib/i18n";
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
    expenses: "nav.expenses",
    projects: "nav.projectMgmt",
    funds: "nav.fundsMgmt",
    analysis: "nav.analysis",
    reports: "nav.reports",
    settings: "nav.settings",
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
  const { user, logout, tenantId, setTenantId } = useAuth();
  const { locale, setLocale, t } = useLocale();

  const [mounted, setMounted] = useState(false);
  const [localeOpen, setLocaleOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const localeDropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const tenantMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const currentTenant = tenants.find((item) => item.id === tenantId);
  const tenantDisplay =
    currentTenant?.name ??
    (user?.tenantId ? `Tenant ${user.tenantId.slice(0, 8)}` : "InvestWise");

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const userRole = user?.role ? user.role.replace("_", " ") : "MEMBER";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/50 bg-background/95 px-6 backdrop-blur-md">
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
              <div className="absolute left-0 top-full mt-1.5 w-56 rounded-xl border border-border/80 bg-popover p-1 shadow-xl z-50 animate-in fade-in-50 zoom-in-95">
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
        ) : (
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-emerald-200/90 bg-emerald-50/90 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 w-fit max-w-full truncate">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <span className="whitespace-nowrap tracking-tight truncate">{tenantDisplay}</span>
          </div>
        )}
      </div>

      {/* Right - Global Controls */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Notifications */}
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground relative"
          aria-label={t("layout.notifications", { defaultValue: "Notifications" })}
        >
          <Bell className="h-4 w-4" />
        </button>

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
              <div
                suppressHydrationWarning
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#064E3B] dark:bg-emerald-800 text-xs font-bold text-white shadow-2xs"
              >
                {mounted && initials ? initials : "D"}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
            </div>
            <div className="hidden lg:flex flex-col text-left">
              <span
                suppressHydrationWarning
                className="text-xs font-semibold text-foreground leading-tight max-w-[140px] truncate"
              >
                {mounted && user?.name ? user.name : "Dr. Garrison Spinka"}
              </span>
              <span
                suppressHydrationWarning
                className="text-[11px] text-muted-foreground capitalize leading-tight"
              >
                {mounted && userRole ? userRole : "Admin"}
              </span>
            </div>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                profileOpen && "rotate-180",
              )}
            />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-border/80 bg-popover p-1.5 shadow-xl z-50 animate-in fade-in-50 zoom-in-95">
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
    </header>
  );
}
