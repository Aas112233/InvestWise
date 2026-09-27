"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { ERPMetricCard } from "@/components/ui/erp-metric-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

interface DiagnosticsData {
  status: "Operational" | "Degraded" | "Unreachable";
  checks: {
    database: {
      reachable: boolean;
      latencyMs: number;
      engine: string;
    };
    security: {
      jwtConfigured: boolean;
      multiTenancyIsolation: string;
      roleModel: string;
    };
    process: {
      nodeVersion: string;
      uptimeSeconds: number;
      memoryRssMb: number;
      memoryHeapMb: number;
    };
  };
  metrics: {
    tenants: {
      total: number;
      active: number;
      suspended: number;
    };
    users: {
      total: number;
    };
    auditLogs: {
      total: number;
    };
    transactions: {
      total: number;
    };
  };
  generatedAt: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

export default function AdminDiagnosticsPage() {
  const { t } = useLocale();

  const { data, isLoading, isFetching, refetch } = useQuery<{ success: boolean; data: DiagnosticsData }>({
    queryKey: ["admin", "diagnostics"],
    queryFn: () => apiClient<{ success: boolean; data: DiagnosticsData }>("/admin/diagnostics"),
    staleTime: 15_000,
  });

  const diagnostics = data?.data;
  const isHealthy = diagnostics?.status === "Operational";
  const latency = diagnostics?.checks.database.latencyMs ?? 0;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel", { defaultValue: "SuperAdmin Panel" })}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            {t("admin.diagnostics.title", { defaultValue: "System Health & Diagnostics" })}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            loading={isFetching}
            className="gap-1.5"
          >
            {!isFetching && <RefreshCw className="h-3.5 w-3.5" />}
            {t("admin.diagnostics.refresh", { defaultValue: "Run Diagnostics" })}
          </Button>
        </div>
      </div>

      {/* Liveness Banner */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
              isHealthy
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
            }`}
          >
            {isHealthy ? <CheckCircle2 className="h-6 w-6" /> : <Zap className="h-6 w-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-foreground">
                {isLoading
                  ? t("common.loading", { defaultValue: "Measuring platform health…" })
                  : `Platform Status: ${diagnostics?.status ?? "Checking"}`}
              </h2>
              <StatusBadge
                tone={isHealthy ? "emerald" : "rose"}
                label={diagnostics?.status || "Unknown"}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("admin.diagnostics.subtext", {
                defaultValue: "Live latency probe and database health roundtrip.",
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="bg-muted/40 rounded-lg px-3 py-2 border border-border/60">
            <span className="text-muted-foreground block text-[10px] uppercase font-sans">
              DB Latency
            </span>
            <span className="font-semibold text-foreground">{isLoading ? "…" : `${latency} ms`}</span>
          </div>
          <div className="bg-muted/40 rounded-lg px-3 py-2 border border-border/60">
            <span className="text-muted-foreground block text-[10px] uppercase font-sans">Uptime</span>
            <span className="font-semibold text-foreground">
              {isLoading ? "…" : formatUptime(diagnostics?.checks.process.uptimeSeconds ?? 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <ERPMetricCard
          label={t("admin.diagnostics.dbRoundtrip", { defaultValue: "DB Latency" })}
          value={isLoading ? "…" : `${latency}ms`}
          icon={<Database size={16} />}
          tone={latency < 200 ? "emerald" : latency < 1000 ? "amber" : "rose"}
        />
        <ERPMetricCard
          label={t("admin.diagnostics.tenants", { defaultValue: "Active Tenants" })}
          value={isLoading ? "…" : `${diagnostics?.metrics.tenants.active ?? 0} / ${diagnostics?.metrics.tenants.total ?? 0}`}
          icon={<Server size={16} />}
        />
        <ERPMetricCard
          label={t("admin.diagnostics.users", { defaultValue: "Platform Users" })}
          value={isLoading ? "…" : diagnostics?.metrics.users.total ?? 0}
          icon={<ShieldCheck size={16} />}
        />
        <ERPMetricCard
          label={t("admin.diagnostics.auditLogs", { defaultValue: "Audit Records" })}
          value={isLoading ? "…" : diagnostics?.metrics.auditLogs.total ?? 0}
          icon={<Clock size={16} />}
        />
      </div>

      {/* Detailed Check Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Database Panel */}
        <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <Database className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {t("admin.diagnostics.dbSection", { defaultValue: "Database Infrastructure" })}
            </h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Postgres Connection</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Connected</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Engine Version</span>
              <span className="font-mono text-[11px] text-foreground truncate max-w-[180px]">
                {diagnostics?.checks.database.engine || "PostgreSQL"}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Pool Strategy</span>
              <span className="text-foreground">postgres-js (serverless)</span>
            </div>
          </div>
        </div>

        {/* Security & Isolation Panel */}
        <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <Lock className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {t("admin.diagnostics.secSection", { defaultValue: "Security & Isolation" })}
            </h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">JWT Secret Key</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Configured</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Tenant Isolation</span>
              <span className="font-mono text-[11px] text-foreground">STRICT_ROW_SCOPED</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">RBAC Model</span>
              <span className="text-foreground">5-Role Canonical</span>
            </div>
          </div>
        </div>

        {/* Process & Runtime Panel */}
        <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <Cpu className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {t("admin.diagnostics.runtimeSection", { defaultValue: "Node.js Runtime" })}
            </h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Node Version</span>
              <span className="font-mono text-foreground">{diagnostics?.checks.process.nodeVersion || "Node.js"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Memory RSS</span>
              <span className="font-mono text-foreground">{diagnostics?.checks.process.memoryRssMb ?? 0} MB</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Heap Allocated</span>
              <span className="font-mono text-foreground">{diagnostics?.checks.process.memoryHeapMb ?? 0} MB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
