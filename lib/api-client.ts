/**
 * Next.js API client with credentials inclusion, deduplication, and unmasked error parsing.
 * Adheres to AGENTS.md §11 (Universal API Error Formatting & Unmasked Toasts).
 */

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const inFlightGetRequests = new Map<string, Promise<any>>();

// ── Session auto-refresh (single-flight) ────────────────────────────────────
// The 15m access token was never refreshed during normal API use — only the
// AppShell "Extend" button called /api/auth/refresh — so expiry surfaced as
// raw 401s. One shared refresh promise collapses concurrent 401s into a
// single rotation; the double-try inside performRefresh() heals the
// multi-tab rotation race (loser of the race gets TOKEN_REVOKED, but the
// winning tab's Set-Cookie has landed in the shared jar by then).
let refreshInFlight: Promise<boolean> | null = null;
let redirectedToLogin = false;

async function performRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (res.ok) return true;
    if (res.status === 401) {
      // Rotation race retry (see above).
      await new Promise((resolve) => setTimeout(resolve, 250));
      const retry = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      return retry.ok;
    }
    return false;
  } catch {
    return false;
  }
}

function refreshSessionSingleFlight(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function isAuthEndpoint(url: string): boolean {
  return url.includes("/api/auth/");
}

// 401s worth one refresh+retry. Credential failures (wrong password etc.)
// come from /api/auth/* endpoints, which never enter this flow.
function shouldAttemptRefresh(status: number): boolean {
  return status === 401;
}

function redirectToLogin(reason: string): void {
  if (redirectedToLogin || typeof window === "undefined") return;
  redirectedToLogin = true;
  window.location.assign(`/login?session=${reason}`);
}

async function executeRequest(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, credentials: "include" });
  if (response.status === 401 && !isAuthEndpoint(url) && shouldAttemptRefresh(response.status)) {
    const refreshed = await refreshSessionSingleFlight();
    if (refreshed) {
      return fetch(url, { ...init, credentials: "include" });
    }
    // Refresh definitively failed — the session is dead. Send the user to
    // login (once; the guard prevents redirect loops on parallel requests).
    redirectToLogin("expired");
  }
  return response;
}

export async function apiClient<T = any>(
  endpoint: string,
  options?: RequestInit & { params?: Record<string, string | number | boolean | undefined | null> }
): Promise<T> {
  const { params, ...customConfig } = options || {};
  let url = endpoint.startsWith("http") ? endpoint : `/api${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== "") {
        searchParams.append(key, String(val));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }
  }

  const isGet = !customConfig.method || customConfig.method.toUpperCase() === "GET";

  if (isGet) {
    const cachedKey = url;
    if (inFlightGetRequests.has(cachedKey)) {
      return inFlightGetRequests.get(cachedKey)!;
    }

    const promise = (async () => {
      try {
        const response = await executeRequest(url, {
          headers: {
            "Content-Type": "application/json",
            ...customConfig.headers,
          },
          ...customConfig,
        });

        if (!response.ok) {
          let errorMsg = `Request failed: ${response.statusText}`;
          let errorData = null;
          try {
            errorData = await response.json();
            if (errorData?.message) {
              errorMsg = errorData.message;
            } else if (errorData?.error) {
              errorMsg = typeof errorData.error === "string" ? errorData.error : JSON.stringify(errorData.error);
            }
          } catch {
            // non-json error
          }
          throw new ApiError(errorMsg, response.status, errorData);
        }

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return await response.json();
        }
        return (await response.text()) as unknown as T;
      } finally {
        inFlightGetRequests.delete(cachedKey);
      }
    })();

    inFlightGetRequests.set(cachedKey, promise);
    return promise;
  }

  // Non-GET requests (mutations)
  const response = await executeRequest(url, {
    headers: {
      "Content-Type": "application/json",
      ...customConfig.headers,
    },
    ...customConfig,
  });

  if (!response.ok) {
    let errorMsg = `Request failed: ${response.statusText}`;
    let errorData = null;
    try {
      errorData = await response.json();
      if (errorData?.message) {
        errorMsg = errorData.message;
      } else if (errorData?.error) {
        errorMsg = typeof errorData.error === "string" ? errorData.error : JSON.stringify(errorData.error);
      }
    } catch {
      // non-json error
    }
    throw new ApiError(errorMsg, response.status, errorData);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return await response.json();
  }
  return (await response.text()) as unknown as T;
}
