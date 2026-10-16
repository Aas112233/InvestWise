/**
 * Next.js API client with credentials inclusion, deduplication, and unmasked error parsing.
 * Adheres to AGENTS.md §11 (Universal API Error Formatting & Unmasked Toasts).
 */

import { SESSION_ACTIVITY_HEADER } from "@/lib/session-limits";

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

/**
 * #50: a request that never settles leaves the UI hanging with no explanation.
 * fetch() itself never times out, so a half-open socket (dev server stopped
 * mid-request, dropped VPN route, dead host) freezes the screen forever. We
 * abort after REQUEST_TIMEOUT_MS and convert every transport-level failure
 * (abort / DNS / offline) into a single friendly, translatable ApiError with
 * status 0 so React Query surfaces an error state instead of spinning.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/** Status 0 is reserved for "never reached the server" (network/timeout). */
export const NETWORK_ERROR_STATUS = 0;

function offlineError(reason: "timeout" | "unreachable"): ApiError {
  const message =
    reason === "timeout"
      ? "The server took too long to respond. Check your connection and try again."
      : "Cannot reach the server. Check your connection and try again.";
  // Tell the offline banner (#50) so a server-side outage surfaces even when
  // the browser still reports itself online.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("investwise:network-error"));
  }
  return new ApiError(message, NETWORK_ERROR_STATUS, { code: "NETWORK_ERROR", reason });
}

/** Tag a thrown value as a network error so callers can branch on status === 0. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === NETWORK_ERROR_STATUS;
}

const inFlightGetRequests = new Map<string, Promise<any>>();

// ── UI locale propagation ────────────────────────────────────────────────────
// i18n is client-side: UI labels are translated at render time, but ledger
// descriptions are written server-side at the moment of the operation. So the
// signed-in user's UI language is sent as `x-locale` on every request and the
// server localizes what it writes (stored text is never re-translated later).
// I18nProvider calls this on mount and on every language switch.
let apiClientLocale: string | null = null;
export function setApiClientLocale(locale: string | null): void {
  apiClientLocale = locale;
}

function localeHeaders(): Record<string, string> {
  return apiClientLocale ? { "x-locale": apiClientLocale } : {};
}

// ── Session auto-refresh (single-flight) ────────────────────────────────────
// The 15m access token was never refreshed during normal API use — only the
// AppShell "Extend" button called /api/auth/refresh — so expiry surfaced as
// raw 401s. One shared refresh promise collapses concurrent 401s into a
// single rotation; the double-try inside performRefresh() heals the
// multi-tab rotation race (loser of the race gets TOKEN_REVOKED, but the
// winning tab's Set-Cookie has landed in the shared jar by then).
let refreshInFlight: Promise<boolean> | null = null;
let redirectedToLogin = false;
// Set by an intentional sign-out: after logout, 401s from in-flight requests
// are expected and must NOT trigger the refresh/"session expired" redirect —
// that bounce reloads /login and wipes a sign-in form the user just started.
let sessionGone = false;
export function markSessionGone(): void {
  sessionGone = true;
}
export function clearSessionGone(): void {
  sessionGone = false;
  // A fresh login re-arms the expiry redirect for this tab too — the latch is
  // module-level and would otherwise stay closed until a full reload.
  redirectedToLogin = false;
}

async function performRefresh(activity = false): Promise<boolean> {
  const headers = activity ? { [SESSION_ACTIVITY_HEADER]: "1" } : undefined;
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include", ...(headers ? { headers } : {}) });
    if (res.ok) return true;
    if (res.status === 401) {
      // Rotation race retry (see above).
      await new Promise((resolve) => setTimeout(resolve, 250));
      const retry = await fetch("/api/auth/refresh", { method: "POST", credentials: "include", ...(headers ? { headers } : {}) });
      return retry.ok;
    }
    return false;
  } catch {
    return false;
  }
}

function refreshSessionSingleFlight(activity = false): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh(activity).finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }
  if (!activity) return refreshInFlight;
  // An explicit user gesture ("Stay signed in") must record activity
  // server-side. If a silent rotation is already in flight it carries no
  // activity flag, so chain a flagged rotation after it settles instead of
  // sharing it — sequential, never concurrent, so no rotation race.
  return refreshInFlight.then(() => refreshSessionSingleFlight(true));
}

// Exported so every caller (the idle-timeout "Extend" button, the proactive
// keep-alive in AppShell) shares ONE in-flight rotation. A second, independent
// `fetch("/api/auth/refresh")` rotates the session concurrently and the loser
// comes back TOKEN_REVOKED, which is what bounced people mid-work.
// Pass activity=true only for explicit user gestures: the flagged rotation
// records server-side activity (see the refresh route); silent callers share
// the unflagged flight so background keep-alives never extend idle sessions.
export { refreshSessionSingleFlight };

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

/**
 * A single fetch with a hard timeout. Any transport failure (abort / offline)
 * is normalised to an ApiError(status 0) so the UI can render "cannot reach
 * the server" instead of hanging or showing a raw "Failed to fetch".
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
  // Respect a caller-supplied signal (React Query cancellation) by chaining.
  const callerSignal = init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort("caller");
    else callerSignal.addEventListener("abort", () => controller.abort("caller"), { once: true });
  }
  try {
    return await fetch(url, { ...init, credentials: "include", signal: controller.signal });
  } catch (err) {
    // A caller-initiated cancellation propagates untouched (React Query expects
    // an abort to be inert, not a toast).
    if (callerSignal?.aborted) throw err;
    const timedOut = controller.signal.reason === "timeout" || controller.signal.aborted;
    throw offlineError(timedOut ? "timeout" : "unreachable");
  } finally {
    clearTimeout(timer);
  }
}

async function executeRequest(url: string, init: RequestInit): Promise<Response> {
  const response = await fetchWithTimeout(url, init);
  if (
    response.status === 401 &&
    !isAuthEndpoint(url) &&
    !sessionGone &&
    shouldAttemptRefresh(response.status)
  ) {
    const refreshed = await refreshSessionSingleFlight();
    if (refreshed) {
      return fetchWithTimeout(url, init);
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
          ...localeHeaders(),
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
      ...localeHeaders(),
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
