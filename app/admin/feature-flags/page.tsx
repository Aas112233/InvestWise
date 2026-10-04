"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Lock, RefreshCw, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { Button, Input } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import {
  TENANT_MODULE_DEFINITIONS,
  type ModuleCategory,
  type TenantModuleKey,
} from "@/lib/tenant-modules";

interface ModuleDefinitionDto {
  key: TenantModuleKey;
  labelKey: string;
  category: ModuleCategory;
  required: boolean;
  defaultEnabled: boolean;
}

interface TenantEntitlement {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  moduleAccess: Record<string, boolean>;
}

interface FeatureFlagsResponse {
  data: {
    tenants: TenantEntitlement[];
    defaults: Record<string, boolean>;
    definitions: ModuleDefinitionDto[];
  };
}

const CATEGORY_LABEL: Record<ModuleCategory, string> = {
  core: "Core",
  finance: "Finance",
  operations: "Operations",
};

export default function AdminFeatureFlagsPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  // Per-tenant pending edits, committed explicitly. A toggle must never write
  // through on click — an operator flipping six switches should be able to
  // abandon the batch.
  const [edits, setEdits] = useState<Record<string, Record<string, boolean>>>({});

  const query = useQuery<FeatureFlagsResponse>({
    queryKey: ["admin", "feature-flags", { search }],
    queryFn: () =>
      apiClient<FeatureFlagsResponse>("/admin/feature-flags", {
        params: { search: search.trim() || undefined },
      }),
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: (input: { tenantId: string; moduleAccess: Record<string, boolean> }) =>
      apiClient("/admin/feature-flags", {
        method: "PUT",
        body: JSON.stringify({ tenantId: input.tenantId, moduleAccess: input.moduleAccess }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "feature-flags"] });
      toast.success(t("admin.featureFlags.updated", { defaultValue: "Modules updated" }));
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.featureFlags.updateFailed", { defaultValue: "Update failed" })
      ),
  });

  const definitions = query.data?.data.definitions ?? TENANT_MODULE_DEFINITIONS;
  const tenants = useMemo(() => {
    const list = query.data?.data.tenants ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(term) || t.slug.toLowerCase().includes(term)
    );
  }, [query.data, search]);

  const grouped = useMemo(() => {
    const out: Record<ModuleCategory, ModuleDefinitionDto[]> = {
      core: [],
      finance: [],
      operations: [],
    };
    for (const d of definitions) out[d.category]?.push(d);
    return out;
  }, [definitions]);

  const flagsFor = (tenant: TenantEntitlement): Record<string, boolean> =>
    edits[tenant.id] ?? tenant.moduleAccess;

  const toggle = (tenant: TenantEntitlement, key: TenantModuleKey, value: boolean) => {
    const current = flagsFor(tenant);
    setEdits((prev) => ({ ...prev, [tenant.id]: { ...current, [key]: value } }));
  };

  const save = (tenant: TenantEntitlement) => {
    const pending = edits[tenant.id];
    if (!pending) return;
    // Send only what actually changed, so a concurrent platform-defaults
    // change is not silently reverted by a stale full-object write.
    const diff: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(pending)) {
      if (tenant.moduleAccess[k] !== v) diff[k] = v;
    }
    if (Object.keys(diff).length === 0) {
      setEdits((prev) => {
        const next = { ...prev };
        delete next[tenant.id];
        return next;
      });
      return;
    }
    saveMutation.mutate(
      { tenantId: tenant.id, moduleAccess: diff },
      {
        onSuccess: () => {
          setEdits((prev) => {
            const next = { ...prev };
            delete next[tenant.id];
            return next;
          });
        },
      }
    );
  };

  const discard = (tenantId: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[tenantId];
      return next;
    });
  };

  const pendingCount = Object.keys(edits).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel", { defaultValue: "SuperAdmin Panel" })}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <Flag className="h-5 w-5 text-primary" />
            {t("admin.featureFlags.title", { defaultValue: "Module Licensing" })}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t("admin.featureFlags.desc", {
              defaultValue:
                "Control which modules each organisation is licensed for. A disabled module is rejected at the API, not just hidden in the menu.",
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
              {t("admin.featureFlags.pending", { defaultValue: "{count} unsaved", count: pendingCount })}
            </span>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("admin.featureFlags.search", { defaultValue: "Search tenants…" })}
              className="pl-8 w-56 h-9 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            loading={query.isFetching}
            aria-label={t("common.refresh", { defaultValue: "Refresh" })}
          >
            {!query.isFetching && <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {query.isError ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-5 text-center space-y-2">
          <p className="text-sm font-semibold text-foreground">
            {t("admin.featureFlags.loadFailed", { defaultValue: "Could not load module entitlements" })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("common.retry", { defaultValue: "Retry" })}
          </Button>
        </div>
      ) : query.isLoading ? (
        <p className="py-10 text-center text-xs text-muted-foreground">
          {t("common.loading", { defaultValue: "Loading…" })}
        </p>
      ) : tenants.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          {t("admin.featureFlags.empty", { defaultValue: "No tenants match this search" })}
        </div>
      ) : (
        <div className="grid gap-4">
          {tenants.map((tenant) => {
            const flags = flagsFor(tenant);
            const dirty = Boolean(edits[tenant.id]);
            return (
              <Card key={tenant.id} className="border border-border/80 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 pb-3 border-b border-border/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-sm font-bold text-foreground truncate">{tenant.name}</h2>
                      <span className="font-mono text-[10px] text-muted-foreground border border-border/70 rounded px-1.5 py-0.5">
                        {tenant.slug}
                      </span>
                      <StatusBadge
                        tone={tenant.status === "active" ? "emerald" : "rose"}
                        label={tenant.status}
                      />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                        {tenant.plan}
                      </span>
                    </div>
                  </div>
                  {dirty && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => discard(tenant.id)}
                        className="h-7 text-xs"
                      >
                        {t("common.cancel", { defaultValue: "Discard" })}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => save(tenant)}
                        disabled={saveMutation.isPending}
                        loading={saveMutation.isPending}
                        className="h-7 text-xs gap-1.5"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {t("common.save", { defaultValue: "Save" })}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="p-4 space-y-4">
                  {(Object.keys(grouped) as ModuleCategory[]).map((category) =>
                    grouped[category] && grouped[category].length > 0 ? (
                      <div key={category} className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t(`admin.featureFlags.category.${category}`, {
                            defaultValue: CATEGORY_LABEL[category],
                          })}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                          {grouped[category].map((def) => {
                            const on = flags[def.key] !== false;
                            const changed = edits[tenant.id]?.[def.key] !== undefined &&
                              edits[tenant.id]?.[def.key] !== tenant.moduleAccess[def.key];
                            return (
                              <label
                                key={def.key}
                                className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors ${
                                  def.required
                                    ? "border-border/60 bg-muted/20 cursor-not-allowed"
                                    : "border-border/60 hover:bg-muted/30 cursor-pointer"
                                } ${changed ? "border-primary/50 bg-primary/5" : ""}`}
                              >
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-xs font-medium text-foreground truncate">
                                    {t(def.labelKey, { defaultValue: def.key })}
                                  </span>
                                  {def.required && (
                                    <Lock
                                      className="h-3 w-3 shrink-0 text-muted-foreground"
                                      aria-label={t("admin.featureFlags.required", {
                                        defaultValue: "Required",
                                      })}
                                    />
                                  )}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={def.required}
                                  onChange={(e) => toggle(tenant, def.key, e.target.checked)}
                                  className="h-3.5 w-3.5 shrink-0 rounded border-border accent-primary disabled:opacity-50"
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
