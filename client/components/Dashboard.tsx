import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Radar, RadarChart, PolarGrid, PolarAngleAxis
} from 'recharts';
import { TrendingUp, Landmark, ArrowUpRight, RefreshCw } from 'lucide-react';
import StatCard from './StatCard';
import Avatar from './Avatar';
import { Language, t } from '../i18n/translations';
import { useGlobalState } from '../context/GlobalStateContext';
import { formatCompactNumber } from '../utils/formatters';
import { analyticsService, goalService } from '../services/api';
import { Goal } from '../types';
import { useScreenDataRefresh } from '../hooks/useScreenDataRefresh';
import { localizeMonthLabel } from '../utils/months';

interface DashboardProps {
  isDarkMode: boolean;
  lang: Language;
}

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode, lang }) => {
  const { globalStats, refreshAnalytics, members, projects, currencyCode } = useGlobalState();
  const navigate = useNavigate();
  const [goals, setGoals] = useState<Goal[]>([]);

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

  const pieData = useMemo(() => {
    if (!globalStats) return [];
    const data = globalStats.sectorDiversification || [];
    const colors = ['#2563EB', '#10B981', '#6366F1', '#F59E0B', '#EC4899'];
    return data.map((entry: any, idx: number) => ({
      name: entry.category,
      value: entry.value,
      color: colors[idx % colors.length]
    }));
  }, [globalStats?.sectorDiversification]);

  const radarData = useMemo(() => {
    let partners = globalStats?.topPartners || [];
    let maxShareValue = globalStats?.maxShares || 100;

    if (partners.length === 0 && members.length > 0) {
      partners = [...members]
        .filter(m => m.status === 'active' && (m.shares || 0) > 0)
        .sort((a, b) => (b.shares || 0) - (a.shares || 0))
        .slice(0, 6)
        .map(m => ({ name: m.name, shares: m.shares }));

      if (partners.length > 0) {
        maxShareValue = partners[0].shares;
      }
    }

    return partners.map((m: any) => ({
      subject: (m.name || '').split(' ')[0],
      A: m.shares || 0,
      fullMark: maxShareValue
    }));
  }, [globalStats?.topPartners, globalStats?.maxShares, members]);

  const performanceData = useMemo(() => {
    let topProjs = globalStats?.topProjects || [];

    if (topProjs.length === 0 && projects.length > 0) {
      topProjs = [...projects]
        .map(p => ({
          title: p.title,
          roi: parseFloat(p.projectedReturn || '0')
        }))
        .sort((a, b) => b.roi - a.roi)
        .slice(0, 4);
    }

    return topProjs.map((p: any) => ({
      name: (p.title || '').substring(0, 8) + '..',
      fullName: p.title,
      performance: p.roi || 0,
      risk: 100 - (p.roi || 0) / 2
    }));
  }, [globalStats?.topProjects, projects]);

  const rawTrendData = globalStats?.trendData || [];
  const trendData = rawTrendData.map((item: any) => ({
    name: localizeMonthLabel(item.month || item.name || 'N/A', lang, true),
    inflow: parseFloat(item.inflow || 0),
    outflow: parseFloat(item.outflow || 0)
  }));

  const topMonths = useMemo(() => {
    return [...trendData]
      .sort((a, b) => ((b.inflow || 0) - (b.outflow || 0)) - ((a.inflow || 0) - (a.outflow || 0)))
      .slice(0, 5);
  }, [trendData]);

  const dashboardGoals = useMemo(() => {
    if (goals.length > 0) {
      return goals.slice(0, 3).map(g => ({
        label: g.title,
        done: g.status === 'Achieved'
      }));
    }
    return [
      { label: t('dashboard.auditShift', lang), done: true },
      { label: t('dashboard.riskAssessment', lang), done: false },
      { label: t('dashboard.poolExpansion', lang), done: false }
    ];
  }, [goals, lang]);

  const benchmarksMetText = useMemo(() => {
    if (goals.length > 0) {
      const met = goals.filter(g => g.status === 'Achieved').length;
      return `${met.toString().padStart(2, '0')}/${goals.length.toString().padStart(2, '0')}`;
    }
    return '08/12';
  }, [goals]);

  const totalDeposits = globalStats?.totalDeposits || 0;
  const investedCapital = globalStats?.investedCapital || 0;
  const totalShares = globalStats?.totalShares || 0;
  const memberCount = globalStats?.totalMembers || 0;
  const yieldIndex = `${(globalStats?.yieldIndex || 0).toFixed(1)}%`;

  let topInvestor = globalStats?.topInvestor || { name: 'N/A', role: 'N/A' };

  if (topInvestor.name === 'N/A' && members.length > 0) {
    const activeMembersWithShares = members
      .filter(m => m.status === 'active' && (m.shares || 0) > 0)
      .sort((a, b) => (b.shares || 0) - (a.shares || 0));

    if (activeMembersWithShares.length > 0) {
      const topMember = activeMembersWithShares[0];
      topInvestor = {
        name: topMember.name,
        role: topMember.role || 'Principal Partner'
      };
    }
  }

  const statCards = useMemo(() => {
    let depositChange = "0%";
    let capitalChange = "0%";

    if (trendData.length >= 2) {
      const currentMonth = trendData[trendData.length - 1];
      const prevMonth = trendData[trendData.length - 2];

      if (prevMonth.inflow > 0) {
        const diff = ((currentMonth.inflow - prevMonth.inflow) / prevMonth.inflow) * 100;
        depositChange = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
      } else if (currentMonth.inflow > 0) {
        depositChange = "+100%";
      }

      if (prevMonth.outflow > 0) {
        const diff = ((currentMonth.outflow - prevMonth.outflow) / prevMonth.outflow) * 100;
        capitalChange = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
      } else if (currentMonth.outflow > 0) {
        capitalChange = "+100%";
      }
    }

    return [
      {
        label: t('dashboard.totalDeposits', lang),
        value: formatCompactNumber(totalDeposits),
        change: depositChange,
        variant: "light" as const,
        currency: currencyCode,
        rawValue: totalDeposits
      },
      {
        label: t('dashboard.investedCapital', lang),
        value: formatCompactNumber(investedCapital),
        change: capitalChange,
        variant: "light" as const,
        currency: currencyCode,
        rawValue: investedCapital
      },
      {
        label: t('dashboard.totalMembers', lang),
        value: memberCount.toString(),
        change: "0",
        variant: "light" as const
      },
      {
        label: t('dashboard.totalShares', lang),
        value: totalShares.toString(),
        change: "0",
        variant: "light" as const
      },
      {
        label: t('dashboard.yieldIndex', lang),
        value: yieldIndex,
        change: "0%",
        variant: "light" as const
      }
    ];
  }, [totalDeposits, investedCapital, memberCount, totalShares, yieldIndex, trendData, lang]);

  if (!globalStats) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Synchronizing System Data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <nav className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
            <span>INVESTWISE</span>
            <span className="opacity-30">/</span>
            <span className="text-blue-600 dark:text-blue-400">{t('dashboard.intelligence', lang)}</span>
          </nav>
        </div>
        <button
          onClick={async () => {
            const btn = document.getElementById('sync-btn');
            if (btn) btn.classList.add('animate-spin');
            try {
              await analyticsService.recalculate();
              await refreshAnalytics();
              await loadGoals();
            } catch (e) { console.error(e); }
            if (btn) btn.classList.remove('animate-spin');
          }}
          className="p-1.5 bg-white dark:bg-slate-800 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
          title="Sync Intelligence"
        >
          <RefreshCw id="sync-btn" size={14} className="text-gray-400" />
        </button>
      </div>

      {/* Primary KPI Metric Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {statCards.map((stat, idx) => (
          <StatCard key={idx} {...stat} />
        ))}
      </div>

      {/* Core Analytics Suite */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-3 bg-white dark:bg-slate-900 p-6 rounded border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-8">
            <div>
              <h3 className="font-semibold text-base text-slate-900 dark:text-white leading-tight">
                {t('dashboard.capitalTrends', lang)}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('dashboard.trendDesc', lang)}
              </p>
            </div>
            <div className="flex gap-4 bg-gray-50 dark:bg-slate-800 p-2 rounded border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-350">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
                <span>{t('dashboard.earnings', lang)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-350">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-500"></div>
                <span>{t('dashboard.outflow', lang)}</span>
              </div>
            </div>
          </div>
          <div className="h-[320px] w-full">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorInflow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563EB" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorOutflow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#64748B' }}
                  />
                  <YAxis hide />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const inflow = payload[0]?.value || 0;
                        const outflow = payload[1]?.value || 0;
                        const netProfit = inflow - outflow;
                        return (
                          <div className="bg-white dark:bg-slate-900 p-3 rounded border border-gray-200 dark:border-gray-800 shadow-md">
                            <p className="text-[10px] font-semibold text-slate-400 mb-2">{payload[0]?.payload?.name}</p>
                            <div className="space-y-1.5 text-xs">
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-slate-500">Inflow:</span>
                                <span className="font-semibold text-slate-900 dark:text-white">{formatCompactNumber(inflow)} {currencyCode}</span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-slate-500">Outflow:</span>
                                <span className="font-semibold text-slate-900 dark:text-white">{formatCompactNumber(outflow)} {currencyCode}</span>
                              </div>
                              <div className="pt-1.5 border-t border-gray-150 dark:border-gray-800 flex items-center justify-between gap-4">
                                <span className="text-slate-500">Net Profit:</span>
                                <span className={`font-semibold ${netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {netProfit >= 0 ? '+' : '-'}{formatCompactNumber(Math.abs(netProfit))} {currencyCode}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area type="monotone" dataKey="inflow" stroke="#2563EB" strokeWidth={2} fillOpacity={1} fill="url(#colorInflow)" dot={{ r: 3, fill: '#2563EB', strokeWidth: 1.5, stroke: '#fff' }} />
                  <Area type="monotone" dataKey="outflow" stroke="#6366F1" strokeWidth={2} fillOpacity={1} fill="url(#colorOutflow)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 font-medium text-xs">
                {t('transactions.noTransactions', lang)}
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-2 bg-white dark:bg-slate-900 p-6 rounded border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between">
          <div className="mb-6">
            <h3 className="font-semibold text-base text-slate-900 dark:text-white leading-tight">
              {t('dashboard.diversification', lang)}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('dashboard.sectorPortfolio', lang)}
            </p>
          </div>
          <div className="h-[280px] relative">
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 text-center">
              <span className="text-2xl font-semibold text-slate-900 dark:text-white font-mono leading-none">
                {formatCompactNumber(pieData.reduce((sum: number, item: any) => sum + item.value, 0))}
              </span>
              <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mt-1">{currencyCode}</span>
              <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mt-0.5">{t('dashboard.allocated', lang)}</span>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry: any, index: any) => (
                    <Cell key={`cell-${index}`} fill={entry.color} className="cursor-pointer" />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0]?.payload;
                      const total = pieData.reduce((sum: number, item: any) => sum + item.value, 0);
                      const percentage = total > 0 ? ((data.value / total) * 100).toFixed(1) : '0.0';
                      return (
                        <div className="bg-white dark:bg-slate-900 p-3 rounded border border-gray-200 dark:border-gray-800 shadow-md">
                          <p className="text-[10px] font-semibold text-slate-400 mb-2">{data.name}</p>
                          <div className="space-y-1 text-xs">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-slate-500">Amount:</span>
                              <span className="font-semibold text-slate-900 dark:text-white">{formatCompactNumber(data.value)} {currencyCode}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 pt-1 border-t border-gray-150 dark:border-gray-800">
                              <span className="text-slate-500">Share:</span>
                              <span className="font-semibold text-blue-600 dark:text-blue-400">{percentage}%</span>
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
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 pt-2 border-t border-gray-100 dark:border-gray-800 text-[10px] font-medium text-slate-500">
            {pieData.map((entry: any, index: number) => (
              <div key={index} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                <span className="truncate max-w-[100px]">{entry.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced Chart Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded border border-gray-200 dark:border-gray-800 shadow-sm h-[400px] flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-base text-slate-900 dark:text-white leading-tight">
              {t('dashboard.partnerSpectrum', lang)}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('dashboard.partnerBenchmark', lang)}
            </p>
          </div>
          <div className="flex-1 w-full min-h-[240px] mt-4">
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                  <defs>
                    <linearGradient id="radarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563EB" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#2563EB" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <PolarGrid stroke={isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)"} />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fontSize: 9, fill: isDarkMode ? 'rgba(255,255,255,0.5)' : '#64748B' }}
                  />
                  <Radar
                    name={t('dashboard.engagement', lang)}
                    dataKey="A"
                    stroke="#2563EB"
                    fill="url(#radarFill)"
                    fillOpacity={1}
                    strokeWidth={2}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0]?.payload;
                        return (
                          <div className="bg-white dark:bg-slate-900 p-3 rounded border border-gray-200 dark:border-gray-800 shadow-md text-xs">
                            <p className="text-[10px] font-semibold text-slate-400 mb-1">Partner</p>
                            <p className="font-semibold text-slate-950 dark:text-white mb-1.5">{data.subject}</p>
                            <div className="flex items-center justify-between gap-4 pt-1.5 border-t border-gray-150 dark:border-gray-800">
                              <span className="text-slate-500">Shares:</span>
                              <span className="font-semibold text-blue-600 dark:text-blue-400">{formatCompactNumber(data.A)}</span>
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
                {t('members.noMembers', lang) || "No Member Data"}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded border border-gray-200 dark:border-gray-800 shadow-sm h-[400px] flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-base text-slate-900 dark:text-white leading-tight">
              {t('dashboard.efficiencyMatrix', lang)}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('dashboard.efficiencyDesc', lang)}
            </p>
          </div>
          <div className="flex-1 w-full min-h-[240px] mt-4">
            {performanceData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="perfBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#2563EB" stopOpacity={0.4} />
                    </linearGradient>
                    <linearGradient id="riskBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366F1" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#6366F1" stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 9, fill: '#64748B' }}
                  />
                  <Tooltip
                    cursor={{ fill: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.01)' }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0]?.payload;
                        return (
                          <div className="bg-white dark:bg-slate-900 p-3 rounded border border-gray-200 dark:border-gray-800 shadow-md text-xs">
                            <p className="text-[10px] font-semibold text-slate-400 mb-1">Project</p>
                            <p className="font-semibold text-slate-950 dark:text-white mb-2">{data.fullName}</p>
                            <div className="space-y-1">
                              {payload.map((entry: any, index: number) => (
                                <div key={index} className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-1.5 text-slate-500">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                                    <span>{entry.name}:</span>
                                  </div>
                                  <span className="font-semibold text-slate-900 dark:text-white">
                                    {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar name={t('dashboard.performance', lang)} dataKey="performance" fill="url(#perfBarGradient)" radius={[2, 2, 0, 0]} barSize={12} />
                  <Bar name={t('dashboard.risk', lang)} dataKey="risk" fill="url(#riskBarGradient)" radius={[2, 2, 0, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 font-medium text-xs">
                {t('projects.noProjects', lang) || "No Performance Data"}
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 text-white p-6 rounded border border-slate-800 flex flex-col justify-between h-[400px]">
          <div>
            <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1">{t('dashboard.peaks', lang)}</p>
            <h3 className="text-xl font-semibold leading-tight">
              {t('dashboard.alphaMonths', lang)}
            </h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              {t('dashboard.alphaDesc', lang)}
            </p>
          </div>

          <div className="flex-1 flex flex-col justify-end mt-4 space-y-3">
            {topMonths.length > 0 ? (
              topMonths.slice(0, 3).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-slate-500">0{idx + 1}</span>
                    <div className="flex flex-col">
                      <span className="font-medium text-white">{item.month}</span>
                      <span className="text-[9px] text-slate-400">
                        {((item.inflow - item.outflow) > 0 ? '+' : '') + formatCompactNumber(item.inflow - item.outflow)} Net
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-1 max-w-[120px]">
                    <div className="h-2 bg-slate-800 rounded flex-1 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded"
                        style={{ width: `${Math.max(5, ((item.inflow - item.outflow) / (Math.max(...topMonths.map(m => (m.inflow - m.outflow) || 0)) || 1)) * 100)}%` }}
                      ></div>
                    </div>
                    <span className="font-mono text-slate-400 text-[10px] min-w-[35px] text-right">
                      {formatCompactNumber(item.inflow - item.outflow)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-slate-500 text-xs">
                No Peak Data
              </div>
            )}

            <div className="pt-3 mt-3 border-t border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Max Profit Month</p>
                <p className="text-2xl font-semibold text-blue-400 font-mono tracking-tight">
                  {formatCompactNumber(Math.max(...topMonths.map(m => (m.inflow - m.outflow) || 0)) || 0)} <span className="text-xs font-normal opacity-50">{currencyCode}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Strategic Summary Bottom Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between">
          <h3 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
            {t('dashboard.equityHealth', lang)}
          </h3>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded bg-gray-50 dark:bg-slate-800 flex items-center justify-center border border-gray-150 dark:border-gray-700 shadow-inner shrink-0">
              <Landmark size={24} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-[10px] text-slate-400 mb-0.5">{t('dashboard.healthVerified', lang)}</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{t('dashboard.optimalReserves', lang)}</p>
            </div>
          </div>
          {/* Dynamic Stability Bars */}
          <div className="flex gap-2.5 mb-4">
            {(() => {
              const percentage = globalStats?.fundStability || 0;
              const bars = [0, 0, 0, 0, 0].map((_, i) => {
                const barStart = i * 20;
                return Math.max(0, Math.min(20, percentage - barStart)) / 20;
              });
              return bars.map((v, i) => (
                <div key={i} className="h-2 flex-1 rounded bg-gray-100 dark:bg-slate-800 overflow-hidden border border-gray-200/50 dark:border-gray-700/50">
                  <div className="h-full bg-blue-600" style={{ width: `${v * 100}%` }} />
                </div>
              ));
            })()}
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{t('dashboard.stability', lang)}</p>
            <p className="text-3xl font-semibold text-slate-900 dark:text-white font-mono leading-none">
              {(globalStats?.fundStability || 0).toFixed(1)}%
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('dashboard.benchmarks', lang)}
            </h3>
            <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-900/30">
              {benchmarksMetText} {t('dashboard.met', lang)}
            </span>
          </div>
          <div className="space-y-3 flex-1 flex flex-col justify-center">
            {dashboardGoals.map((goal, i) => (
              <div key={i} className="flex items-center gap-3 cursor-pointer group/goal" onClick={() => navigate('/goals')}>
                {goal.done ? (
                  <div className="bg-blue-600 text-white rounded p-1 shadow-sm shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <div className="border-2 border-gray-200 dark:border-gray-700 rounded p-1 shrink-0 group-hover/goal:border-blue-500">
                    <div className="w-3.5 h-3.5"></div>
                  </div>
                )}
                <span className={`text-xs font-semibold truncate ${goal.done ? 'text-slate-450 dark:text-slate-500 line-through opacity-50' : 'text-slate-600 dark:text-slate-400 group-hover/goal:text-blue-600'}`}>
                  {goal.label}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/goals')}
            className="w-full mt-4 py-2 border border-dashed border-gray-300 dark:border-gray-700 hover:border-blue-500 hover:text-blue-600 rounded text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
          >
            <span>{t('dashboard.newObjective', lang)}</span>
            <ArrowUpRight size={12} />
          </button>
        </div>

        <div className="bg-blue-600 text-white p-6 rounded border border-blue-700 shadow-sm flex flex-col justify-between relative overflow-hidden group">
          <div>
            <p className="text-[10px] font-semibold opacity-75 uppercase tracking-wider mb-4">{t('dashboard.executiveLead', lang)}</p>
            <div className="flex items-center gap-4">
              <Avatar name={topInvestor.name} size="md" />
              <div>
                <h4 className="font-semibold text-sm leading-tight">{topInvestor.name}</h4>
                <p className="text-[10px] opacity-75 uppercase tracking-wider mt-1">{topInvestor.role}</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-white/20 pt-4 mt-4 text-center">
            <div>
              <p className="text-lg font-semibold font-mono leading-none mb-1">
                {currencyCode} {formatCompactNumber(totalDeposits)}
              </p>
              <p className="text-[9px] opacity-75 uppercase tracking-wider">{t('dashboard.managedAssets', lang)}</p>
            </div>
            <div>
              <p className="text-lg font-semibold font-mono leading-none mb-1">
                {totalShares}
              </p>
              <p className="text-[9px] opacity-75 uppercase tracking-wider">{t('dashboard.trust', lang)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
