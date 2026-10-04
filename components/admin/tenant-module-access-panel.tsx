"use client";

import { useEffect, useState } from "react";
import { Lock, Save, X } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TENANT_MODULE_DEFINITIONS,
  type ModuleCategory,
  type TenantModuleKey,
} from "@/lib/tenant-modules";

const CATEGORY_LABEL: Record<ModuleCategory, string> = {
  core: "Core",
  finance: "Finance",
  operations: "Operations",
};

interface Props {
  tenantId: string;
  initialAccess: Record<string, boolean>;
  onUpdated?: () => void;
}

export function TenantModuleAccessPanel({ tenantId, initialAccess, onUpdated }: Props) {
  const { t } = useLocale();
  const [draft, setDraft] = useState<Record<string, boolean>>(initialAccess);

  // Re-seed when the parent refetches, but never clobber an in-progress edit.
  useEffect(() => {
    setDraft(initialAccess);
  }, [initialAccess]);

  const dirty = hasUnsavedChanges(initialAccess, draft);

  const save = async () => {
    const diff: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (initialAccess[k] !== v) diff[k] = v;
    }
    if (Object.keys(diff).length === 0) return;
    try {
      await apiClient("/admin/feature-flags", {
        method: "PUT",
        body: JSON.stringify({ tenantId, moduleAccess: diff }),
      });
      toast.success(t("admin.featureFlags.updated", { defaultValue: "Modules updated" }));
      onUpdated?.();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : t("admin.featureFlags.updateFailed", { defaultValue: "Update failed" })
      );
    }
  };

  const grouped = TENANT_MODULE_DEFINITIONS.reduce<Record<ModuleCategory, typeof TENANT_MODULE_DEFINITIONS[number][]>>(
    (acc, def) => {
      (acc[def.category] ||= []).push(def);
      return acc;
    },
    { core: [], finance: [], operations: [] }
  );

  return (
    <Card className="border border-border/80 shadow-xs">
      <CardHeader className="p-4 pb-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            {t("admin.featureFlags.title", { defaultValue: "Module Licensing" })}
          </CardTitle>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(initialAccess)}
                className="h-7 text-xs gap-1"
              >
                <X className="h-3 w-3" />
                {t("common.cancel", { defaultValue: "Discard" })}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty}
              className="h-7 text-xs gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {t("common.save", { defaultValue: "Save" })}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {(Object.keys(grouped) as ModuleCategory[]).map((category) =>
          grouped[category].length > 0 ? (
            <div key={category} className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`admin.featureFlags.category.${category}`, { defaultValue: CATEGORY_LABEL[category] })}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {grouped[category].map((def) => {
                  const on = draft[def.key] !== false;
                  return (
                    <label
                      key={def.key}
                      className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors ${
                        def.required
                          ? "border-border/60 bg-muted/20 cursor-not-allowed"
                          : "border-border/60 hover:bg-muted/30 cursor-pointer"
                      } ${draft[def.key] !== initialAccess[def.key] ? "border-primary/50 bg-primary/5" : ""}`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-medium text-foreground truncate">
                          {t(def.labelKey, { defaultValue: def.key })}
                        </span>
                        {def.required && (
                          <Lock
                            className="h-3 w-3 shrink-0 text-muted-foreground"
                            aria-label={t("admin.featureFlags.required", { defaultValue: "Required" })}
                          />
                        )}
                      </span>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={def.required}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [def.key]: e.target.checked }))
                        }
                        className="h-3.5 w-3.5 shrink-0 rounded border-border accent-primary disabled:opacity-50"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null
        )}
      </CardContent>
    </Card>
  );
}

function hasUnsavedChanges(
  base: Record<string, boolean>,
  draft: Record<string, boolean>
): boolean {
  const keys = new Set([...Object.keys(base), ...Object.keys(draft)]);
  for (const k of keys) {
    if ((base[k] ?? false) !== (draft[k] ?? false)) return true;
  }
  return false;
}
