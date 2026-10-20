"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n";
import { useInactivityTimeout } from "@/hooks/use-inactivity-timeout";
import { SessionTimeoutDialog } from "@/components/ui/session-timeout-dialog";
import { Sidebar, canRead } from "./sidebar";
import { AccessDenied } from "./access-denied";
import { navItemForRoute } from "./navigation";
import { OfflineBanner } from "./offline-banner";
import { TopNav, type TenantOption } from "./top-nav";
import { cn } from "@/lib/utils";
import { refreshSessionSingleFlight } from "@/lib/api-client";
import { IDLE_SESSION_LIFETIME_MS } from "@/lib/session-limits";

// Shares api-client's single in-flight rotation instead of issuing a second
// /api/auth/refresh: concurrent rotations invalidate each other and the loser
// is told the session was revoked.
async function refreshSession(): Promise<void> {
  const ok = await refreshSessionSingleFlight(true);
  if (!ok) throw new Error("Session refresh failed");
}

// Root application shell: fixed collapsible sidebar + sticky header + session timeout guard.
// Architectural port of Pathshala-Pro layout with InvestWise session management.
export function AppShell({
  children,
  companyName = "InvestWise",
  tenants,
  tenantsLoading,
}: {
  children: React.ReactNode;
  companyName?: string;
  tenants?: TenantOption[];
  tenantsLoading?: boolean;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLocale();
  const { user, logout } = useAuth();
  // Identity split (user spec, 2026-10-04): the sidebar brands the APP
  // ("InvestWise"); TopNav owns the TENANT name via useTenantSettings
  // (skeleton while it loads).

  // 403 gate: routes that map to a screen the user cannot READ render the
  // AccessDenied screen instead of the page — direct-URL access to a
  // sidebar-hidden screen no longer lands on an empty shell with error
  // toasts. Fail-open only while the session hydrates (user === null): every
  // API route re-checks permissions server-side, so the gate is UX, not the
  // security boundary.
  const screenItem = navItemForRoute(pathname);
  const deniedScreen = screenItem?.id ?? null;
  // Screen permission AND tenant module entitlement — same canRead the
  // sidebar filter uses, so a direct URL to an unlicensed/forbidden screen
  // shows the AccessDenied shell instead of error toasts.
  const accessDenied =
    !!user && !!deniedScreen && !!screenItem && !canRead(user, screenItem);

  // Browser tab title: the current screen, localized. Root layout's metadata
  // template can't do this because both the nav labels and the active locale
  // live client-side, and no page exports its own title — without this every
  // screen is just "InvestWise" and a dozen open tabs are indistinguishable.
  useEffect(() => {
    const label = screenItem ? t(screenItem.labelKey) : null;
    document.title = label ? `${label} | ${companyName}` : companyName;
  }, [screenItem, t, companyName]);

  // Auto-shrink sidebar according to screen size on open + on resize
  useEffect(() => {
    const update = () => setSidebarCollapsed(window.innerWidth < 1024);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Session expiry (idle timeout or dead refresh): full server revoke. Idle
  // state is now cross-tab (useInactivityTimeout shares last-input via
  // localStorage), so a timeout here means EVERY tab has been idle past the
  // policy — revoking cannot kill an active tab elsewhere, which was the old
  // "mid-session user switch" bug that forced the local-only sign-out.
  // Server revoke matters: otherwise the refresh cookie stays valid up to 7d
  // after the user was "logged out".
  const handleSessionExpired = useCallback(async () => {
    await logout();
    router.push("/login?session=timeout");
  }, [logout, router]);

  // IDLE_SESSION_LIFETIME_MS of idle before the warning; 60s countdown inside
  // it. (The old 2-minute timeout logged people out mid-work — the reported
  // session bug.)
  const { showWarning, timeRemaining, extendSession, logout: timeoutLogout } =
    useInactivityTimeout({
      timeoutMs: IDLE_SESSION_LIFETIME_MS,
      warningDurationMs: 60 * 1000,
      onLogout: () => {
        void handleSessionExpired();
      },
      enabled: true,
    });

  const handleExtend = useCallback(async () => {
    try {
      await refreshSession();
      extendSession();
    } catch {
      await handleSessionExpired();
    }
  }, [extendSession, handleSessionExpired]);

  return (
    // The header's fiscal-year selector owns the app-wide accounting year; the
    // provider itself lives in lib/providers.tsx so the selection survives
    // navigation (AppShell remounts per route).
    <div className="flex min-h-screen bg-background">
      <Sidebar
        companyName={companyName}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div
        className={cn(
          "flex flex-1 flex-col transition-[padding] duration-200 ease-out min-w-0",
          sidebarCollapsed ? "pl-[68px]" : "pl-[260px]",
        )}
      >
        <TopNav tenants={tenants} tenantsLoading={tenantsLoading} />
        <OfflineBanner />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          {accessDenied ? (
            <AccessDenied />
          ) : (
            <div className="max-w-[1600px] mx-auto pb-10">{children}</div>
          )}
        </main>
      </div>
      <SessionTimeoutDialog
        isOpen={showWarning}
        timeRemaining={timeRemaining}
        totalWarningSeconds={60}
        onExtend={handleExtend}
        onLogout={() => timeoutLogout()}
      />
    </div>
  );
}
