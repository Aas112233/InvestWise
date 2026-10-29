"use client";

import React, { useState, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Landmark,
  PieChart as PieIcon,
  Award,
  Users,
  ShieldCheck,
  Calendar,
  Filter,
  RefreshCw,
  BarChart3,
  Layers,
  CheckCircle2,
  Clock,
  AlertCircle,
  HelpCircle,
  ChevronRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ERPMetricCard, AppDropdown, Button, DropdownOption, CardGridSkeleton } from "@/components/ui";
import { AnalysisData, Member } from "@/types";
import { formatMoney, intlLocaleFor } from "@/lib/formatters";
import { projectSectorLabel } from "@/components/projects/project-labels";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency } from "@/lib/use-tenant-settings";
import { memberDisplayName } from "@/lib/member-display";
import { fiscalMonthSequence, resolveFiscalBounds } from "@/lib/fiscal-periods";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { cn } from "@/lib/utils";

interface AnalysisViewProps {
  data: AnalysisData | null;
  members: Member[];
  isLoading: boolean;
  selectedYear: number;
  fiscalStartMonth: string;
  fiscalEndMonth: string;
  selectedMemberId: string;
  onYearChange: (year: number) => void;
  onMemberChange: (memberId: string) => void;
  onRefresh: () => void;
  /** Analysis request failed (non-2xx / network). Rendered as an error state —
   * never as a false "no data" screen. */
  error?: string | null;
  onRetry?: () => void;
  /** Member-list request failed (the shareholder filter would otherwise
   * silently degrade to an empty dropdown). */
  membersError?: string | null;
  onMembersRetry?: () => void;
}

const SECTOR_COLORS = [
  "#2563EB", // Blue
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#64748B", // Slate
];

/** Badge marking a section that stays tenant-wide in a member-scoped view. */
function TenantWideChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
      {label}
    </span>
  );
}

// projects.health is a 3-value enum (Stable | At Risk | Critical) — the
// matrix below renders exactly those tiers.
const HEALTH_COLORS: Record<string, string> = {
  Stable: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  "At Risk": "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  Critical: "text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
};

export function AnalysisView({
  data,
  members,
  isLoading,
  selectedYear,
  fiscalStartMonth,
  fiscalEndMonth,
  selectedMemberId,
  onYearChange,
  onMemberChange,
  onRefresh,
  error = null,
  onRetry,
  membersError = null,
  onMembersRetry,
}: AnalysisViewProps) {
  const { t, locale } = useLocale();
  // Money on this screen is the tenant's money, so it carries the tenant's currency.
  const tenantCurrency = useTenantCurrency();
  const fm = (n: number | string | null | undefined) => formatMoney(n, tenantCurrency, { locale: intlLocaleFor(locale) });
  const [activeTab, setActiveTab] = useState<"overview" | "regularity" | "leaderboard">("overview");

  // FY label: the SERVER is authoritative (it bucketed the data with its own
  // settings row). The local re-derivation is only a loading/legacy fallback —
  // and it must not throw: a legacy settings row with a malformed month name
  // used to crash the whole screen (top-nav and the fiscal pickers guard the
  // same case).
  const fiscalYearLabel = data?.fiscalYearLabel ?? (() => {
    try {
      return resolveFiscalBounds(selectedYear, fiscalStartMonth, fiscalEndMonth).label;
    } catch {
      return String(selectedYear);
    }
  })();
  const fiscalYearDisplay = `${t("layout.fiscalYearAbbrev", { defaultValue: "FY" })} ${fiscalYearLabel}`;
  const fiscalMonths = useMemo(() => fiscalMonthSequence(fiscalStartMonth), [fiscalStartMonth]);
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }),
    [locale],
  );
  // Every CREATED fiscal year, marked (Open)/(Closed): Analysis is a read
  // screen and closed years hold the history it reports on, so the picker
  // uses the all-years variant — the postable-only `yearOptionsIncluding`
  // locked closed history out after the first fiscal close.
  const { yearOptionsAllIncluding, currentFiscalYear } = useFiscalPeriodOptions();

  // Scope marker from the server: when a member is selected, the chart, the
  // matrix and the contribution figures are member-scoped while the treasury,
  // return, sector, risk and leaderboard sections stay tenant-wide.
  const memberScoped = data?.scope?.memberScoped === true;
  const scopeMemberName = data?.scope?.memberName ?? "";

  const chartMonthlyTrends = useMemo(
    () => data?.monthlyTrends.map((trend, offset) => {
      // Localize from the server's own slot ('YYYY-MM') so the axis can never
      // disagree with the month the server bucketed; fall back to the local
      // sequence only when the slot is absent.
      const slot = trend.monthSlot ? trend.monthSlot.split("-") : null;
      const monthIndex = slot && Number.isInteger(Number(slot[1])) ? Number(slot[1]) - 1 : (fiscalMonths[offset]?.index ?? 0);
      const date = new Date(Date.UTC(2020, monthIndex, 1));
      return { ...trend, month: monthFormatter.format(date) };
    }) ?? [],
    [data?.monthlyTrends, fiscalMonths, monthFormatter],
  );

  // Deposit-month columns: each fiscal slot maps to the calendar YYYY-MM the
  // money belongs to (selectedYear is the fiscal START year, so months before
  // the start month fall in selectedYear + 1). Headers and tooltips name that
  // month, so a January contribution keyed in October still reads January.
  // Server-derived slots are preferred (same calendar the data was bucketed
  // with); the local computation remains the loading/legacy fallback.
  const regularityColumns = useMemo(() => {
    const trends = data?.monthlyTrends;
    if (trends && trends.length === 12) {
      return trends.map((tr) => {
        const slot = tr.monthSlot ? tr.monthSlot.split("-") : null;
        const monthIndex = slot && Number.isInteger(Number(slot[1])) ? Number(slot[1]) - 1 : null;
        return {
          key: tr.monthKey,
          calYear: tr.calYear ?? selectedYear,
          depositMonth: tr.monthSlot ?? "",
          short: monthIndex !== null ? monthFormatter.format(new Date(Date.UTC(2020, monthIndex, 1))) : tr.month,
        };
      });
    }
    const startCalIndex = fiscalMonths[0]?.index ?? 0;
    return fiscalMonths.map((m) => {
      const calYear = m.index >= startCalIndex ? selectedYear : selectedYear + 1;
      return {
        key: m.key,
        calYear,
        depositMonth: `${calYear}-${String(m.index + 1).padStart(2, "0")}`,
        short: monthFormatter.format(new Date(Date.UTC(2020, m.index, 1))),
      };
    });
  }, [data?.monthlyTrends, fiscalMonths, selectedYear, monthFormatter]);

  // Per-month paid/evaluated counts across the roster — the footer's totals row.
  const regularityTotals = useMemo(() => {
    const rows = data?.paymentMatrix ?? [];
    return regularityColumns.map((col) => {
      let paid = 0;
      let evaluated = 0;
      for (const r of rows) {
        const s = r.months[col.key];
        if (s === "PAID") {
          paid += 1;
          evaluated += 1;
        } else if (s === "MISSED") {
          evaluated += 1;
        }
      }
      return { paid, evaluated, rate: evaluated > 0 ? Math.round((paid / evaluated) * 100) : null };
    });
  }, [data?.paymentMatrix, regularityColumns]);

  const regularityOverall = useMemo(() => {
    const paid = regularityTotals.reduce((sum, c) => sum + c.paid, 0);
    const evaluated = regularityTotals.reduce((sum, c) => sum + c.evaluated, 0);
    return { paid, evaluated, rate: evaluated > 0 ? Math.round((paid / evaluated) * 100) : null };
  }, [regularityTotals]);

  const memberOptions: DropdownOption[] = useMemo(() => {
    const list: DropdownOption[] = [
      { value: "all", label: t("analysis.allShareholders", { defaultValue: "All Shareholders (Consolidated)" }) },
    ];
    members.forEach((m) => {
      list.push({
        value: m.id,
        label: `${memberDisplayName(m.name, m.status)} (${m.memberId})`,
      });
    });
    return list;
  }, [members, t]);

  const metrics = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border/80 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <AppDropdown
              options={yearOptionsAllIncluding(String(selectedYear))}
              value={String(selectedYear)}
              onChange={(val) => onYearChange(parseInt(val || currentFiscalYear, 10))}
              placeholder={t("fiscal.actions.selectYear")}
              // A fiscal year is always selected on this screen; clearing it
              // used to silently jump back to the current FY.
              clearable={false}
            />
          </div>

          <div className="w-64">
            <AppDropdown
              options={memberOptions}
              value={selectedMemberId}
              onChange={(val) => onMemberChange(val || "all")}
              placeholder={t("analysis.filterByShareholder", { defaultValue: "Filter by Shareholder" })}
              // A failed member fetch must not pretend the org has no
              // shareholders — surface it with a retry instead.
              error={membersError}
              onRetry={onMembersRetry}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            icon={RefreshCw}
          >
            {t("analysis.refresh", { defaultValue: "Refresh" })}
          </Button>
        </div>
      </div>

      {/* Scope banner: when a shareholder is selected, most figures on this
          screen stay TENANT-WIDE (the treasury is not attributable per member).
          Say so once, loudly, instead of letting a tenant-wide "Portfolio Net
          Return" be misread as the selected member's return. */}
      {memberScoped && !isLoading && (error || data) && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
          <Filter className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {t("analysis.memberScopeBanner", {
              defaultValue:
                "Shareholder view: {member}. The cash-flow chart, the regularity matrix and the contribution figures are scoped to this shareholder; portfolio value, net return, sector allocation, project health and the leaderboard remain tenant-wide.",
              member: scopeMemberName,
            })}
          </p>
        </div>
      )}

      {/* Executive KPIs — a failed load is an ERROR state, never zeros: a
          "0.00" KPI row reads as "this organisation has no money". */}
      {!isLoading && error && !data ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/40 bg-card p-10 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("analysis.errorTitle", { defaultValue: "Analysis data could not be loaded" })}
            </p>
            {error && <p className="mt-1 text-xs text-muted-foreground">{error}</p>}
          </div>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry} icon={RefreshCw}>
              {t("analysis.errorRetry", { defaultValue: "Try again" })}
            </Button>
          )}
        </div>
      ) : isLoading ? (
        <CardGridSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ERPMetricCard
            label={t("analysis.totalCapitalInvested")}
            value={fm(metrics?.totalInvested ?? 0)}
            icon={Wallet}
            tone="slate"
            helperText={t("analysis.capitalInvestedHelper", {
              defaultValue: "Sum of all verified deposits to date",
            })}
          />
          <ERPMetricCard
            label={t("analysis.consolidatedPortfolioValue")}
            value={fm(metrics?.totalAssetValue ?? 0)}
            icon={Landmark}
            tone="emerald"
            note={memberScoped ? t("analysis.tenantWideBadge", { defaultValue: "Tenant-wide" }) : undefined}
            helperText={t("analysis.consolidatedPortfolioHelper", {
              defaultValue: "Total treasury: active fund balances (project capital included)",
            })}
          />
          <ERPMetricCard
            label={t("analysis.portfolioNetReturn")}
            value={fm(metrics?.netProfit ?? 0)}
            icon={TrendingUp}
            tone={(metrics?.netProfit ?? 0) >= 0 ? "emerald" : "rose"}
            note={memberScoped ? t("analysis.tenantWideBadge", { defaultValue: "Tenant-wide" }) : undefined}
            helperText={t("analysis.realizedReturn", { value: metrics?.roi ?? 0 })}
          />
          <ERPMetricCard
            label={t("analysis.collectionEfficiency")}
            // null = nothing was due to be evaluated (future FY / no monthly
            // schedule members) — render "—", never a fabricated 100%.
            value={
              metrics?.collectionEfficiency === null || metrics?.collectionEfficiency === undefined
                ? "—"
                : `${metrics.collectionEfficiency}%`
            }
            icon={ShieldCheck}
            tone="cyan"
            // #15: the caption previously read a hardcoded, un-pluralized
            // "1 active portfolio projects" and paired the efficiency metric
            // with an unrelated project count. Localized + pluralized.
            helperText={t(
              (metrics?.activeProjects ?? 0) === 1
                ? "analysis.collectionEfficiencyHelperOne"
                : "analysis.collectionEfficiencyHelperOther",
              { count: metrics?.activeProjects ?? 0 },
            )}
          />
        </div>
      )}

      {/* Navigation Tabs + panels — hidden while the error card is shown, so
          a failed load never renders the "no data" empty states underneath. */}
      {!error || data ? (
      <>
      <div className="border-b border-slate-200 dark:border-border">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={cn(
              "py-3 text-xs font-semibold tracking-wider uppercase border-b-2 transition-colors flex items-center gap-2",
              activeTab === "overview"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400",
            )}
          >
            <BarChart3 className="w-4 h-4" />
            {t("analysis.tabOverview", { defaultValue: "Cash Flow & Sector Allocation" })}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("regularity")}
            className={cn(
              "py-3 text-xs font-semibold tracking-wider uppercase border-b-2 transition-colors flex items-center gap-2",
              activeTab === "regularity"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400",
            )}
          >
            <Clock className="w-4 h-4" />
            {t("analysis.tabRegularity", { defaultValue: "Shareholder Regularity Index" })}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("leaderboard")}
            className={cn(
              "py-3 text-xs font-semibold tracking-wider uppercase border-b-2 transition-colors flex items-center gap-2",
              activeTab === "leaderboard"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400",
            )}
          >
            <Award className="w-4 h-4" />
            {t("analysis.tabLeaderboard", { defaultValue: "Equity & Contribution Leaderboard" })}
          </button>
        </div>
      </div>

      {/* Tab 1: Overview (Cash Flow & Sector Allocations) */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Monthly Inflow vs Outflow Trend */}
            <div className="lg:col-span-2 bg-card p-5 rounded-xl border border-border/80 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                      {t("analysis.monthlyCashFlowTitle", { defaultValue: "Monthly Cash Flow Dynamics ({fy})", fy: fiscalYearDisplay })}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("analysis.monthlyCashFlowDesc", {
                        defaultValue: "Comparison of monthly deposits & earnings (Inflow) versus expenses & dividends (Outflow)",
                      })}
                    </p>
                  </div>
                </div>

                <div className="h-72 w-full pt-4">
                  {data && data.monthlyTrends.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chartMonthlyTrends}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                          </linearGradient>
                          <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#EF4444" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#EF4444" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                        <XAxis
                          dataKey="month"
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          axisLine={{ stroke: "#cbd5e1" }}
                        />
                        <YAxis
                          stroke="#64748b"
                          fontSize={11}
                          tickLine={false}
                          axisLine={{ stroke: "#cbd5e1" }}
                          tickFormatter={(val) => `${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#0f172a",
                            borderColor: "#334155",
                            borderRadius: "6px",
                            fontSize: "12px",
                            color: "#f8fafc",
                          }}
                          formatter={(value: any) => [fm(Number(value) || 0), " "]}
                        />
                        <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
                        <Area
                          type="monotone"
                          name={t("analysis.chartInflow", { defaultValue: "Inflow (Deposits)" })}
                          dataKey="inflow"
                          stroke="#10B981"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#inflowGrad)"
                        />
                        <Area
                          type="monotone"
                          name={t("analysis.chartOutflow", { defaultValue: "Outflow (Expenses/Dividends)" })}
                          dataKey="outflow"
                          stroke="#EF4444"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#outflowGrad)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400">
                        {t("analysis.noTransactionsForYear", { defaultValue: "No transaction records registered for {fy}", fy: fiscalYearDisplay })}
                      </div>
                  )}
                </div>
              </div>

              {/* Monthly Net Summary Pills */}
              <div className="grid grid-cols-6 gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-border">
                {data?.monthlyTrends.slice(0, 6).map((item, index) => (
                  <div key={item.month} className="text-center p-1.5 rounded bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">
                      {regularityColumns[index]?.short ?? item.month}
                    </span>
                    <p className={cn("text-xs font-bold mt-0.5", item.net >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {item.net >= 0 ? `+${fm(item.net)}` : fm(item.net)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Sector Capital Allocation Pie Chart */}
            <div className="bg-card p-5 rounded-xl border border-border/80 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                        {t("analysis.sectorAllocationTitle", { defaultValue: "Capital Allocation by Sector" })}
                      </h2>
                      {memberScoped && <TenantWideChip label={t("analysis.tenantWideBadge", { defaultValue: "Tenant-wide" })} />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {/* #14: state the measure so the number cannot be read as
                          "spent" or "remaining" when it means committed budget. */}
                      {t("analysis.sectorAllocationSubtitle", {
                        defaultValue: "Committed capital (project budget) by industry",
                      })}
                    </p>
                  </div>
                </div>

                <div className="h-56 w-full relative">
                  {data && data.sectorAllocations.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.sectorAllocations}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {data.sectorAllocations.map((_, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={SECTOR_COLORS[index % SECTOR_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#0f172a",
                            borderColor: "#334155",
                            borderRadius: "6px",
                            fontSize: "12px",
                            color: "#f8fafc",
                          }}
                          formatter={(value: any) => [fm(Number(value) || 0), t("analysis.capital", { defaultValue: "Capital" })]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400">
                        {t("analysis.noCapitalDeployed", { defaultValue: "No project capital deployed yet" })}
                      </div>
                  )}
                </div>
              </div>

              {/* Sector Breakdown Legend */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-border max-h-36 overflow-y-auto">
                {data?.sectorAllocations.map((item, index) => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: SECTOR_COLORS[index % SECTOR_COLORS.length] }}
                      />
                      <span className="text-slate-600 dark:text-slate-300 truncate max-w-[130px]" title={projectSectorLabel(t, item.name)}>
                        {projectSectorLabel(t, item.name)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-slate-400 text-[11px]">{item.percentage}%</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {fm(item.value)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Project Health & Risk Distribution */}
          <div className="bg-card p-5 rounded-xl border border-border/80 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                {t("analysis.healthMatrixTitle", { defaultValue: "Project Portfolio Health Matrix" })}
              </h2>
              {memberScoped && <TenantWideChip label={t("analysis.tenantWideBadge", { defaultValue: "Tenant-wide" })} />}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {t("analysis.healthMatrixDesc", {
                defaultValue: "Real-time operational status and capital exposure by project health tier",
              })}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {["Stable", "At Risk", "Critical"].map((tier) => {
                const item = data?.riskDistribution.find(
                  (r) => r.health.toLowerCase() === tier.toLowerCase(),
                );
                const count = item?.count ?? 0;
                const value = item?.value ?? 0;
                 const toneClass = HEALTH_COLORS[tier] || HEALTH_COLORS.Stable;
                 const tierLabel =
                   tier === "Stable"
                     ? t("analysis.health.stable", { defaultValue: "Stable" })
                     : tier === "At Risk"
                       ? t("analysis.health.atRisk", { defaultValue: "At Risk" })
                       : t("analysis.health.critical", { defaultValue: "Critical" });

                 return (
                  <div
                    key={tier}
                    className={cn("p-4 rounded-lg border flex items-center justify-between", toneClass)}
                  >
                    <div>
                        <span className="text-xs font-semibold uppercase tracking-wider block opacity-80">
                          {t("analysis.tierProjects", { defaultValue: "{tier} Projects", tier: tierLabel })}
                        </span>
                      <span className="text-xl font-bold mt-1 block">{count}</span>
                    </div>
                    <div className="text-right">
                        <span className="text-[11px] opacity-75 block">{t("analysis.capitalExposure", { defaultValue: "Capital Exposure" })}</span>
                      <span className="text-xs font-mono font-bold mt-0.5 block">{fm(value)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Regularity Index */}
      {activeTab === "regularity" && (
        <div className="bg-card rounded-xl border border-border/80 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                {t("analysis.regularityMatrixTitle", { defaultValue: "Shareholder Regularity & Punctuality Matrix ({fy})", fy: fiscalYearDisplay })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("analysis.regularityMatrixDesc", {
                  defaultValue: "12-month payment verification by deposit month — each cell reflects the month the deposit was made for, not the date it was entered",
                })}
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> {t("analysis.paidOnTime", { defaultValue: "Paid On-Time" })}
              </span>
              <span className="flex items-center gap-1.5 text-rose-600">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> {t("analysis.missedArrears", { defaultValue: "Missed / Arrears" })}
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-700" /> {t("analysis.pending", { defaultValue: "Pending" })}
              </span>
            </div>
          </div>

          {data?.depositModel && !data.depositModel.obligationMeasured && (
            // H9: an empty matrix here means "no deposit was ever owed", not "every
            // deposit is missing" and not "collection is perfect". Saying so is the
            // difference between an unmeasured value and a misleading one.
            <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-border dark:bg-slate-800/60 dark:text-slate-300">
              {t("analysis.depositModelNotMeasured", {
                defaultValue:
                  "This organisation uses flexible deposits — members have no monthly obligation, so punctuality and arrears are not measured. An empty grid below is expected, not a problem.",
              })}
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 uppercase tracking-wider font-semibold border-b border-slate-200 dark:border-border">
                <tr>
                  <th className="py-3 px-4">{t("analysis.shareholder", { defaultValue: "Shareholder" })}</th>
                  {regularityColumns.map((col) => (
                    <th
                      key={col.key}
                      className="py-3 px-2 text-center"
                      title={t("analysis.depositMonthTitle", {
                        depositMonth: col.depositMonth,
                        defaultValue: "Deposits made for {depositMonth}",
                      })}
                    >
                      <span className="block">{col.short}</span>
                      <span className="block text-[10px] font-mono font-normal opacity-70">
                        {String(col.calYear).slice(2)}
                      </span>
                    </th>
                  ))}
                  <th className="py-3 px-4 text-right">{t("analysis.punctuality", { defaultValue: "Punctuality" })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-border">
                {data && data.paymentMatrix.length > 0 ? (
                  data.paymentMatrix.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-900 dark:text-white">{item.name}</div>
                        <div className="text-[11px] font-mono text-slate-400">{item.memberId}</div>
                      </td>

                      {regularityColumns.map((col) => {
                        const status = item.months[col.key];
                        let badgeClass = "bg-slate-100 text-slate-400 dark:bg-slate-800";
                        let text = "—";
                        let title = `${t("analysis.pending", { defaultValue: "Pending" })} · ${col.depositMonth}`;

                        if (status === "PAID") {
                          badgeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold";
                          text = "OK";
                          title = `${t("analysis.paidOnTime", { defaultValue: "Paid On-Time" })} · ${t("analysis.depositMonthTitle", { depositMonth: col.depositMonth, defaultValue: "Deposits made for {depositMonth}" })}`;
                        } else if (status === "MISSED") {
                          badgeClass = "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold";
                          text = "X";
                          title = `${t("analysis.missedArrears", { defaultValue: "Missed / Arrears" })} · ${col.depositMonth}`;
                        }

                        return (
                          <td key={col.key} className="py-3 px-2 text-center">
                            <span
                              title={title}
                              className={cn(
                                "inline-block w-6 h-6 leading-6 text-[10px] rounded text-center font-mono",
                                badgeClass,
                              )}
                            >
                              {text}
                            </span>
                          </td>
                        );
                      })}

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {item.punctualityScore === null ? (
                            // No month was due for this member in this FY
                            // (future year, pre-join months, or a non-monthly
                            // deposit schedule) — 100% would be a lie.
                            <span
                              className="font-bold font-mono text-slate-400"
                              title={t("analysis.notEvaluated", {
                                defaultValue: "Not evaluated (no due month yet, or a non-monthly schedule)",
                              })}
                            >
                              —
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "font-bold font-mono",
                                item.punctualityScore >= 90
                                  ? "text-emerald-600"
                                  : item.punctualityScore >= 70
                                    ? "text-amber-600"
                                    : "text-rose-600",
                              )}
                            >
                              {item.punctualityScore}%
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                      <td colSpan={regularityColumns.length + 2} className="py-8 text-center text-slate-400">
                        {t("analysis.noShareholderRecords", { defaultValue: "No shareholder records found" })}
                      </td>
                  </tr>
                )}
              </tbody>
              {data && data.paymentMatrix.length > 0 && (
                <tfoot className="border-t border-slate-200 dark:border-border bg-slate-50/70 dark:bg-slate-800/40">
                  <tr>
                    <td className="py-2.5 px-4 font-semibold uppercase tracking-wider text-[11px] text-slate-500">
                      {t("analysis.paidOnTime", { defaultValue: "Paid On-Time" })}
                    </td>
                    {regularityTotals.map((col, i) => (
                      <td
                        key={regularityColumns[i]?.key ?? i}
                        className="py-2.5 px-2 text-center font-mono text-[11px]"
                        title={
                          col.rate === null
                            ? `${t("analysis.pending", { defaultValue: "Pending" })} · ${regularityColumns[i]?.depositMonth}`
                            : `${col.paid}/${col.evaluated} · ${col.rate}%`
                        }
                      >
                        {col.evaluated === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className={cn(
                            "font-semibold",
                            col.rate !== null && col.rate >= 90
                              ? "text-emerald-600"
                              : col.rate !== null && col.rate >= 70
                                ? "text-amber-600"
                                : "text-rose-600",
                          )}>
                            {col.paid}/{col.evaluated}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="py-2.5 px-4 text-right font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {regularityOverall.rate === null
                        ? "—"
                        : `${regularityOverall.paid}/${regularityOverall.evaluated} · ${regularityOverall.rate}%`}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Leaderboard */}
      {activeTab === "leaderboard" && (
        <div className="bg-card rounded-xl border border-border/80 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border/80">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                {t("analysis.leaderboardTitle", { defaultValue: "Shareholder Equity & Contribution Rankings" })}
              </h2>
              {memberScoped && <TenantWideChip label={t("analysis.tenantWideBadge", { defaultValue: "Tenant-wide" })} />}
              {/* The table is capped at the top 15 — say so, and by how many. */}
              {typeof metrics?.totalShareholders === "number" &&
                metrics.totalShareholders > (data?.leaderboard.length ?? 0) && (
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t("analysis.topOf", {
                      defaultValue: "Showing top {shown} of {total} shareholders",
                      shown: data?.leaderboard.length ?? 0,
                      total: metrics.totalShareholders,
                    })}
                  </span>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("analysis.leaderboardDesc", {
                defaultValue: "Ranked by cumulative capital invested and fractional voting equity",
              })}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-muted/30 text-muted-foreground uppercase tracking-wider font-semibold border-b border-border/80">
                <tr>
                  <th className="py-3 px-4 w-16 text-center">{t("analysis.rank", { defaultValue: "Rank" })}</th>
                  <th className="py-3 px-4">{t("analysis.shareholder", { defaultValue: "Shareholder" })}</th>
                  <th className="py-3 px-4 text-center">{t("analysis.memberId", { defaultValue: "Member ID" })}</th>
                  <th className="py-3 px-4 text-center">{t("analysis.sharesOwned", { defaultValue: "Shares Owned" })}</th>
                    <th
                      className="py-3 px-4 text-right"
                      title={t("analysis.cumulativeCapitalHelper", {
                        defaultValue: "Net of reverts; includes capital received via equity transfers",
                      })}
                    >
                      {t("analysis.cumulativeCapital", { defaultValue: "Cumulative Capital" })}
                    </th>
                  <th className="py-3 px-4 text-right">{t("analysis.equitySharePercent", { defaultValue: "Equity Share %" })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data && data.leaderboard.length > 0 ? (
                  data.leaderboard.map((item) => {
                    let rankBadge = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
                    if (item.rank === 1) rankBadge = "bg-amber-100 text-amber-800 font-bold border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800";
                    if (item.rank === 2) rankBadge = "bg-slate-200 text-slate-700 font-bold border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-border";
                    if (item.rank === 3) rankBadge = "bg-orange-100 text-orange-800 font-bold border border-orange-300 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800";

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 text-center">
                          <span
                            className={cn(
                              "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-mono",
                              rankBadge,
                            )}
                          >
                            {item.rank}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                          {item.name}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-500">
                          {item.memberId}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-slate-700 dark:text-slate-200">
                          {item.shares.toLocaleString(intlLocaleFor(locale))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {fm(item.totalContributed)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2 font-mono">
                            <span className="font-bold text-blue-600 dark:text-blue-400">
                              {item.equitySharePercent}%
                            </span>
                            <div className="w-16 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-blue-600 h-full rounded-full"
                                style={{ width: `${Math.min(100, item.equitySharePercent * 2)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        {t("analysis.noContributorData", { defaultValue: "No contributor data available" })}
                      </td>
                  </tr>
                 )}
               </tbody>
             </table>
           </div>
         </div>
       )}
       </>
       ) : null}
      </div>
    );
  }
