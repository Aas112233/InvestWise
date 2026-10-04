"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useInactivityTimeout } from "@/hooks/use-inactivity-timeout";
import { SessionTimeoutDialog } from "@/components/ui/session-timeout-dialog";
import { Sidebar } from "./sidebar";
import { TopNav, type TenantOption } from "./top-nav";
import { cn } from "@/lib/utils";

async function refreshSession(): Promise<void> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Session refresh failed: ${res.status}`);
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
  const { logout } = useAuth();
  // Identity split (user spec, 2026-10-04): the sidebar brands the APP
  // ("InvestWise"); TopNav owns the TENANT name via useTenantSettings
  // (skeleton while it loads).

  // Auto-shrink sidebar according to screen size on open + on resize
  useEffect(() => {
    const update = () => setSidebarCollapsed(window.innerWidth < 1024);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Session expiry (idle timeout or dead refresh): local-only sign-out. The
  // shared auth cookies span every tab — a server revoke here would kill the
  // sessions of any other open tab, which is the "mid-session user switch"
  // bug. Full server revoke stays on the explicit logout button.
  const handleSessionExpired = useCallback(async () => {
    await logout({ revokeServer: false });
    router.push("/login?session=timeout");
  }, [logout, router]);

  // 30 minutes of idle before the warning; 60s countdown inside it. (The old
  // 2-minute timeout logged people out mid-work — the reported session bug.)
  const { showWarning, timeRemaining, extendSession, logout: timeoutLogout } =
    useInactivityTimeout({
      timeoutMs: 30 * 60 * 1000,
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
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="max-w-[1600px] mx-auto pb-10">{children}</div>
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
