"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getQueryClient } from "@/lib/query-client";
import { markSessionGone, refreshSessionSingleFlight } from "@/lib/api-client";

// Behavioral port of client auth state (App.tsx hydrateAuth + GlobalStateContext user).
// JWTs live in HttpOnly cookies server-side; the client only keeps the profile.
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId?: string;
  memberId?: string | null;
  permissions?: Record<string, string>;
  // Tenant module entitlements (GET /api/auth/me). UI display gating ONLY —
  // the API layer enforces the same map server-side on every request, so a
  // stale or missing field can only over-show a link, never over-grant.
  moduleAccess?: Record<string, boolean>;
  // Set when a platform admin is viewing this tenant through a support
  // (impersonation) session — drives the yellow header bar.
  impersonatedBy?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  tenantId: string | null;
  setTenantId: (id: string | null) => void;
  setUser: (u: AuthUser | null) => void;
  logout: (opts?: { revokeServer?: boolean }) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PROFILE_KEY = "investwise:userInfo";
const TENANT_KEY = "investwise:tenantId";

async function fetchJson(input: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(input, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<unknown>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantId, setTenantIdState] = useState<string | null>(null);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(TENANT_KEY);
      if (cached) setTenantIdState(cached);
    } catch {
      // storage unavailable; tenant stays null
    }
  }, []);

  const setTenantId = useCallback((id: string | null) => {
    setTenantIdState(id);
    try {
      if (id) localStorage.setItem(TENANT_KEY, id);
      else localStorage.removeItem(TENANT_KEY);
    } catch {
      // storage unavailable; keep in-memory only
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      // GET /api/auth/me — fresh DB-backed profile incl. normalized role and
      // permissions map. (The old "/api/auth/profile" URL never had a route —
      // every hydrate 404'd, leaving user null: empty sidebar + fake header.)
      const profile = (await fetchJson("/api/auth/me")) as AuthUser;
      setUser(profile);
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      } catch {
        // storage unavailable; keep in-memory only
      }
    } catch {
      try {
        localStorage.removeItem(PROFILE_KEY);
      } catch {
        // ignore
      }
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshProfile();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshProfile]);

  // Proactive/sliding session refresh. The access token lives 15 minutes; until
  // now it was only rotated reactively (the api-client retries one 401) or via
  // the AppShell "Extend" button — so an idle-but-open tab silently died and
  // the next click bounced to /login. Refresh well inside the TTL, skip the
  // work while the tab is hidden, and catch up immediately on refocus.
  useEffect(() => {
    if (!user) return;
    const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 min < 15 min TTL

    // rotate silently; a failure is NOT a sign-out here — the reactive 401
    // path in api-client owns that decision, so we don't double-fire it.
    // Goes through api-client's single flight: a raw fetch here would rotate
    // the session at the same moment as a reactive 401 refresh, and the loser
    // comes back TOKEN_REVOKED (the mid-work "session expired" bounce).
    const rotate = async () => {
      try {
        await refreshSessionSingleFlight();
      } catch {
        // offline / transient — the next tick or a real request will recover
      }
    };

    const tick = () => {
      if (document.visibilityState === "visible") void rotate();
    };

    const id = window.setInterval(tick, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void rotate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  const logout = useCallback(async (opts?: { revokeServer?: boolean }) => {
    const { revokeServer = true } = opts ?? {};
    // Set BEFORE the first await: queries already in flight will answer 401
    // while the logout POST is still running, and api-client must treat those
    // as expected — not as an expiry that deserves a /login?session=expired
    // bounce. (An in-flight 401 resolving in that pre-flag window used to
    // surface a false "session expired" notice on every manual sign-out.)
    markSessionGone();
    // revokeServer=false: reserved for cases where only THIS tab's local state
    // must die without touching the shared session (no current caller needs
    // it — idle timeouts now revoke server-side because cross-tab activity
    // tracking in useInactivityTimeout guarantees every tab is truly idle).
    // Local state clears either way.
    if (revokeServer) {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch {
        // logout is best-effort; client state clears regardless
      }
    }
    try {
      localStorage.removeItem(PROFILE_KEY);
      // The tenant picker choice belongs to the signed-out identity, not to
      // the browser — leaving it set makes the next account open on another
      // organisation's context.
      localStorage.removeItem(TENANT_KEY);
    } catch {
      // ignore
    }
    setTenantIdState(null);
    // Identity-handoff hygiene: the browser QueryClient is a module singleton
    // whose keys (["members"], ["transactions"], …) carry no tenant stamp, so
    // without this purge the next login in the same tab renders the PREVIOUS
    // user's cached rows for the first 30s (staleTime) before refreshing.
    // (["settings"] is tenant-namespaced since F-10 and self-heals; this
    // clear is what covers every other key.)
    getQueryClient().clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, tenantId, setTenantId, setUser, logout, refreshProfile }),
    [user, isLoading, tenantId, setTenantId, logout, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
