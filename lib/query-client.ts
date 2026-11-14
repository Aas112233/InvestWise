"use client";

import { QueryClient } from "@tanstack/react-query";

/**
 * Cross-tab cache invalidation (2026-11-12).
 *
 * Every browser tab owns its own QueryClient (one JS runtime per tab), so a
 * write in one tab used to leave the OTHER tabs' cached reads untouched:
 * a project created in tab B stayed invisible in tab A's "Bound project"
 * picker until a full reload. Reload was the only refresh because the house
 * defaults deliberately disable refetch-on-window-focus, and staleTime only
 * expires in place.
 *
 * The fix broadcasts the FACT of an invalidation — never the data; the server
 * stays the single source of truth. Any invalidateQueries in any tab marks the
 * same query-key prefix stale in every other tab, where mounted screens
 * refetch exactly as they do in the writing tab. Mutations across the app
 * always invalidate their touched keys, so this hook covers every write path.
 *
 * Loop safety: the receiver applies remote invalidations with broadcasting
 * suspended, and only explicit `invalidate` cache actions are ever posted
 * (plain fetch/success updates never are), so a broadcast cannot echo back.
 */
export function enableCrossTabInvalidation(client: QueryClient): void {
  if (typeof BroadcastChannel === "undefined") return; // old engines: stay single-tab, no crash
  const channel = new BroadcastChannel("investwise-query-invalidation");
  const instanceId = Math.random().toString(36).slice(2);
  // True only while applying a REMOTE invalidation, so marking our own cache
  // stale on someone else's message must not re-broadcast it (echo guard).
  let applyingRemote = false;

  channel.addEventListener("message", (event) => {
    const { sender, queryKeys } = (event.data ?? {}) as { sender?: string; queryKeys?: unknown };
    if (sender === instanceId || !Array.isArray(queryKeys)) return;
    applyingRemote = true;
    try {
      for (const queryKey of queryKeys as ReadonlyArray<readonly unknown[]>) {
        client.invalidateQueries({ queryKey: queryKey as readonly unknown[] });
      }
    } finally {
      applyingRemote = false;
    }
  });

  client.getQueryCache().subscribe((event) => {
    if (applyingRemote) return;
    const actionType = (event as { action?: { type?: string } }).action?.type;
    if (event.type === "updated" && actionType === "invalidate") {
      channel.postMessage({ sender: instanceId, queryKeys: [event.query.queryKey] });
    }
  });
}

let browserClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    // SSR: a per-request client; no tabs to sync, no channel to open.
    return new QueryClient({
      defaultOptions: {
        queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      },
    });
  }
  if (!browserClient) {
    browserClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      },
    });
    // Once per tab — the client is this module's singleton by design.
    enableCrossTabInvalidation(browserClient);
  }
  return browserClient;
}
