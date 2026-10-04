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

  const logout = useCallback(async (opts?: { revokeServer?: boolean }) => {
    const { revokeServer = true } = opts ?? {};
    // revokeServer=false: inactivity timeouts in one tab must NOT blacklist
    // the shared refresh cookie — cookies span all tabs, so a server revoke
    // here would kill every other tab's session. Local state clears either way.
    if (revokeServer) {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch {
        // logout is best-effort; client state clears regardless
      }
    }
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {
      // ignore
    }
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
