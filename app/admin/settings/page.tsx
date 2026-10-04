"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Save, Settings as SettingsIcon, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { CURRENCIES } from "@/lib/org-setup";
import { useLocale } from "@/lib/i18n";
import { Button, Input } from "@/components/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ERPFormField, ERPFormGrid } from "@/components/ui/erp-form-layout";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";

interface PlatformSettings {
  id: number;
  platformName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  defaultTrialDays: number;
  defaultCurrency: string;
  defaultTimezone: string;
  allowPublicRegistration: boolean;
  globalMaintenanceMode: boolean;
  maintenanceMessage: string | null;
  updatedAt: string;
}

// Currency list lives in lib/org-setup.ts so public onboarding offers exactly
// the codes the provisioning writer accepts.
const TIMEZONES = [
  { value: "Asia/Dhaka", label: "Asia/Dhaka (UTC+6)" },
  { value: "Asia/Karachi", label: "Asia/Karachi (UTC+5)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (UTC+5:30)" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "UTC", label: "UTC" },
];

export default function AdminSettingsPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  const query = useQuery<{ success: boolean; data: PlatformSettings }>({
    queryKey: ["admin", "settings"],
    queryFn: () => apiClient<{ success: boolean; data: PlatformSettings }>("/admin/settings"),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.data?.data) setDraft(query.data.data);
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient("/admin/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      toast.success(t("admin.settings.saved", { defaultValue: "Platform settings saved" }));
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.settings.saveFailed", { defaultValue: "Save failed" })
      ),
  });

  if (!draft) {
    return (
      <div className="py-16 text-center text-xs text-muted-foreground">
        {query.isError
          ? t("admin.settings.loadFailed", { defaultValue: "Could not load platform settings" })
          : t("common.loading", { defaultValue: "Loading…" })}
      </div>
    );
  }

  // Send only what changed, so a concurrent edit by another operator to a
  // different field is not reverted by a stale full-object write.
  const diff = (): Record<string, unknown> => {
    const original = query.data?.data;
    if (!original) return {};
    const body: Record<string, unknown> = {};
    const keys: (keyof PlatformSettings)[] = [
      "platformName",
      "supportEmail",
      "supportPhone",
      "defaultTrialDays",
      "defaultCurrency",
      "defaultTimezone",
      "allowPublicRegistration",
      "globalMaintenanceMode",
      "maintenanceMessage",
    ];
    for (const k of keys) {
      if (draft[k] !== original[k]) body[k] = draft[k];
    }
    return body;
  };

  const pending = diff();
  const hasChanges = Object.keys(pending).length > 0;

  const submit = () => {
    // Going live with maintenance locks every tenant out, so it gets an
    // explicit confirmation rather than going out with the other edits.
    if (pending.globalMaintenanceMode === true) {
      setConfirmMaintenance(true);
      return;
    }
    saveMutation.mutate(pending);
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel", { defaultValue: "SuperAdmin Panel" })}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-primary" />
            {t("admin.settings.title", { defaultValue: "Platform Settings" })}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t("admin.settings.desc", {
              defaultValue:
                "Defaults applied to newly provisioned tenants, plus the platform-wide maintenance switch.",
            })}
          </p>
        </div>
        <Button
          size="sm"
          onClick={submit}
          disabled={!hasChanges || saveMutation.isPending}
          loading={saveMutation.isPending}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {saveMutation.isPending
            ? t("admin.settings.saving", { defaultValue: "Saving…" })
            : t("admin.settings.save", { defaultValue: "Save changes" })}
        </Button>
      </div>

      <Card className="border border-border/80 shadow-xs">
        <CardHeader className="p-4 pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            {t("admin.settings.identity", { defaultValue: "Platform Identity" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("admin.settings.platformName", { defaultValue: "Platform name" })} required>
              <Input
                value={draft.platformName}
                onChange={(e) => setDraft({ ...draft, platformName: e.target.value })}
                className="text-xs"
              />
            </ERPFormField>
            <ERPFormField
              label={t("admin.settings.supportEmail", { defaultValue: "Support email" })}
              hint={t("admin.settings.supportEmailHint", {
                defaultValue: "Shown to tenants on the blocked screen.",
              })}
            >
              <Input
                type="email"
                value={draft.supportEmail ?? ""}
                onChange={(e) => setDraft({ ...draft, supportEmail: e.target.value || null })}
                className="text-xs font-mono"
              />
            </ERPFormField>
            <ERPFormField label={t("admin.settings.supportPhone", { defaultValue: "Support phone" })}>
              <Input
                value={draft.supportPhone ?? ""}
                onChange={(e) => setDraft({ ...draft, supportPhone: e.target.value || null })}
                className="text-xs font-mono"
              />
            </ERPFormField>
          </ERPFormGrid>
        </CardContent>
      </Card>

      <Card className="border border-border/80 shadow-xs">
        <CardHeader className="p-4 pb-3 border-b border-border/50">
          <CardTitle className="text-sm font-bold">
            {t("admin.settings.newTenantDefaults", { defaultValue: "New Tenant Defaults" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <ERPFormGrid cols={2}>
            <ERPFormField
              label={t("admin.settings.trialDays", { defaultValue: "Default trial length (days)" })}
              required
              hint={t("admin.settings.trialDaysHint", { defaultValue: "Between 1 and 365." })}
            >
              <Input
                type="number"
                min={1}
                max={365}
                value={draft.defaultTrialDays}
                onChange={(e) =>
                  setDraft({ ...draft, defaultTrialDays: Number(e.target.value) || 1 })
                }
                className="text-xs"
              />
            </ERPFormField>
            <ERPFormField label={t("admin.settings.currency", { defaultValue: "Default currency" })} required>
              <AppDropdown
                value={draft.defaultCurrency}
                onChange={(v) => setDraft({ ...draft, defaultCurrency: v ?? "BDT" })}
                clearable={false}
                options={CURRENCIES}
              />
            </ERPFormField>
            <ERPFormField label={t("admin.settings.timezone", { defaultValue: "Default timezone" })} required>
              <AppDropdown
                value={draft.defaultTimezone}
                onChange={(v) => setDraft({ ...draft, defaultTimezone: v ?? "Asia/Dhaka" })}
                clearable={false}
                options={TIMEZONES}
              />
            </ERPFormField>
            <ERPFormField
              label={t("admin.settings.registration", { defaultValue: "Public self-service signup" })}
              hint={t("admin.settings.registrationHint", {
                defaultValue:
                  "Turns the public “Create your organization” onboarding at /signup on or off. Admin staff invites (/register) are unaffected.",
              })}
            >
              <label className="flex items-center gap-2 h-9 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.allowPublicRegistration}
                  onChange={(e) =>
                    setDraft({ ...draft, allowPublicRegistration: e.target.checked })
                  }
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                {draft.allowPublicRegistration
                  ? t("common.enabled", { defaultValue: "Enabled" })
                  : t("common.disabled", { defaultValue: "Disabled" })}
              </label>
            </ERPFormField>
          </ERPFormGrid>
        </CardContent>
      </Card>

      <Card className="border border-destructive/30 shadow-xs">
        <CardHeader className="p-4 pb-3 border-b border-destructive/20">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-4 w-4" />
            {t("admin.settings.dangerZone", { defaultValue: "Platform-wide maintenance" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <label className="flex items-start gap-2.5 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={draft.globalMaintenanceMode}
              onChange={(e) => {
                const next = e.target.checked;
                setDraft({
                  ...draft,
                  globalMaintenanceMode: next,
                  // Pre-fill a message so saving cannot be blocked by an empty
                  // textarea the operator did not notice.
                  maintenanceMessage: next
                    ? (draft.maintenanceMessage ??
                      t("admin.settings.defaultMaintenanceMessage", {
                        defaultValue: "InvestWise is under maintenance. Please try again shortly.",
                      }))
                    : draft.maintenanceMessage,
                });
              }}
              className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-rose-500"
            />
            <span>
              {t("admin.settings.maintenanceToggle", {
                defaultValue: "Block all tenant sign-ins",
              })}
              <span className="block text-[11px] text-muted-foreground mt-0.5">
                {t("admin.settings.maintenanceHint", {
                  defaultValue:
                    "Every tenant is locked out. Platform operators keep access. Distinct from per-tenant maintenance mode.",
                })}
              </span>
            </span>
          </label>

          {draft.globalMaintenanceMode && (
            <ERPFormField
              label={t("admin.settings.maintenanceMessage", { defaultValue: "Maintenance message" })}
              required
            >
              <textarea
                value={draft.maintenanceMessage ?? ""}
                onChange={(e) => setDraft({ ...draft, maintenanceMessage: e.target.value })}
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 rounded-lg border border-border/80 bg-card text-foreground text-xs outline-none focus:border-primary resize-y"
              />
            </ERPFormField>
          )}
        </CardContent>
      </Card>

      <ERPConfirmDialog
        isOpen={confirmMaintenance}
        onClose={() => setConfirmMaintenance(false)}
        title={t("admin.settings.maintenanceConfirmTitle", {
          defaultValue: "Apply platform-wide maintenance?",
        })}
        description={t("admin.settings.maintenanceConfirmDesc", {
          defaultValue:
            "Every tenant user is locked out until this is switched off. Platform operators keep access.",
        })}
        confirmLabel={t("admin.settings.apply", { defaultValue: "Apply" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="destructive"
        pending={saveMutation.isPending}
        onConfirm={() => {
          setConfirmMaintenance(false);
          submit();
        }}
      />
    </div>
  );
}
