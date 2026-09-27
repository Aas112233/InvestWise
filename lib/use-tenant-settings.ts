"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./api-client";

/**
 * Single source of truth for tenant settings on the client.
 *
 * Previously every screen re-declared its own `["settings"]` query with an
 * inline fetcher (deposits/shared, members-list-view, member-detail-sheet,
 * audit-logs-view). React Query deduped the network call by key, but the
 * shape was re-parsed on every render and each file drifted. One hook, one
 * key, one long staleTime — settings change rarely and are read on nearly
 * every screen.
 */
export interface TenantSettings {
  financial?: {
    baseCurrency?: string;
    shareValueBdt?: number | string | null;
    isShareValueLocked?: boolean;
  };
  system?: {
    dateFormat?: string;
    locale?: string;
    theme?: string;
  };
  organization?: { name?: string };
  governance?: Record<string, unknown>;
}

const SETTINGS_STALE_MS = 5 * 60_000;

export function useTenantSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient<TenantSettings>("/settings"),
    staleTime: SETTINGS_STALE_MS,
    // Settings are near-static within a session; refetching on every mount
    // is pure round-trip cost against a remote database.
    refetchOnMount: false,
  });
}

/** Tenant display currency (falls back to BDT per legacy behavior). */
export function useTenantCurrency(): string {
  const { data } = useTenantSettings();
  return data?.financial?.baseCurrency || "BDT";
}

/** Tenant date display pattern (falls back to DD/MM/YYYY per legacy behavior). */
export function useTenantDateFormat(): string {
  const { data } = useTenantSettings();
  return data?.system?.dateFormat || "DD/MM/YYYY";
}
