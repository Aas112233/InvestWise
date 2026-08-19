import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, Line,
  ComposedChart, ReferenceLine
} from 'recharts';
import {
  TrendingUp, TrendingDown, Landmark, ArrowUpRight, RefreshCw,
  Layers, Activity, Calendar, ShieldCheck, Award, Users, CheckCircle2,
  PieChart as PieIcon, ChevronRight, BarChart3, LineChart as LineChartIcon
} from 'lucide-react';
import StatCard from './StatCard';
import Avatar from './Avatar';
import { Language, t } from '../i18n/translations';
import { useGlobalState } from '../context/GlobalStateContext';
import { formatCompactNumber, formatCurrency } from '../utils/formatters';
import { analyticsService, goalService } from '../services/api';
import { Goal, AppScreen, AccessLevel } from '../types';
import { checkUserPermission } from '../utils/permissions';
import { useScreenDataRefresh } from '../hooks/useScreenDataRefresh';
import { DashboardSkeleton } from './ui/Skeleton';

interface DashboardProps {
  isDarkMode: boolean;
  lang: Language;
}

type TimeframeFilter = '6M' | '1Y' | '3Y';
type ChartMode = 'cashflow' | 'netdelta' | 'growth' | 'benchmark';
type ProjectChartMode = 'roi' | 'capitalVsYield';

const SECTOR_COLORS = ['#2563EB', '#10B981', '#6366F1', '#F59E0B', '#EC4899', '#8B5CF6'];

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode, lang }) => {
  const { globalStats, refreshAnalytics, members, projects, currencyCode, user } = useGlobalState();
  const navigate = useNavigate();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeFilter>('3Y');
  const [chartMode, setChartMode] = useState<ChartMode>('cashflow');
  const [projectViewMode, setProjectViewMode] = useState<ProjectChartMode>('roi');
  const [isSyncing, setIsSyncing] = useState(false);
  const [visibleSeries, setVisibleSeries] = useState({
    deposit: true,
    inflow: true,
    outflow: true,
  });

  const canRecalculate = useMemo(() => {
    return user?.role === 'Admin' || user?.role === 'Administrator';
  }, [user]);

  const canWriteGoals = useMemo(() => {
    return checkUserPermission(user, AppScreen.GOALS, AccessLevel.WRITE);
  }, [user]);

  const canReadGoals = useMemo(() => {
    return checkUserPermission(user, AppScreen.GOALS, AccessLevel.READ);
  }, [user]);

  const toggleSeries = (key: 'deposit' | 'inflow' | 'outflow') => {
    setVisibleSeries((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Prevent disabling all series simultaneously
      if (!next.deposit && !next.inflow && !next.outflow) {
        return prev;
      }
      return next;
    });
  };

  const loadGoals = useCallback(async () => {
    try {
      const data = await goalService.getAll();
      setGoals(data?.data || data || []);
    } catch (err) {
      console.error('Failed to fetch goals for dashboard:', err);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    await refreshAnalytics();
    await loadGoals();
  }, [refreshAnalytics, loadGoals]);

  useScreenDataRefresh(handleRefresh);

  useEffect(() => {
    loadGoals();
  }, [loadGoals, globalStats]);

  // Sector Diversification Data
  const pieData = useMemo(() => {
    if (!globalStats) return [];
    const data = globalStats.sectorDiversification || [];
    return data.map((entry: any, idx: number) => ({
      name: entry.category,
      value: Number(entry.value) || 0,
      percentage: entry.percentage || 0,
      color: SECTOR_COLORS[idx % SECTOR_COLORS.length],
    }));
  }, [globalStats?.sectorDiversification]);

  const totalAllocatedCapital = useMemo(() => {
    return pieData.reduce((sum: number, item: any) => sum + item.value, 0);
  }, [pieData]);

  // Radar Data (Top Partner Equity & Engagement)
  const radarData = useMemo(() => {
    let partners = globalStats?.topPartners || [];
    let maxShareValue = globalStats?.maxShares || 25;

    if (partners.length === 0 && members.length > 0) {
      partners = [...members]
        .filter((m) => m.status === 'active' && (m.shares || 0) > 0)
        .sort((a, b) => (b.shares || 0) - (a.shares || 0))
        .slice(0, 6)
        .map((m) => ({ name: m.name, shares: m.shares, totalContributed: m.totalContributed }));

      if (partners.length > 0) {
        maxShareValue = partners[0].shares;
      }
    }

    return partners.map((m: any) => ({
      subject: (m.name || '').split(' ')[0],
      fullName: m.name,
      shares: m.shares || 0,
      contributed: m.totalContributed || 0,
      fullMark: maxShareValue,
    }));
  }, [globalStats?.topPartners, globalStats?.maxShares, members]);

  // Project Performance & ROI Matrix
  const performanceData = useMemo(() => {
    let topProjs = globalStats?.topProjects || [];

    if (topProjs.length === 0 && projects.length > 0) {
      topProjs = [...projects]
        .map((p) => ({
          title: p.title,
          category: p.category,
          roi: parseFloat(p.projectedReturn || '0'),
          earnings: p.totalEarnings || 0,
          invested: p.initialInvestment || 0,
          status: p.status,
          health: p.health,
        }))
        .sort((a, b) => b.roi - a.roi)
        .slice(0, 5);
    }

    return topProjs.map((p: any) => ({
      name: (p.title || '').length > 14 ? (p.title || '').substring(0, 14) + '...' : p.title,
      fullName: p.title,
      category: p.category || 'Strategic Asset',
      roi: p.roi || 0,
      earnings: p.earnings || 0,
      invested: p.invested || p.expenses || 0,
      status: p.status || 'In Progress',
      health: p.health || 'Stable',
    }));
  }, [globalStats?.topProjects, projects]);

  // Multi-Horizon Chronological Trend Data
  const rawTrendData = useMemo(() => {
    return (globalStats?.trendData || []).map((item: any) => {
      const dep = parseFloat(item.deposit ?? item.inflow ?? 0);
      const inf = parseFloat(item.inflow || 0);
      const outf = parseFloat(item.outflow || 0);
      const net = parseFloat(item.netProfit ?? (inf - outf) ?? 0);
      return {
        month: item.month,
        deposit: dep,
        inflow: inf,
        outflow: outf,
        netProfit: net,
        cumulativeBalance: parseFloat(item.cumulativeBalance || 0),
      };
    });
  }, [globalStats?.trendData]);

  // Sliced Trend Data according to Timeframe Filter
  const filteredTrendData = useMemo(() => {
    if (rawTrendData.length === 0) return [];
    if (timeframe === '6M') {
      return rawTrendData.slice(-6);
    }
    if (timeframe === '1Y') {
      return rawTrendData.slice(-12);
    }
    return rawTrendData; // 3Y / All
  }, [rawTrendData, timeframe]);

  // Aggregate stats across the selected timeframe horizon
  const horizonStats = useMemo(() => {
    if (filteredTrendData.length === 0) {
      return { totalDeposit: 0, totalInflow: 0, totalOutflow: 0, netMargin: 0 };
    }
    const totalDeposit = filteredTrendData.reduce((sum: number, d: any) => sum + (d.deposit || 0), 0);
    const totalInflow = filteredTrendData.reduce((sum: number, d: any) => sum + (d.inflow || 0), 0);
    const totalOutflow = filteredTrendData.reduce((sum: number, d: any) => sum + (d.outflow || 0), 0);
    const netMargin = totalInflow - totalOutflow;
    return { totalDeposit, totalInflow, totalOutflow, netMargin };
  }, [filteredTrendData]);

  // Calculate Cumulative Trend Curve with dynamic baseline
  const cumulativeTrendData = useMemo(() => {
    let running = 0;
    return filteredTrendData.map((d: any) => {
      running += (d.inflow - d.outflow);
      return {
        ...d,
        cumulativeGrowth: running,
      };
    });
  }, [filteredTrendData]);

  // Target Annualized Benchmark & Realized Yield Curve
  const benchmarkTrendData = useMemo(() => {
    const annualRate = (globalStats?.yieldIndex || 29.8) / 100;
    const monthlyRate = annualRate / 12;
    let runningActual = 0;
    let runningDeposit = 0;

    return filteredTrendData.map((d: any, idx: number) => {
      runningActual += (d.inflow - d.outflow);
      runningDeposit += (d.deposit || d.inflow || 0);
      const targetBenchmark = Math.round(runningDeposit * (monthlyRate * (idx + 1)));
      return {
        ...d,
        actualCumulative: runningActual,
        targetBenchmark,
        targetDelta: runningActual - targetBenchmark,
      };
    });
  }, [filteredTrendData, globalStats?.yieldIndex]);

  // Top Alpha Revenue Months
  const topMonths = useMemo(() => {
    return [...rawTrendData]
      .filter((m) => m.netProfit > 0)
      .sort((a, b) => b.netProfit - a.netProfit)
      .slice(0, 4);
  }, [rawTrendData]);

  const maxMonthProfit = useMemo(() => {
    if (topMonths.length === 0) return 0;
    return topMonths[0].netProfit;
  }, [topMonths]);

  // Goals & Objectives
  const dashboardGoals = useMemo(() => {
    if (goals.length > 0) {
      return goals.slice(0, 3).map((g) => ({
        label: g.title,
        done: g.status === 'Achieved',
      }));
    }
    return [
      { label: t('dashboard.auditShift', lang), done: true },
      { label: t('dashboard.riskAssessment', lang), done: true },
      { label: t('dashboard.poolExpansion', lang), done: false },
    ];
  }, [goals, lang]);

  const benchmarksMetText = useMemo(() => {
    if (goals.length > 0) {
      const met = goals.filter((g) => g.status === 'Achieved').length;
      return `${met.toString().padStart(2, '0')}/${goals.length.toString().padStart(2, '0')}`;
    }
    return '02/03';
  }, [goals]);

  // Core KPI values
  const totalDeposits = globalStats?.totalDeposits || 5900000;
  const investedCapital = globalStats?.investedCapital || 1180000;
  const totalShares = globalStats?.totalShares || 220;
  const memberCount = globalStats?.totalMembers || 19;
  const yieldIndex = `${(globalStats?.yieldIndex || 29.8).toFixed(1)}%`;
  const stability = (globalStats?.fundStability || 100).toFixed(1);

  // Governance Stats
  const governance = globalStats?.governance || {
    totalMeetings: 36,
    attendanceRate: 92.2,
    onTimeDepositRate: 90.9,
    activePenaltiesCount: 13,
  };

  // Top Investor Profile
  let topInvestor = globalStats?.topInvestor || { name: 'Hasan Mahmud', role: 'Principal Partner', shares: 25 };

  if ((!topInvestor.name || topInvestor.name === 'N/A') && members.length > 0) {
    const sorted = [...members].filter((m) => m.status === 'active').sort((a, b) => (b.shares || 0) - (a.shares || 0));
    if (sorted.length > 0) {
      topInvestor = {
        name: sorted[0].name,
        role: sorted[0].role || 'Principal Partner',
        shares: sorted[0].shares,
      };
    }
  }

  // Stat Cards Configuration
  const statCards = useMemo(() => {
    let depositChange = "+12.4%";
    let capitalChange = "+18.5%";

    if (filteredTrendData.length >= 2) {
      const current = filteredTrendData[filteredTrendData.length - 1];
      const prev = filteredTrendData[filteredTrendData.length - 2];
      if (prev.inflow > 0) {
        const diff = ((current.inflow - prev.inflow) / prev.inflow) * 100;
        depositChange = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
      }
      if (prev.outflow > 0) {
        const diff = ((current.outflow - prev.outflow) / prev.outflow) * 100;
        capitalChange = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
      }
    }

    return [
      {
        label: t('dashboard.totalDeposits', lang),
        value: formatCompactNumber(totalDeposits),
        change: depositChange,
        isPositive: true,
        variant: "light" as const,
        currency: currencyCode,
        rawValue: totalDeposits,
      },
      {
        label: t('dashboard.investedCapital', lang),
        value: formatCompactNumber(investedCapital),
        change: capitalChange,
        isPositive: true,
        variant: "light" as const,
        currency: currencyCode,
        rawValue: investedCapital,
      },
      {
        label: t('dashboard.totalMembers', lang),
        value: memberCount.toString(),
        change: "Active Partners",
        isPositive: true,
        variant: "light" as const,
      },
      {
        label: t('dashboard.totalShares', lang),
        value: totalShares.toString(),
        change: "Total Equity",
        isPositive: true,
        variant: "light" as const,
      },
      {
        label: t('dashboard.yieldIndex', lang),
        value: yieldIndex,
        change: "Expected ROI",
        isPositive: true,
        variant: "light" as const,
      },
    ];
  }, [totalDeposits, investedCapital, memberCount, totalShares, yieldIndex, filteredTrendData, lang, currencyCode]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      if (canRecalculate) {
        await analyticsService.recalculate();
      }
      await refreshAnalytics();
      await loadGoals();
    } catch (e) {
      console.error('Failed to sync analytics:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!globalStats || isSyncing) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6 pb-8">
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* Top Header & Intelligence Controls */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-150 dark:border-gray-800">
        <div>
          <nav className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
            <span>INVESTWISE</span>
            <span className="opacity-30">/</span>
            <span className="text-blue-600 dark:text-blue-400">{t('dashboard.intelligence', lang)}</span>
          </nav>
          <div className="mt-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Institutional Intelligence Overview
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Timeframe Horizon Selector */}
          <div className="flex items-center bg-gray-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-gray-200/70 dark:border-gray-700/60 text-[11px] font-semibold">
            {(['6M', '1Y', '3Y'] as TimeframeFilter[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1 rounded-md transition-all ${
                  timeframe === tf
                    ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tf === '3Y' ? '3Y / Max' : tf}
              </button>
            ))}
          </div>

          {/* Sync / Refresh Button */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold shadow-sm transition-all disabled:opacity-60"
            title={canRecalculate ? "Recalculate Ledger & Analytics" : "Refresh Analytics"}
          >
            <RefreshCw size={13} className={isSyncing ? 'animate-spin text-blue-600' : 'text-slate-400'} />
            <span className="hidden sm:inline">{canRecalculate ? "Sync Intelligence" : "Refresh View"}</span>
          </button>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* Primary KPI Metric Row */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {statCards.map((stat, idx) => (
          <StatCard key={idx} {...stat} />
        ))}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* Macro Analytics Tier (Main Chart + Sector Allocation Donut) */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Main Interactive Chart (Cash Flows & Cumulative Treasury Growth) */}
        <div className="xl:col-span-3 bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-blue-600 dark:text-blue-400" />
                <h3 className="font-semibold text-base text-slate-900 dark:text-white leading-tight">
                  {chartMode === 'cashflow' && t('dashboard.cashFlowSpectrum', lang)}
                  {chartMode === 'netdelta' && t('dashboard.netDeltaMode', lang)}
                  {chartMode === 'growth' && t('dashboard.cumulativeGrowth', lang)}
                  {chartMode === 'benchmark' && t('dashboard.benchmarkMode', lang)}
                </h3>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {chartMode === 'cashflow' && `${t('dashboard.cashFlowSub', lang)} across ${timeframe === '3Y' ? '36 Months' : timeframe}`}
                {chartMode === 'netdelta' && `${t('dashboard.netDeltaSub', lang)} across ${timeframe === '3Y' ? '36 Months' : timeframe}`}
                {chartMode === 'growth' && t('dashboard.growthSub', lang)}
                {chartMode === 'benchmark' && `${t('dashboard.benchmarkSub', lang)} across ${timeframe === '3Y' ? '36 Months' : timeframe}`}
              </p>
            </div>

            {/* Mode Switcher */}
            <div className="flex flex-wrap items-center gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg border border-gray-200 dark:border-gray-700 text-[10px] font-semibold">
              <button
                onClick={() => setChartMode('cashflow')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  chartMode === 'cashflow'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('dashboard.capitalTrends', lang)}
              </button>
              <button
                onClick={() => setChartMode('netdelta')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  chartMode === 'netdelta'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('dashboard.netDeltaMode', lang)}
              </button>
              <button
                onClick={() => setChartMode('growth')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  chartMode === 'growth'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('dashboard.growthMode', lang)}
              </button>
              <button
                onClick={() => setChartMode('benchmark')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  chartMode === 'benchmark'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {t('dashboard.benchmarkMode', lang)}
              </button>
            </div>
          </div>

          {/* Quick Horizon Summary Badges */}
          {filteredTrendData.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 p-2.5 bg-slate-50/80 dark:bg-slate-800/40 rounded-lg border border-slate-200/60 dark:border-slate-800">
              <div className="flex flex-col">
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {t('dashboard.depositsStream', lang)}
                </span>
                <span className="text-xs font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">
                  {formatCompactNumber(horizonStats.totalDeposit)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                  {t('dashboard.cashInStream', lang)}
                </span>
                <span className="text-xs font-bold font-mono text-blue-700 dark:text-blue-400 mt-0.5">
                  {formatCompactNumber(horizonStats.totalInflow)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  {t('dashboard.cashOutStream', lang)}
                </span>
                <span className="text-xs font-bold font-mono text-rose-700 dark:text-rose-400 mt-0.5">
                  {formatCompactNumber(horizonStats.totalOutflow)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${horizonStats.netMargin >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  {t('dashboard.netDelta', lang)}
                </span>
                <span className={`text-xs font-bold font-mono mt-0.5 ${horizonStats.netMargin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {horizonStats.netMargin >= 0 ? '+' : ''}{formatCompactNumber(horizonStats.netMargin)}
                </span>
              </div>
            </div>
          )}

          {/* Chart Canvas */}
          <div className="h-[310px] w-full min-w-0" style={{ minHeight: 310, width: '100%' }}>
            {filteredTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={310} debounce={50}>
                {chartMode === 'cashflow' && (
                  <AreaChart data={filteredTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorDeposit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorInflow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563EB" stopOpacity={0.30} />
                        <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorOutflow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#F43F5E" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={isDarkMode ? 0.08 : 0.06} />
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      interval={timeframe === '3Y' ? 3 : 0}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      tickFormatter={(val) => formatCompactNumber(val)}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0]?.payload || {};
                          const depositVal = Number(item.deposit ?? item.inflow ?? 0);
                          const inflowVal = Number(item.inflow || 0);
                          const outflowVal = Number(item.outflow || 0);
                          const netDeltaVal = inflowVal - outflowVal;
                          const monthLabel = item.month;
                          return (
                            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl text-xs min-w-[220px]">
                              <p className="text-[11px] font-bold text-slate-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-1.5 mb-2">
                                {monthLabel}
                              </p>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                    {t('dashboard.depositsStream', lang)}:
                                  </span>
                                  <span className="font-semibold text-slate-900 dark:text-white font-mono">
                                    {formatCurrency(depositVal, true, currencyCode)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                                    {t('dashboard.cashInStream', lang)}:
                                  </span>
                                  <span className="font-semibold text-slate-900 dark:text-white font-mono">
                                    {formatCurrency(inflowVal, true, currencyCode)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                                    {t('dashboard.cashOutStream', lang)}:
                                  </span>
                                  <span className="font-semibold text-slate-900 dark:text-white font-mono">
                                    {formatCurrency(outflowVal, true, currencyCode)}
                                  </span>
                                </div>
                                <div className="pt-1.5 border-t border-gray-150 dark:border-gray-800 flex items-center justify-between gap-4">
                                  <span className="font-medium text-slate-600 dark:text-slate-300">{t('dashboard.netDelta', lang)}:</span>
                                  <span className={`font-bold font-mono px-1.5 py-0.5 rounded text-[11px] ${
                                    netDeltaVal >= 0
                                      ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40'
                                      : 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-950/40'
                                  }`}>
                                    {netDeltaVal >= 0 ? '+' : ''}{formatCurrency(netDeltaVal, true, currencyCode)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    {visibleSeries.deposit && (
                      <Area
                        type="monotone"
                        dataKey="deposit"
                        name={t('dashboard.depositsStream', lang)}
                        stroke="#10B981"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorDeposit)"
                        dot={{ r: timeframe === '3Y' ? 1.5 : 3, fill: '#10B981', strokeWidth: 1.5, stroke: '#fff' }}
                        activeDot={{ r: 5, fill: '#10B981', stroke: '#fff', strokeWidth: 2 }}
                      />
                    )}
                    {visibleSeries.inflow && (
                      <Area
                        type="monotone"
                        dataKey="inflow"
                        name={t('dashboard.cashInStream', lang)}
                        stroke="#2563EB"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorInflow)"
                        dot={{ r: timeframe === '3Y' ? 1.5 : 3, fill: '#2563EB', strokeWidth: 1.5, stroke: '#fff' }}
                        activeDot={{ r: 5, fill: '#2563EB', stroke: '#fff', strokeWidth: 2 }}
                      />
                    )}
                    {visibleSeries.outflow && (
                      <Area
                        type="monotone"
                        dataKey="outflow"
                        name={t('dashboard.cashOutStream', lang)}
                        stroke="#F43F5E"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorOutflow)"
                        dot={{ r: timeframe === '3Y' ? 1 : 2.5, fill: '#F43F5E', strokeWidth: 1.5, stroke: '#fff' }}
                        activeDot={{ r: 5, fill: '#F43F5E', stroke: '#fff', strokeWidth: 2 }}
                      />
                    )}
                  </AreaChart>
                )}

                {chartMode === 'netdelta' && (
                  <BarChart data={filteredTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="netSurplusGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#059669" stopOpacity={0.65} />
                      </linearGradient>
                      <linearGradient id="netDeficitGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#F43F5E" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#E11D48" stopOpacity={0.65} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={isDarkMode ? 0.08 : 0.06} />
                    <ReferenceLine y={0} stroke={isDarkMode ? '#64748B' : '#94A3B8'} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      interval={timeframe === '3Y' ? 3 : 0}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      tickFormatter={(val) => formatCompactNumber(val)}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0]?.payload || {};
                          const netDeltaVal = Number(item.netProfit || 0);
                          const inflowVal = Number(item.inflow || 0);
                          const outflowVal = Number(item.outflow || 0);
                          const monthLabel = item.month;
                          const isSurplus = netDeltaVal >= 0;
                          return (
                            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl text-xs min-w-[210px]">
                              <p className="text-[11px] font-bold text-slate-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-1.5 mb-2 flex items-center justify-between">
                                <span>{monthLabel}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                  isSurplus
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400'
                                }`}>
                                  {isSurplus ? t('dashboard.surplus', lang) : t('dashboard.deficit', lang)}
                                </span>
                              </p>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">{t('dashboard.cashInStream', lang)}:</span>
                                  <span className="font-semibold text-slate-900 dark:text-white font-mono">{formatCurrency(inflowVal, true, currencyCode)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">{t('dashboard.cashOutStream', lang)}:</span>
                                  <span className="font-semibold text-slate-900 dark:text-white font-mono">{formatCurrency(outflowVal, true, currencyCode)}</span>
                                </div>
                                <div className="pt-1.5 border-t border-gray-150 dark:border-gray-800 flex items-center justify-between gap-4">
                                  <span className="font-medium text-slate-700 dark:text-slate-300">{t('dashboard.netDelta', lang)}:</span>
                                  <span className={`font-bold font-mono text-xs ${isSurplus ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {isSurplus ? '+' : ''}{formatCurrency(netDeltaVal, true, currencyCode)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="netProfit" radius={[4, 4, 4, 4]} barSize={timeframe === '3Y' ? 10 : 20}>
                      {filteredTrendData.map((entry: any, index: number) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.netProfit >= 0 ? 'url(#netSurplusGradient)' : 'url(#netDeficitGradient)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                )}

                {chartMode === 'growth' && (
                  <AreaChart data={cumulativeTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorGrowth" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={isDarkMode ? 0.08 : 0.06} />
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      interval={timeframe === '3Y' ? 3 : 0}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      tickFormatter={(val) => formatCompactNumber(val)}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const growth = Number(payload[0]?.value || 0);
                          const monthLabel = payload[0]?.payload?.month;
                          return (
                            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3 rounded-lg border border-gray-200 dark:border-gray-800 shadow-xl text-xs">
                              <p className="text-[10px] font-semibold text-slate-400 mb-1">{monthLabel}</p>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-slate-500">Cumulative Treasury:</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                  {formatCurrency(growth, true, currencyCode)}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cumulativeGrowth"
                      name="Cumulative Growth"
                      stroke="#10B981"
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#colorGrowth)"
                      dot={{ r: 2, fill: '#10B981', strokeWidth: 1.5, stroke: '#fff' }}
                      activeDot={{ r: 5, fill: '#10B981', stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                )}

                {chartMode === 'benchmark' && (
                  <ComposedChart data={benchmarkTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563EB" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={isDarkMode ? 0.08 : 0.06} />
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      interval={timeframe === '3Y' ? 3 : 0}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      tickFormatter={(val) => formatCompactNumber(val)}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0]?.payload || {};
                          const actual = Number(item.actualCumulative || 0);
                          const target = Number(item.targetBenchmark || 0);
                          const delta = actual - target;
                          const monthLabel = item.month;
                          return (
                            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl text-xs min-w-[220px]">
                              <p className="text-[11px] font-bold text-slate-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-1.5 mb-2">
                                {monthLabel} — Yield Benchmark
                              </p>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                                    {t('dashboard.actualRealized', lang)}:
                                  </span>
                                  <span className="font-semibold text-slate-900 dark:text-white font-mono">
                                    {formatCurrency(actual, true, currencyCode)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                                    {t('dashboard.targetBenchmark', lang)}:
                                  </span>
                                  <span className="font-semibold text-slate-900 dark:text-white font-mono">
                                    {formatCurrency(target, true, currencyCode)}
                                  </span>
                                </div>
                                <div className="pt-1.5 border-t border-gray-150 dark:border-gray-800 flex items-center justify-between gap-4">
                                  <span className="font-medium text-slate-600 dark:text-slate-300">Variance / Alpha:</span>
                                  <span className={`font-bold font-mono px-1.5 py-0.5 rounded text-[11px] ${
                                    delta >= 0
                                      ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40'
                                      : 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40'
                                  }`}>
                                    {delta >= 0 ? '+' : ''}{formatCurrency(delta, true, currencyCode)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="actualCumulative"
                      name={t('dashboard.actualRealized', lang)}
                      stroke="#2563EB"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#colorActual)"
                      dot={{ r: 2, fill: '#2563EB', strokeWidth: 1.5, stroke: '#fff' }}
                      activeDot={{ r: 5, fill: '#2563EB', stroke: '#fff', strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="targetBenchmark"
                      name={t('dashboard.targetBenchmark', lang)}
                      stroke="#F59E0B"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={{ r: 2, fill: '#F59E0B', strokeWidth: 1, stroke: '#fff' }}
                      activeDot={{ r: 4, fill: '#F59E0B', stroke: '#fff', strokeWidth: 2 }}
                    />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 font-medium text-xs">
                No Transaction Data Available
              </div>
            )}
          </div>

          {/* Chart Footer Indicator Legend */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3.5 border-t border-gray-100 dark:border-gray-800 text-xs">
            {chartMode === 'cashflow' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => toggleSeries('deposit')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    visibleSeries.deposit
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/70 shadow-2xs'
                      : 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500 opacity-60 border border-transparent line-through'
                  }`}
                  title="Toggle Member Deposits Stream"
                >
                  <span className={`w-2 h-2 rounded-full ${visibleSeries.deposit ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                  <span>{t('dashboard.depositsStream', lang)}</span>
                </button>

                <button
                  onClick={() => toggleSeries('inflow')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    visibleSeries.inflow
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200/70 dark:border-blue-800/70 shadow-2xs'
                      : 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500 opacity-60 border border-transparent line-through'
                  }`}
                  title="Toggle Total Cash In Stream"
                >
                  <span className={`w-2 h-2 rounded-full ${visibleSeries.inflow ? 'bg-blue-600' : 'bg-gray-400'}`} />
                  <span>{t('dashboard.cashInStream', lang)}</span>
                </button>

                <button
                  onClick={() => toggleSeries('outflow')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    visibleSeries.outflow
                      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200/70 dark:border-rose-800/70 shadow-2xs'
                      : 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500 opacity-60 border border-transparent line-through'
                  }`}
                  title="Toggle Total Cash Out Stream"
                >
                  <span className={`w-2 h-2 rounded-full ${visibleSeries.outflow ? 'bg-rose-500' : 'bg-gray-400'}`} />
                  <span>{t('dashboard.cashOutStream', lang)}</span>
                </button>
              </div>
            )}

            {chartMode === 'netdelta' && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                  <span>{t('dashboard.surplus', lang)} (Liquidity Surplus)</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                  <span>{t('dashboard.deficit', lang)} (Capital Deployment)</span>
                </div>
              </div>
            )}

            {chartMode === 'growth' && (
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-slate-600 dark:text-slate-300 font-medium">Cumulative Treasury Growth</span>
              </div>
            )}

            {chartMode === 'benchmark' && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                  <span>{t('dashboard.actualRealized', lang)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="w-3 h-0.5 bg-amber-500 border-b border-dashed" />
                  <span>{t('dashboard.targetBenchmark', lang)} ({yieldIndex})</span>
                </div>
              </div>
            )}

            <span className="text-[11px] font-mono text-slate-400">
              {filteredTrendData.length} Intervals Mapped
            </span>
          </div>
        </div>

        {/* Sector Asset Allocation Donut */}
        <div className="xl:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <PieIcon size={18} className="text-blue-600 dark:text-blue-400" />
                <h3 className="font-semibold text-base text-slate-900 dark:text-white leading-tight">
                  Sector Portfolio Diversification
                </h3>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Capital deployment breakdown by industrial asset class
            </p>
          </div>

          {/* Donut Chart with Center Metric */}
          <div className="h-[230px] relative my-2">
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 text-center">
              <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono leading-none">
                {formatCompactNumber(totalAllocatedCapital)}
              </span>
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-1">{currencyCode}</span>
              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mt-0.5">
                Active Capital
              </span>
            </div>
            <ResponsiveContainer width="100%" height={256} debounce={50}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={68}
                  outerRadius={95}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry: any, index: any) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0]?.payload;
                      const percentage = totalAllocatedCapital > 0
                        ? ((data.value / totalAllocatedCapital) * 100).toFixed(1)
                        : '0.0';
                      return (
                        <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-gray-200 dark:border-gray-800 shadow-lg text-xs">
                          <p className="font-semibold text-slate-900 dark:text-white mb-1.5 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: data.color }} />
                            {data.name}
                          </p>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-slate-500">Allocated:</span>
                              <span className="font-semibold text-slate-900 dark:text-white font-mono">
                                {formatCurrency(data.value, true, currencyCode)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4 pt-1 border-t border-gray-150 dark:border-gray-800">
                              <span className="text-slate-500">Portfolio Share:</span>
                              <span className="font-bold text-blue-600 dark:text-blue-400">{percentage}%</span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Detailed Sector Legend Breakdown */}
          <div className="space-y-1.5 pt-3 border-t border-gray-100 dark:border-gray-800 text-xs">
            {pieData.map((entry: any, index: number) => {
              const pct = totalAllocatedCapital > 0 ? ((entry.value / totalAllocatedCapital) * 100).toFixed(1) : '0';
              return (
                <div key={index} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                    <span className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[140px]">{entry.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-slate-500 text-[11px]">{formatCompactNumber(entry.value)} {currencyCode}</span>
                    <span className="font-bold font-mono text-slate-900 dark:text-white text-[11px] min-w-[38px] text-right">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* Advanced Performance & Strategic Matrix Tier (3 Power Cards) */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Card 1: Project Performance & Yield Comparison */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between h-[410px]">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base text-slate-900 dark:text-white leading-tight">
                Project Yield & Performance
              </h3>
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-0.5 rounded-md text-[9px] font-semibold border border-gray-200/60 dark:border-gray-700">
                <button
                  onClick={() => setProjectViewMode('roi')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    projectViewMode === 'roi'
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t('dashboard.projectRoiMode', lang)}
                </button>
                <button
                  onClick={() => setProjectViewMode('capitalVsYield')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    projectViewMode === 'capitalVsYield'
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t('dashboard.capitalVsEarnings', lang)}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {projectViewMode === 'roi'
                ? 'Projected ROI vs realized profitability by venture'
                : 'Initial deployed capital vs total realized earnings'}
            </p>
          </div>

          <div className="flex-1 w-full min-h-[240px] min-w-0 mt-4" style={{ minHeight: 240, width: '100%' }}>
            {performanceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240} debounce={50}>
                {projectViewMode === 'roi' ? (
                  <BarChart data={performanceData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="perfBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={isDarkMode ? 0.08 : 0.06} />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 9, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 9, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0]?.payload;
                          return (
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-gray-200 dark:border-gray-800 shadow-xl text-xs">
                              <p className="font-semibold text-slate-900 dark:text-white mb-1">{data.fullName}</p>
                              <p className="text-[10px] text-slate-400 mb-2">{data.category}</p>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Expected ROI:</span>
                                  <span className="font-bold text-blue-600 dark:text-blue-400 font-mono">+{data.roi}%</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">Total Yield:</span>
                                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">{formatCompactNumber(data.earnings)} {currencyCode}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4 pt-1 border-t border-gray-150 dark:border-gray-800">
                                  <span className="text-slate-500">Status:</span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">{data.status}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar name="Expected ROI" dataKey="roi" fill="url(#perfBarGradient)" radius={[4, 4, 0, 0]} barSize={22} />
                  </BarChart>
                ) : (
                  <BarChart data={performanceData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                    <defs>
                      <linearGradient id="investedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366F1" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#6366F1" stopOpacity={0.4} />
                      </linearGradient>
                      <linearGradient id="earningsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={isDarkMode ? 0.08 : 0.06} />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 9, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 9, fill: isDarkMode ? '#94A3B8' : '#64748B' }}
                      tickFormatter={(v) => formatCompactNumber(v)}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0]?.payload;
                          return (
                            <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-gray-200 dark:border-gray-800 shadow-xl text-xs">
                              <p className="font-semibold text-slate-900 dark:text-white mb-1">{data.fullName}</p>
                              <p className="text-[10px] text-slate-400 mb-2">{data.category}</p>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">{t('dashboard.investedCapitalBar', lang)}:</span>
                                  <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">{formatCurrency(data.invested || 0, true, currencyCode)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="text-slate-500">{t('dashboard.realizedEarningsBar', lang)}:</span>
                                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(data.earnings, true, currencyCode)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar name={t('dashboard.investedCapitalBar', lang)} dataKey="invested" fill="url(#investedGradient)" radius={[3, 3, 0, 0]} barSize={12} />
                    <Bar name={t('dashboard.realizedEarningsBar', lang)} dataKey="earnings" fill="url(#earningsGradient)" radius={[3, 3, 0, 0]} barSize={12} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 font-medium text-xs">
                No Project Performance Data
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800 text-xs">
            <span className="text-slate-500">Average Portfolio Yield</span>
            <span className="font-bold text-blue-600 dark:text-blue-400 font-mono text-sm">{yieldIndex}</span>
          </div>
        </div>

        {/* Card 2: Partner Equity Spectrum & Governance Radar */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between h-[410px]">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base text-slate-900 dark:text-white leading-tight">
                Partner Equity Spectrum
              </h3>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-400 px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/30">
                Top Stakeholders
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Relative share distribution across key founding partners
            </p>
          </div>

          <div className="flex-1 w-full min-h-[240px] min-w-0 mt-2" style={{ minHeight: 240, width: '100%' }}>
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240} debounce={50}>
                <RadarChart cx="50%" cy="50%" outerRadius="68%" data={radarData}>
                  <defs>
                    <linearGradient id="radarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0.08} />
                    </linearGradient>
                  </defs>
                  <PolarGrid stroke={isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"} />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fontSize: 9, fill: isDarkMode ? 'rgba(255,255,255,0.6)' : '#64748B' }}
                  />
                  <Radar
                    name="Shares"
                    dataKey="shares"
                    stroke="#6366F1"
                    fill="url(#radarFill)"
                    fillOpacity={1}
                    strokeWidth={2}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0]?.payload;
                        return (
                          <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-gray-200 dark:border-gray-800 shadow-xl text-xs">
                            <p className="text-[10px] font-semibold text-slate-400 mb-0.5">Partner</p>
                            <p className="font-bold text-slate-900 dark:text-white mb-2">{data.fullName}</p>
                            <div className="space-y-1 pt-1.5 border-t border-gray-150 dark:border-gray-800">
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-slate-500">Active Shares:</span>
                                <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">{data.shares} Shares</span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-slate-500">Total Savings:</span>
                                <span className="font-semibold text-slate-900 dark:text-white font-mono">{formatCompactNumber(data.contributed)} {currencyCode}</span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 font-medium text-xs">
                No Partner Data
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800 text-xs">
            <span className="text-slate-500">Principal Stakeholder</span>
            <span className="font-bold text-indigo-600 dark:text-indigo-400">{topInvestor.name} ({topInvestor.shares} Shares)</span>
          </div>
        </div>

        {/* Card 3: Top Alpha Net-Profit Months */}
        <div className="bg-slate-900 text-white p-6 rounded-xl border border-slate-800 shadow-sm flex flex-col justify-between h-[410px]">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                Alpha Yield Peaks
              </span>
              <span className="text-[10px] font-mono text-slate-400">3-Year Highs</span>
            </div>
            <h3 className="text-lg font-bold leading-tight">
              Top Yield Realization Months
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Periods with highest net profit margins & project payouts
            </p>
          </div>

          <div className="flex-1 flex flex-col justify-end space-y-3.5 my-2">
            {topMonths.length > 0 ? (
              topMonths.map((item, idx) => {
                const ratio = maxMonthProfit > 0 ? (item.netProfit / maxMonthProfit) * 100 : 0;
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-emerald-400 font-bold text-[11px]">0{idx + 1}</span>
                        <span className="font-medium text-white">{item.month}</span>
                      </div>
                      <span className="font-mono text-emerald-400 font-bold text-xs">
                        +{formatCompactNumber(item.netProfit)} {currencyCode}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(8, ratio)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-6 text-slate-500 text-xs">
                No Peak Yield Data Available
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">All-Time Peak Net Margin</p>
              <p className="text-xl font-bold text-emerald-400 font-mono tracking-tight mt-0.5">
                +{formatCompactNumber(maxMonthProfit)} <span className="text-xs font-normal opacity-60">{currencyCode}</span>
              </p>
            </div>
            <Award size={22} className="text-emerald-400 opacity-80" />
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* Strategic Governance & Institutional Health Tier (Bottom Row) */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Governance & Assembly Compliance Hub */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
              Governance & Solvency Health
            </h3>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 px-2 py-0.5 rounded">
              {stability}% Solvency
            </span>
          </div>

          <div className="space-y-3.5 my-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 dark:text-slate-400">Assembly Attendance Rate</span>
                <span className="font-bold text-slate-900 dark:text-white font-mono">{governance.attendanceRate}%</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: `${governance.attendanceRate}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 dark:text-slate-400">On-Time Deposit Compliance</span>
                <span className="font-bold text-slate-900 dark:text-white font-mono">{governance.onTimeDepositRate}%</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${governance.onTimeDepositRate}%` }} />
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-gray-800 text-xs">
            <div className="flex items-center gap-1.5 text-slate-500">
              <Calendar size={13} />
              <span>{governance.totalMeetings} Monthly Assemblies</span>
            </div>
            <button
              onClick={() => navigate('/meetings')}
              className="text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-1 text-[11px]"
            >
              View Governance
              <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {/* Goals & Strategic Objectives */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Strategic Milestones
            </h3>
            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-900/30">
              {benchmarksMetText} Met
            </span>
          </div>

          <div className="space-y-3 flex-1 flex flex-col justify-center">
            {dashboardGoals.map((goal, i) => (
              <div
                key={i}
                className="flex items-center gap-3 cursor-pointer group/goal"
                onClick={() => navigate('/goals')}
              >
                {goal.done ? (
                  <div className="bg-blue-600 text-white rounded p-1 shadow-xs shrink-0">
                    <CheckCircle2 size={14} />
                  </div>
                ) : (
                  <div className="border-2 border-gray-200 dark:border-gray-700 rounded p-1 shrink-0 group-hover/goal:border-blue-500">
                    <div className="w-3.5 h-3.5" />
                  </div>
                )}
                <span
                  className={`text-xs font-semibold truncate ${
                    goal.done
                      ? 'text-slate-400 dark:text-slate-500 line-through opacity-70'
                      : 'text-slate-700 dark:text-slate-300 group-hover/goal:text-blue-600'
                  }`}
                >
                  {goal.label}
                </span>
              </div>
            ))}
          </div>

          {canReadGoals && (
            <button
              onClick={() => navigate('/goals')}
              className="w-full mt-4 py-2 border border-dashed border-gray-300 dark:border-gray-700 hover:border-blue-500 hover:text-blue-600 rounded-lg text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>{canWriteGoals ? 'Configure Goals' : 'View All Goals'}</span>
              <ArrowUpRight size={12} />
            </button>
          )}
        </div>

        {/* Principal Partner Profile Card */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-6 rounded-xl border border-blue-700 shadow-sm flex flex-col justify-between relative overflow-hidden group">
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold opacity-80 uppercase tracking-wider">
                Principal Shareholder
              </p>
              <span className="text-[10px] font-mono bg-white/20 px-2 py-0.5 rounded-full font-semibold">
                Tier 1 Founding
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Avatar name={topInvestor.name} size="md" />
              <div>
                <h4 className="font-bold text-base leading-tight">{topInvestor.name}</h4>
                <p className="text-[11px] opacity-80 mt-0.5">{topInvestor.role}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-white/20 pt-4 mt-4 text-center">
            <div>
              <p className="text-lg font-bold font-mono leading-none mb-1">
                {formatCompactNumber(totalDeposits)} <span className="text-[10px] font-normal opacity-80">{currencyCode}</span>
              </p>
              <p className="text-[9px] opacity-80 uppercase tracking-wider">Total Managed Pool</p>
            </div>
            <div>
              <p className="text-lg font-bold font-mono leading-none mb-1">
                {topInvestor.shares || 25} Shares
              </p>
              <p className="text-[9px] opacity-80 uppercase tracking-wider">Equity Allocation</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
