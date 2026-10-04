"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
  Award,
  Plus,
  Receipt,
  Layers,
  Users,
  Download,
  ChevronRight,
  Landmark,
  Wallet,
  PiggyBank,
  PieChart as PieIcon,
  Activity,
  Coins,
  TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useLocale } from "@/lib/i18n";
import { formatMoney, formatCompactNumber } from "@/lib/formatters";
import { ERPMetricCard, Button, CardGridSkeleton, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AnalyticsStats, Project, Member, Transaction } from "@/types";

interface DashboardViewProps {
  stats: AnalyticsStats | null;
  projects: Project[];
  members: Member[];
  recentTransactions?: Transaction[];
  isLoading: boolean;
  onNavigate: (route: string) => void;
}

// Vivid, hue-separated palette that stays legible on light and ink card surfaces.
const SECTOR_COLORS = [
  "#14b8a6", // teal (primary brand)
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#64748b", // slate (fallback / "Other")
];

const DEPOSIT_BAR = "#10b981";
const RATE_LINE = "#6366f1";
const INCOME_BAR = "#10b981";
const EXPENSE_BAR = "#f43f5e";
const FOUNDING_COLOR = "indigo" as const;
const NORMAL_COLOR = "slate" as const;

/** Funds health status → dot/bar color + i18n status label key. */
const FUNDS_HEALTH_TONE: Record<
  string,
  { dot: string; bar: string; labelKey: string }
> = {
  Good: { dot: "bg-emerald-500", bar: "bg-emerald-500", labelKey: "dashboard.healthGood" },
  Stable: { dot: "bg-cyan-500", bar: "bg-cyan-500", labelKey: "dashboard.healthStable" },
  "At Risk": { dot: "bg-amber-500", bar: "bg-amber-500", labelKey: "dashboard.healthAtRisk" },
  Critical: { dot: "bg-rose-500", bar: "bg-rose-500", labelKey: "dashboard.healthCritical" },
};

function truncateLabel(name: string, max = 16): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/** 'YYYY-MM' → 'MM/YYYY' — deterministic, no locale drift (AGENTS.md §8). */
function formatMonthKey(key: string): string {
  return `${key.slice(5, 7)}/${key.slice(0, 4)}`;
}

export function DashboardView({
  stats,
  projects,
  members,
  recentTransactions = [],
  isLoading,
  onNavigate,
}: DashboardViewProps) {
  const { t } = useLocale();
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && (resolvedTheme ?? theme) === "dark";

  // Real figures only — no fabricated baselines (AGENTS.md §0/§12).
  const totalAssets = stats?.totalAssets ?? 0;
  const totalDeposits = stats?.totalDeposits ?? 0;
  const depositCount = stats?.depositCount ?? 0;
  const totalExpenses = stats?.totalExpenses ?? 0;
  const dividends = stats?.totalDividendsDistributed ?? 0;
  const netReserves = stats?.netReserveBalance ?? 0;
  const totalMembers = stats?.totalMembers ?? members.length;
  const activeMembers = stats?.activeMembers ?? totalMembers;
  const activeProjects = stats?.activeProjects ?? projects.length;
  const ongoingBudget = stats?.ongoingBudget ?? 0;
  const totalShares = stats?.totalShares ?? 0;
  const foundingShares = stats?.foundingShares ?? 0;
  const normalShares = stats?.normalShares ?? 0;
  const foundingMembers = stats?.foundingMembers ?? 0;
  const normalMembers = stats?.normalMembers ?? 0;
  const investmentsTotal = stats?.investmentsTotal ?? 0;
  const investmentsCount = stats?.investmentsCount ?? 0;
  const monthlyDeposits = stats?.monthlyDeposits ?? [];
  const ongoingProjectFinance = stats?.ongoingProjectFinance ?? [];
  const fundsHealth = stats?.fundsHealth;
  // null = no historical data to compute growth from — render "—", not a guess.
  const monthlyGrowth = stats?.monthlyGrowthRate ?? null;

  // ── Chart data derived from server aggregates (no client-side fabrication) ──

  // Capital allocation by sector: sum committed budget per project category.
  const sectorData = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      const cat = (p.category || "Uncategorized").trim();
      map.set(cat, (map.get(cat) || 0) + (Number(p.budget) || 0));
    }
    let arr = [...map.entries()]
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (arr.length > 6) {
      const top = arr.slice(0, 6);
      const other = arr.slice(6).reduce((s, a) => s + a.value, 0);
      arr = [...top, { name: "Other", value: other }];
    }
    const total = arr.reduce((s, a) => s + a.value, 0);
    return arr.map((a) => ({ ...a, percentage: total > 0 ? (a.value / total) * 100 : 0 }));
  }, [projects]);
  const sectorTotal = sectorData.reduce((s, a) => s + a.value, 0);

  // Ongoing project income vs expenses (top 8 by budget, server-ordered).
  const projectFinanceData = useMemo(
    () =>
      ongoingProjectFinance.slice(0, 8).map((p) => ({
        title: truncateLabel(p.title, 18),
        income: p.income,
        expenses: p.expenses,
      })),
    [ongoingProjectFinance],
  );
  const financeTotals = useMemo(
    () =>
      ongoingProjectFinance.reduce(
        (acc, p) => ({
          income: acc.income + p.income,
          expenses: acc.expenses + p.expenses,
        }),
        { income: 0, expenses: 0 },
      ),
    [ongoingProjectFinance],
  );

  const hasDepositSeries = monthlyDeposits.some((m) => m.amount > 0 || m.count > 0);
  const sharesSplitTotal = foundingShares + normalShares;
  const healthTone = fundsHealth ? FUNDS_HEALTH_TONE[fundsHealth.status] ?? FUNDS_HEALTH_TONE.Stable : null;
  const runwayPct =
    fundsHealth?.runwayMonths != null
      ? Math.min(100, (fundsHealth.runwayMonths / 12) * 100)
      : fundsHealth && fundsHealth.monthlyBurn <= 0
        ? 100
        : 0;

  const tooltipStyle = {
    backgroundColor: dark ? "#0b1220" : "#ffffff",
    border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
    borderRadius: 10,
    fontSize: 12,
    color: dark ? "#f8fafc" : "#0f172a",
    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
  } as const;
  const axisTick = { fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 };
  const gridStroke = dark ? "#334155" : "#e2e8f0";

  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardGridSkeleton count={4} />
        <CardGridSkeleton count={4} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-xl border border-border/80 bg-card p-5 min-h-[300px]">
            <Skeleton className="h-5 w-40 rounded mb-4" />
            <Skeleton className="h-56 w-full rounded-xl" />
          </div>
          <div className="lg:col-span-5 rounded-xl border border-border/80 bg-card p-5 min-h-[300px]">
            <Skeleton className="h-5 w-32 rounded mb-4" />
            <Skeleton className="h-56 w-full rounded-xl" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 rounded-xl border border-border/80 bg-card p-5 min-h-[260px]">
            <Skeleton className="h-5 w-44 rounded mb-4" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
          <div className="lg:col-span-4 rounded-xl border border-border/80 bg-card p-5 min-h-[260px]">
            <Skeleton className="h-5 w-28 rounded mb-4" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── KPI Row 1: the four headline metrics ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("dashboard.totalDeposits", { defaultValue: "Total Deposits" })}
          value={formatMoney(totalDeposits)}
          icon={Wallet}
          tone="emerald"
          helperText={t("dashboard.depositsCount", { count: depositCount, defaultValue: `${depositCount} deposits` })}
          footer={
            <FooterLink label={t("dashboard.depositsLink", { defaultValue: "Deposits" })} onClick={() => onNavigate("/deposits")} />
          }
        />
        <ERPMetricCard
          label={t("dashboard.totalShares", { defaultValue: "Total Shares" })}
          value={formatCompactNumber(totalShares)}
          icon={Coins}
          tone="cyan"
          helperText={t("dashboard.membersCount", { count: totalMembers, defaultValue: `${totalMembers} members` })}
          breakdowns={[
            {
              label: t("dashboard.sharesFounding", { defaultValue: "Founding" }),
              count: formatCompactNumber(foundingShares),
              color: FOUNDING_COLOR,
              percentage: sharesSplitTotal > 0 ? (foundingShares / sharesSplitTotal) * 100 : 0,
            },
            {
              label: t("dashboard.sharesNormal", { defaultValue: "Normal" }),
              count: formatCompactNumber(normalShares),
              color: NORMAL_COLOR,
              percentage: sharesSplitTotal > 0 ? (normalShares / sharesSplitTotal) * 100 : 0,
            },
          ]}
          footer={
            <FooterLink label={t("dashboard.membersLink", { defaultValue: "Members" })} onClick={() => onNavigate("/members")} />
          }
        />
        <ERPMetricCard
          label={t("dashboard.ongoingProjects", { defaultValue: "Ongoing Projects" })}
          value={activeProjects}
          icon={Layers}
          tone="amber"
          helperText={`${t("dashboard.ongoingBudget", { defaultValue: "Committed budget" })}: ${formatMoney(ongoingBudget)}`}
          footer={
            <FooterLink label={t("dashboard.quickProjects", { defaultValue: "Projects" })} onClick={() => onNavigate("/projects")} />
          }
        />
        <ERPMetricCard
          label={t("dashboard.totalInvestments", { defaultValue: "Total Investments" })}
          value={formatMoney(investmentsTotal)}
          icon={TrendingUp}
          tone="slate"
          helperText={t("dashboard.investmentsCount", { count: investmentsCount, defaultValue: `${investmentsCount} investments` })}
          footer={
            <FooterLink label={t("dashboard.analysisLink", { defaultValue: "Analysis" })} onClick={() => onNavigate("/analysis")} />
          }
        />
      </div>

      {/* ── KPI Row 2: supporting financial & membership figures ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("dashboard.totalAssets", { defaultValue: "Total Assets" })}
          value={formatMoney(totalAssets)}
          icon={Landmark}
          tone="cyan"
          trend={
            monthlyGrowth === null
              ? undefined
              : { value: monthlyGrowth, isPositive: monthlyGrowth >= 0 }
          }
          helperText={t("dashboard.assetsHelper", { defaultValue: "Portfolio value + fund reserves" })}
          footer={
            <FooterLink label={t("dashboard.analysisLink", { defaultValue: "Analysis" })} onClick={() => onNavigate("/analysis")} />
          }
        />
        <ERPMetricCard
          label={t("dashboard.dividendsDistributed", { defaultValue: "Dividends Distributed" })}
          value={formatMoney(dividends)}
          icon={PiggyBank}
          tone="amber"
          helperText={`${t("dashboard.netReserves", { defaultValue: "Net Reserves" })}: ${formatMoney(netReserves)}`}
          footer={
            <FooterLink label={t("dashboard.dividendsLink", { defaultValue: "Dividends" })} onClick={() => onNavigate("/dividends")} />
          }
        />
        <ERPMetricCard
          label={t("dashboard.activeMembers", { defaultValue: "Active Members" })}
          value={totalMembers}
          icon={Users}
          tone="slate"
          helperText={`${t("dashboard.sharesFounding", { defaultValue: "Founding" })}: ${foundingMembers} · ${t("dashboard.sharesNormal", { defaultValue: "Normal" })}: ${normalMembers}`}
          footer={
            <FooterLink label={t("dashboard.membersLink", { defaultValue: "Members" })} onClick={() => onNavigate("/members")} />
          }
        />
        <ERPMetricCard
          label={t("dashboard.expenses", { defaultValue: "Expenses" })}
          value={formatMoney(totalExpenses)}
          icon={Receipt}
          tone="rose"
          helperText={`${t("dashboard.activeProjects", { defaultValue: "Active Projects" })}: ${activeProjects}`}
          footer={
            <FooterLink label={t("dashboard.fullLedger", { defaultValue: "Full Ledger" })} onClick={() => onNavigate("/transactions")} />
          }
        />
      </div>

      {/* ── Insights: Monthly deposit rate + Funds health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Deposit submission rate by month */}
        <div className="lg:col-span-7 rounded-xl border border-border/80 bg-card p-5 shadow-2xs flex flex-col">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {t("dashboard.monthlyDepositTrend", { defaultValue: "Deposit Submission Rate" })}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {t("dashboard.monthlyDepositTrendDesc", { defaultValue: "Monthly deposits and share of members submitting" })}
                </p>
              </div>
            </div>
          </div>

          <div className="h-64 w-full">
            {hasDepositSeries ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={monthlyDeposits}
                  margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                >
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                    stroke={gridStroke}
                    opacity={0.5}
                  />
                  <XAxis
                    dataKey="month"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={{ stroke: gridStroke }}
                    tickFormatter={formatMonthKey}
                  />
                  <YAxis
                    yAxisId="amount"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatCompactNumber(Number(v))}
                  />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    domain={[0, 100]}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ fill: dark ? "#ffffff10" : "#0f172a08" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload as {
                        month: string;
                        amount: number;
                        count: number;
                        submittingMembers: number;
                        submissionRate: number | null;
                      };
                      return (
                        <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                          <div className="mb-1 font-semibold text-foreground">
                            {formatMonthKey(p.month)}
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">{t("dashboard.depositsStream", { defaultValue: "Member Deposits" })}</span>
                            <span className="font-mono font-semibold text-foreground">{formatMoney(p.amount)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">{t("dashboard.depositsCount", { count: p.count, defaultValue: `${p.count} deposits` })}</span>
                            <span className="font-mono text-foreground">{p.submittingMembers}</span>
                          </div>
                          {p.submissionRate !== null && (
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-muted-foreground">{t("dashboard.submissionRate", { defaultValue: "Submission rate" })}</span>
                              <span className="font-mono font-semibold" style={{ color: RATE_LINE }}>
                                {p.submissionRate}%
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Bar
                    yAxisId="amount"
                    dataKey="amount"
                    fill={DEPOSIT_BAR}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    name={t("dashboard.depositsStream", { defaultValue: "Member Deposits" })}
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="submissionRate"
                    stroke={RATE_LINE}
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 0, fill: RATE_LINE }}
                    activeDot={{ r: 4 }}
                    connectNulls
                    name={t("dashboard.submissionRate", { defaultValue: "Submission rate" })}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart
                icon={<Activity className="h-6 w-6 stroke-[1.5]" />}
                message={t("dashboard.noDepositData", { defaultValue: "No deposits recorded yet." })}
              />
            )}
          </div>
        </div>

        {/* Funds health indicator */}
        <div className="lg:col-span-5 rounded-xl border border-border/80 bg-card p-5 shadow-2xs flex flex-col">
          <div className="mb-4 flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {t("dashboard.equityHealth", { defaultValue: "Fund Health" })}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {t("dashboard.fundsHealthDesc", { defaultValue: "Overall financial status" })}
              </p>
            </div>
          </div>

          {fundsHealth && healthTone ? (
            <div className="flex flex-1 flex-col justify-between gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", healthTone.dot)} />
                  <span className="text-base font-bold text-foreground">
                    {t(healthTone.labelKey, { defaultValue: fundsHealth.status })}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {fundsHealth.runwayMonths !== null
                    ? t("dashboard.runwayMonths", { months: fundsHealth.runwayMonths, defaultValue: `${fundsHealth.runwayMonths} mo` })
                    : t("dashboard.runwayNoBurn", { defaultValue: "No expenses yet" })}
                </span>
              </div>

              <div>
                <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", healthTone.bar)}
                    style={{ width: `${runwayPct}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <span>{t("dashboard.runway", { defaultValue: "Runway" })}</span>
                  <span>12</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 border-t border-border/60 pt-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.netReserves", { defaultValue: "Net Reserves" })}
                  </div>
                  <div className="mt-0.5 text-sm font-bold font-mono text-foreground">
                    {formatMoney(fundsHealth.reserves)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.monthlyBurn", { defaultValue: "Monthly Burn" })}
                  </div>
                  <div className="mt-0.5 text-sm font-bold font-mono text-foreground">
                    {formatMoney(fundsHealth.monthlyBurn)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.runway", { defaultValue: "Runway" })}
                  </div>
                  <div className="mt-0.5 text-sm font-bold font-mono text-foreground">
                    {fundsHealth.runwayMonths !== null
                      ? t("dashboard.runwayMonths", { months: fundsHealth.runwayMonths, defaultValue: `${fundsHealth.runwayMonths} mo` })
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyChart
              icon={<Landmark className="h-6 w-6 stroke-[1.5]" />}
              message={t("dashboard.noFlowData", { defaultValue: "No capital movements recorded yet." })}
            />
          )}
        </div>
      </div>

      {/* ── Ongoing project finance + Sector allocation ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Ongoing project income vs expenses */}
        <div className="lg:col-span-8 rounded-xl border border-border/80 bg-card p-5 shadow-2xs flex flex-col">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {t("dashboard.incomeVsExpenses", { defaultValue: "Project Income vs Expenses" })}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {t("dashboard.incomeVsExpensesDesc", { defaultValue: "Ongoing projects: earnings against expenses" })}
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: INCOME_BAR }} />
                {t("dashboard.chartIncome", { defaultValue: "Income" })}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: EXPENSE_BAR }} />
                {t("dashboard.expenses", { defaultValue: "Expenses" })}
              </span>
            </div>
          </div>

          {projectFinanceData.length > 0 ? (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={projectFinanceData}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      strokeDasharray="3 3"
                      stroke={gridStroke}
                      opacity={0.5}
                    />
                    <XAxis
                      type="number"
                      tick={axisTick}
                      tickLine={false}
                      axisLine={{ stroke: gridStroke }}
                      tickFormatter={(v) => formatCompactNumber(Number(v))}
                    />
                    <YAxis
                      type="category"
                      dataKey="title"
                      width={130}
                      tick={axisTick}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: dark ? "#ffffff10" : "#0f172a08" }}
                      contentStyle={tooltipStyle}
                      formatter={(value: any) => [formatMoney(Number(value) || 0), ""]}
                    />
                    <Bar dataKey="income" fill={INCOME_BAR} radius={[0, 4, 4, 0]} barSize={10} name={t("dashboard.chartIncome", { defaultValue: "Income" })} />
                    <Bar dataKey="expenses" fill={EXPENSE_BAR} radius={[0, 4, 4, 0]} barSize={10} name={t("dashboard.expenses", { defaultValue: "Expenses" })} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 rounded-b-xl border-t border-border/60 bg-muted/15 p-3 px-5 -mx-5 -mb-5 mt-4 text-xs text-muted-foreground">
                <span>
                  {t("dashboard.chartIncome", { defaultValue: "Income" })}:{" "}
                  <span className="font-mono font-semibold text-foreground">{formatMoney(financeTotals.income)}</span>
                </span>
                <span>
                  {t("dashboard.expenses", { defaultValue: "Expenses" })}:{" "}
                  <span className="font-mono font-semibold text-foreground">{formatMoney(financeTotals.expenses)}</span>
                </span>
                <span>
                  {financeTotals.income - financeTotals.expenses >= 0
                    ? t("dashboard.surplus", { defaultValue: "Surplus" })
                    : t("dashboard.deficit", { defaultValue: "Deficit" })}
                  :{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {formatMoney(Math.abs(financeTotals.income - financeTotals.expenses))}
                  </span>
                </span>
              </div>
            </>
          ) : (
            <div className="h-64">
              <EmptyChart
                icon={<Layers className="h-6 w-6 stroke-[1.5]" />}
                message={t("dashboard.noProjectFinance", { defaultValue: "No ongoing projects yet." })}
              />
            </div>
          )}
        </div>

        {/* Sector Allocation donut */}
        <div className="lg:col-span-4 rounded-xl border border-border/80 bg-card p-5 shadow-2xs flex flex-col">
          <div className="mb-3 flex items-center gap-2">
            <PieIcon className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {t("dashboard.sectorAllocation", { defaultValue: "Capital by Sector" })}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {t("dashboard.sectorAllocationDesc", { defaultValue: "Committed budget per project category" })}
              </p>
            </div>
          </div>

          {sectorData.length > 0 ? (
            <>
              <div className="relative h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: any, name: any) => [formatMoney(Number(value) || 0), String(name)]}
                    />
                    <Pie
                      data={sectorData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={54}
                      outerRadius={78}
                      paddingAngle={2}
                      stroke="none"
                      startAngle={90}
                      endAngle={-270}
                    >
                      {sectorData.map((entry, i) => (
                        <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.totalDeployed", { defaultValue: "Total Deployed" })}
                  </span>
                  <span className="text-base font-bold tracking-tight text-foreground">
                    {formatMoney(sectorTotal)}
                  </span>
                </div>
              </div>

              <ul className="mt-3 space-y-1.5">
                {sectorData.map((entry, i) => (
                  <li key={entry.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: SECTOR_COLORS[i % SECTOR_COLORS.length] }}
                    />
                    <span className="truncate text-muted-foreground">{truncateLabel(entry.name, 22)}</span>
                    <span className="ml-auto font-mono font-semibold text-foreground">
                      {entry.percentage.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="h-44">
              <EmptyChart
                icon={<Layers className="h-6 w-6 stroke-[1.5]" />}
                message={t("dashboard.noSectorData", { defaultValue: "No projects to allocate yet." })}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Transactions + Quick Links ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Recent transactions */}
        <div className="lg:col-span-8 rounded-xl border border-border/80 bg-card shadow-2xs flex flex-col">
          <div className="flex items-center justify-between border-b border-border/60 p-4 px-5">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                {t("dashboard.recentTransactions", { defaultValue: "Recent transactions" })}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("/transactions")}
              className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <span>{t("dashboard.fullLedger", { defaultValue: "Full Ledger" })}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-border/90 bg-muted/40 text-muted-foreground">
                <Receipt className="h-6 w-6 stroke-[1.5]" />
              </div>
              <p className="mb-3 text-xs font-medium text-muted-foreground">
                {t("dashboard.noTransactions", { defaultValue: "No transactions recorded yet." })}
              </p>
              <Button variant="outline" size="sm" icon={Plus} onClick={() => onNavigate("/deposits")}>
                {t("dashboard.newDeposit", { defaultValue: "New Deposit" })}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto p-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("dashboard.thDate", { defaultValue: "Date" })}</th>
                    <th className="px-3 py-2 font-medium">{t("dashboard.thReference", { defaultValue: "Reference" })}</th>
                    <th className="px-3 py-2 font-medium">{t("dashboard.thMember", { defaultValue: "Member" })}</th>
                    <th className="px-3 py-2 font-medium">{t("dashboard.thType", { defaultValue: "Type" })}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("dashboard.thAmount", { defaultValue: "Amount" })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {recentTransactions.slice(0, 6).map((txn) => {
                    const amount = Number(txn.amount) || 0;
                    const isCredit = !/expense|dividend|disburse/i.test(txn.type);
                    return (
                      <tr key={txn.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(txn.date).toLocaleDateString("en-GB")}
                        </td>
                        <td className="px-3 py-2 font-medium text-foreground">
                          {txn.referenceNumber || txn.id.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2 text-foreground">{txn.memberName || "—"}</td>
                        <td className="px-3 py-2">
                          <span className="text-muted-foreground">{txn.type}</span>
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-mono font-semibold",
                            isCredit
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400",
                          )}
                        >
                          {isCredit ? "+" : "−"}
                          {formatMoney(Math.abs(amount))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-end rounded-b-xl border-t border-border/60 bg-muted/15 p-3 px-5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("dashboard.totalDeposits", { defaultValue: "Total Deposits" })}: {formatMoney(totalDeposits)}
            </span>
          </div>
        </div>

        {/* Right: Quick links */}
        <div className="lg:col-span-4 rounded-xl border border-border/80 bg-card p-5 shadow-2xs flex flex-col">
          <div className="flex items-center gap-2 border-b border-border/60 pb-3">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              {t("dashboard.quickLinks", { defaultValue: "Quick links" })}
            </h2>
          </div>

          <div className="space-y-2 py-3">
            <QuickLink
              onClick={() => onNavigate("/deposits")}
              icon={<Plus className="h-4 w-4" />}
              tone="emerald"
              title={t("dashboard.quickNewDeposit", { defaultValue: "New deposit" })}
              desc={t("dashboard.quickNewDepositDesc", { defaultValue: "Record a member deposit" })}
            />
            <QuickLink
              onClick={() => onNavigate("/projects")}
              icon={<Layers className="h-4 w-4" />}
              tone="cyan"
              title={t("dashboard.quickProjects", { defaultValue: "Projects" })}
              desc={t("dashboard.quickProjectsDesc", { defaultValue: "Track fund allocations" })}
            />
            <QuickLink
              onClick={() => onNavigate("/dividends")}
              icon={<Award className="h-4 w-4" />}
              tone="amber"
              title={t("dashboard.quickDividends", { defaultValue: "Dividends" })}
              desc={t("dashboard.quickDividendsDesc", { defaultValue: "Shareholder distributions" })}
            />
            <QuickLink
              onClick={() => onNavigate("/members")}
              icon={<Users className="h-4 w-4" />}
              tone="indigo"
              title={t("dashboard.quickMembers", { defaultValue: "Members" })}
              desc={t("dashboard.quickMembersDesc", { defaultValue: "Manage shareholder records" })}
            />
          </div>

          <div className="border-t border-border/60 pt-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              icon={Download}
              className="w-full"
              onClick={() => onNavigate("/reports")}
            >
              {t("dashboard.downloadReports", { defaultValue: "Download Reports" })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FooterLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
    >
      <span>{label}</span>
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );
}

function EmptyChart({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-border/70 text-center">
      <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
        {icon}
      </div>
      <p className="max-w-[16rem] text-xs font-medium text-muted-foreground">{message}</p>
    </div>
  );
}

const quickLinkTones: Record<string, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
};

function QuickLink({
  onClick,
  icon,
  tone,
  title,
  desc,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  tone: keyof typeof quickLinkTones;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between gap-3 rounded-xl border border-transparent p-2.5 text-left transition-all hover:border-border/60 hover:bg-muted/40"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            quickLinkTones[tone],
          )}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{desc}</span>
        </span>
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
