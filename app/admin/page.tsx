"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, CreditCard, PauseCircle, Users } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { ERPMetricCard } from "@/components/ui/erp-metric-card";
import { StatusBadge } from "@/components/ui/status-badge";

interface TenantListResponse {
  data: { id: string; slug: string; name: string; status: string }[];
  meta: { total: number };
}

interface BillingRow {
  tenantId: string;
  slug: string;
  name: string;
  tenantStatus: string;
  subscriptionStatus: string | null;
  planName: string | null;
  userCount: number;
}

function toneFor(status: string | null): "emerald" | "amber" | "rose" | "cyan" | "slate" {
  if (!status) return "slate";
  const s = status.toLowerCase();
  if (s === "active") return "emerald";
  if (s === "trial") return "cyan";
  if (s === "past_due") return "amber";
  if (s === "suspended" || s === "cancelled" || s === "expired") return "rose";
  return "slate";
}

export default function AdminOverviewPage() {
  const { t } = useLocale();

  const { data: tenantsData, isLoading: tenantsLoading } = useQuery<TenantListResponse>({
    queryKey: ["admin", "tenants", { page: 1, pageSize: 1 }],
    queryFn: () => apiClient<TenantListResponse>("/admin/tenants", { params: { page: 1, limit: 1 } }),
    staleTime: 60_000,
  });

  const { data: billingData, isLoading: billingLoading } = useQuery<{ success: boolean; data: BillingRow[] }>({
    queryKey: ["admin", "billing"],
    queryFn: () => apiClient<{ success: boolean; data: BillingRow[] }>("/admin/billing"),
    staleTime: 60_000,
  });

  const rows = billingData?.data ?? [];
  const loading = tenantsLoading || billingLoading;
  const totalTenants = tenantsData?.meta.total ?? rows.length;
  const totalUsers = rows.reduce((sum, r) => sum + (r.userCount ?? 0), 0);
  const suspended = rows.filter((r) => r.tenantStatus === "suspended").length;
  const attention = rows.filter(
    (r) => r.tenantStatus === "suspended" || r.subscriptionStatus === "past_due",
  );

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-border/80">
        <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
          {t("nav.superadminPanel")}
        </p>
        <h1 className="text-lg font-bold tracking-tight text-foreground">
          {t("admin.overview.title", { defaultValue: "Platform Overview" })}
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <ERPMetricCard
          label={t("admin.overview.tenants", { defaultValue: "Tenants" })}
          value={loading ? "…" : totalTenants}
          icon={<Building2 size={16} />}
        />
        <ERPMetricCard
          label={t("admin.overview.platformUsers", { defaultValue: "Platform Users" })}
          value={loading ? "…" : totalUsers}
          icon={<Users size={16} />}
        />
        <ERPMetricCard
          label={t("admin.overview.suspended", { defaultValue: "Suspended" })}
          value={loading ? "…" : suspended}
          icon={<PauseCircle size={16} />}
          tone={suspended > 0 ? "rose" : "emerald"}
        />
        <ERPMetricCard
          label={t("admin.overview.attention", { defaultValue: "Needs Attention" })}
          value={loading ? "…" : attention.length}
          icon={<CreditCard size={16} />}
          tone={attention.length > 0 ? "amber" : "emerald"}
        />
      </div>

      <div className="bg-card rounded-xl border border-border/80 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/80">
          <h2 className="text-sm font-semibold text-foreground">
            {t("admin.overview.attentionTitle", { defaultValue: "Tenants needing attention" })}
          </h2>
          <Link href="/admin/tenants" className="text-xs font-medium text-primary hover:underline">
            {t("admin.overview.viewAll", { defaultValue: "View all tenants" })}
          </Link>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            {t("common.loading", { defaultValue: "Loading…" })}
          </p>
        ) : attention.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground">
            {t("admin.overview.allClear", { defaultValue: "All tenants healthy. No action required." })}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {attention.map((r) => (
              <li key={r.tenantId} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">{r.slug}</p>
                </div>
                <StatusBadge tone={toneFor(r.tenantStatus)} label={r.tenantStatus} />
                {r.subscriptionStatus && (
                  <StatusBadge tone={toneFor(r.subscriptionStatus)} label={r.subscriptionStatus} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
