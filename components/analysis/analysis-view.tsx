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
import { formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface AnalysisViewProps {
  data: AnalysisData | null;
  members: Member[];
  isLoading: boolean;
  selectedYear: number;
  selectedMemberId: string;
  onYearChange: (year: number) => void;
  onMemberChange: (memberId: string) => void;
  onRefresh: () => void;
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

const HEALTH_COLORS: Record<string, string> = {
  Stable: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  Good: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  "At Risk": "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  Critical: "text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
};

export function AnalysisView({
  data,
  members,
  isLoading,
  selectedYear,
  selectedMemberId,
  onYearChange,
  onMemberChange,
  onRefresh,
}: AnalysisViewProps) {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<"overview" | "regularity" | "leaderboard">("overview");

  const currentYear = new Date().getFullYear();
  const yearOptions: DropdownOption[] = useMemo(() => {
    return [currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map((y) => ({
      value: String(y),
      label: `Fiscal Year ${y}`,
    }));
  }, [currentYear]);

  const memberOptions: DropdownOption[] = useMemo(() => {
    const list: DropdownOption[] = [{ value: "all", label: "All Shareholders (Consolidated)" }];
    members.forEach((m) => {
      list.push({
        value: m.id,
        label: `${m.name} (${m.memberId})`,
      });
    });
    return list;
  }, [members]);

  const metrics = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border/80 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <AppDropdown
              options={yearOptions}
              value={String(selectedYear)}
              onChange={(val) => onYearChange(parseInt(val || String(currentYear), 10))}
              placeholder="Select Year"
            />
          </div>

          <div className="w-64">
            <AppDropdown
              options={memberOptions}
              value={selectedMemberId}
              onChange={(val) => onMemberChange(val || "all")}
              placeholder="Filter by Shareholder"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            icon={RefreshCw}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Executive KPIs */}
      {isLoading ? (
        <CardGridSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ERPMetricCard
            label="Total Capital Invested"
            value={formatMoney(metrics?.totalInvested ?? 0)}
            icon={Wallet}
            tone="slate"
            helperText="Sum of all verified deposits to date"
          />
          <ERPMetricCard
            label="Consolidated Portfolio Value"
            value={formatMoney(metrics?.totalAssetValue ?? 0)}
            icon={Landmark}
            tone="emerald"
            helperText="Active project capital + fund reserves"
          />
          <ERPMetricCard
            label="Portfolio Net Return"
            value={formatMoney(metrics?.netProfit ?? 0)}
            icon={TrendingUp}
            tone={(metrics?.netProfit ?? 0) >= 0 ? "emerald" : "rose"}
            helperText={`Realized Return: ${metrics?.roi ?? 0}%`}
          />
          <ERPMetricCard
            label="Collection Efficiency"
            value={`${metrics?.collectionEfficiency ?? 100}%`}
            icon={ShieldCheck}
            tone="cyan"
            helperText={`${metrics?.activeProjects ?? 0} active portfolio projects`}
          />
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
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
            Cash Flow & Sector Allocation
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
            Shareholder Regularity Index
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
            Equity & Contribution Leaderboard
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
                      Monthly Cash Flow Dynamics ({selectedYear})
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Comparison of monthly deposits & earnings (Inflow) versus expenses & dividends (Outflow)
                    </p>
                  </div>
                </div>

                <div className="h-72 w-full pt-4">
                  {data && data.monthlyTrends.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={data.monthlyTrends}
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
                          formatter={(value: any) => [formatMoney(Number(value) || 0), ""]}
                        />
                        <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }} />
                        <Area
                          type="monotone"
                          name="Inflow (Deposits)"
                          dataKey="inflow"
                          stroke="#10B981"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#inflowGrad)"
                        />
                        <Area
                          type="monotone"
                          name="Outflow (Expenses/Dividends)"
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
                      No transaction records registered for {selectedYear}
                    </div>
                  )}
                </div>
              </div>

              {/* Monthly Net Summary Pills */}
              <div className="grid grid-cols-6 gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                {data?.monthlyTrends.slice(0, 6).map((item) => (
                  <div key={item.month} className="text-center p-1.5 rounded bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">{item.month}</span>
                    <p className={cn("text-xs font-bold mt-0.5", item.net >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {item.net >= 0 ? `+${formatMoney(item.net)}` : formatMoney(item.net)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Sector Capital Allocation Pie Chart */}
            <div className="bg-card p-5 rounded-xl border border-border/80 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                      Capital Allocation by Sector
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Project portfolio weightings across industries
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
                          formatter={(value: any) => [formatMoney(Number(value) || 0), "Capital"]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      No project capital deployed yet
                    </div>
                  )}
                </div>
              </div>

              {/* Sector Breakdown Legend */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800 max-h-36 overflow-y-auto">
                {data?.sectorAllocations.map((item, index) => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: SECTOR_COLORS[index % SECTOR_COLORS.length] }}
                      />
                      <span className="text-slate-600 dark:text-slate-300 truncate max-w-[130px]" title={item.name}>
                        {item.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-slate-400 text-[11px]">{item.percentage}%</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {formatMoney(item.value)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Project Health & Risk Distribution */}
          <div className="bg-card p-5 rounded-xl border border-border/80 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground mb-1">
              Project Portfolio Health Matrix
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Real-time operational status and capital exposure by project health tier
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {["Stable", "At Risk", "Critical"].map((tier) => {
                const item = data?.riskDistribution.find(
                  (r) => r.health.toLowerCase() === tier.toLowerCase(),
                );
                const count = item?.count ?? 0;
                const value = item?.value ?? 0;
                const toneClass = HEALTH_COLORS[tier] || HEALTH_COLORS.Stable;

                return (
                  <div
                    key={tier}
                    className={cn("p-4 rounded-lg border flex items-center justify-between", toneClass)}
                  >
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider block opacity-80">
                        {tier} Projects
                      </span>
                      <span className="text-xl font-bold mt-1 block">{count}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] opacity-75 block">Capital Exposure</span>
                      <span className="text-xs font-mono font-bold mt-0.5 block">{formatMoney(value)}</span>
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
                Shareholder Regularity & Punctuality Matrix ({selectedYear})
              </h2>
              <p className="text-xs text-muted-foreground">
                12-month payment verification across shareholders to monitor commitment and discipline
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Paid On-Time
              </span>
              <span className="flex items-center gap-1.5 text-rose-600">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Missed / Arrears
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-700" /> Pending
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 uppercase tracking-wider font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Shareholder</th>
                  <th className="py-3 px-2 text-center">Jan</th>
                  <th className="py-3 px-2 text-center">Feb</th>
                  <th className="py-3 px-2 text-center">Mar</th>
                  <th className="py-3 px-2 text-center">Apr</th>
                  <th className="py-3 px-2 text-center">May</th>
                  <th className="py-3 px-2 text-center">Jun</th>
                  <th className="py-3 px-2 text-center">Jul</th>
                  <th className="py-3 px-2 text-center">Aug</th>
                  <th className="py-3 px-2 text-center">Sep</th>
                  <th className="py-3 px-2 text-center">Oct</th>
                  <th className="py-3 px-2 text-center">Nov</th>
                  <th className="py-3 px-2 text-center">Dec</th>
                  <th className="py-3 px-4 text-right">Punctuality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
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

                      {[
                        "january", "february", "march", "april", "may", "june",
                        "july", "august", "september", "october", "november", "december",
                      ].map((mKey) => {
                        const status = item.months[mKey];
                        let badgeClass = "bg-slate-100 text-slate-400 dark:bg-slate-800";
                        let text = "—";

                        if (status === "PAID") {
                          badgeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold";
                          text = "OK";
                        } else if (status === "MISSED") {
                          badgeClass = "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold";
                          text = "X";
                        }

                        return (
                          <td key={mKey} className="py-3 px-2 text-center">
                            <span
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
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={14} className="py-8 text-center text-slate-400">
                      No shareholder records found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Leaderboard */}
      {activeTab === "leaderboard" && (
        <div className="bg-card rounded-xl border border-border/80 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border/80">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Shareholder Equity & Contribution Rankings
            </h2>
            <p className="text-xs text-muted-foreground">
              Ranked by cumulative capital invested and fractional voting equity
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-muted/30 text-muted-foreground uppercase tracking-wider font-semibold border-b border-border/80">
                <tr>
                  <th className="py-3 px-4 w-16 text-center">Rank</th>
                  <th className="py-3 px-4">Shareholder</th>
                  <th className="py-3 px-4 text-center">Member ID</th>
                  <th className="py-3 px-4 text-center">Shares Owned</th>
                  <th className="py-3 px-4 text-right">Cumulative Capital</th>
                  <th className="py-3 px-4 text-right">Equity Share %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data && data.leaderboard.length > 0 ? (
                  data.leaderboard.map((item) => {
                    let rankBadge = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
                    if (item.rank === 1) rankBadge = "bg-amber-100 text-amber-800 font-bold border border-amber-300";
                    if (item.rank === 2) rankBadge = "bg-slate-200 text-slate-700 font-bold border border-slate-300";
                    if (item.rank === 3) rankBadge = "bg-orange-100 text-orange-800 font-bold border border-orange-300";

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
                          {item.shares.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {formatMoney(item.totalContributed)}
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
                      No contributor data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
