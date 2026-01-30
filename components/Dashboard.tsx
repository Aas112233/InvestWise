
import React, { useMemo } from 'react';
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
import { analyticsService } from '../services/api';

interface DashboardProps {
  isDarkMode: boolean;
  lang: Language;
}

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode, lang }) => {
  const { globalStats, refreshAnalytics, members, projects } = useGlobalState();

  // Process Portfolio Data from server
  const pieData = useMemo(() => {
    if (!globalStats) return [];
    const data = globalStats.sectorDiversification || [];
    const colors = ['#151D18', '#10B981', '#6366F1', '#F59E0B', '#EC4899'];
    return data.map((entry: any, idx: number) => ({
      name: entry.category,
      value: entry.value,
      color: colors[idx % colors.length]
    }));
  }, [globalStats?.sectorDiversification]);

  // Radar Data
  const radarData = useMemo(() => {
    let partners = globalStats?.topPartners || [];
    let maxShareValue = globalStats?.maxShares || 100;

    // Fallback: Calculate from members if global stats are empty but members exist
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

  // Performance Data
  const performanceData = useMemo(() => {
    let topProjs = globalStats?.topProjects || [];

    // Fallback: Calculate from projects if global stats are empty but projects exist
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

  // Process Trend Data (Last 6 Months) from server
  const rawTrendData = globalStats?.trendData || [];
  const trendData = rawTrendData.map((item: any) => ({
    name: item.month || item.name || 'N/A',
    inflow: parseFloat(item.inflow || 0),
    outflow: parseFloat(item.outflow || 0)
  }));

  // Process Top Months by Highest Net Profit
  const topMonths = useMemo(() => {
    return [...trendData]
      .sort((a, b) => ((b.inflow || 0) - (b.outflow || 0)) - ((a.inflow || 0) - (a.outflow || 0)))
      .slice(0, 5);
  }, [trendData]);

  // If stats haven't loaded yet, show a loader or empty state


  // Basic Metrics from server-side aggregation
  const totalDeposits = globalStats?.totalDeposits || 0;
  const investedCapital = globalStats?.investedCapital || 0;
  const totalShares = globalStats?.totalShares || 0;
  const memberCount = globalStats?.totalMembers || 0;
  const yieldIndex = `${(globalStats?.yieldIndex || 0).toFixed(1)}%`;

  const topInvestor = globalStats?.topInvestor || { name: 'N/A', role: 'N/A' };

  // Calculate Real-time Statistics
  const statCards = useMemo(() => {
    let depositChange = "0%";
    let capitalChange = "0%";

    if (trendData.length >= 2) {
      const currentMonth = trendData[trendData.length - 1];
      const prevMonth = trendData[trendData.length - 2];

      // Deposit Trend (Inflow)
      if (prevMonth.inflow > 0) {
        const diff = ((currentMonth.inflow - prevMonth.inflow) / prevMonth.inflow) * 100;
        depositChange = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
      } else if (currentMonth.inflow > 0) {
        depositChange = "+100%";
      }

      // Capital Trend (Outflow)
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
        value: `BDT ${formatCompactNumber(totalDeposits)}`,
        change: depositChange,
        variant: "brand" as const
      },
      {
        label: t('dashboard.investedCapital', lang),
        value: `BDT ${formatCompactNumber(investedCapital)}`,
        change: capitalChange,
        variant: "dark" as const
      },
      {
        label: t('dashboard.totalMembers', lang),
        value: memberCount.toString(),
        change: "0", // No historical data for members yet
        variant: "light" as const
      },
      {
        label: t('dashboard.totalShares', lang),
        value: totalShares.toString(),
        change: "0", // No historical data for shares yet
        variant: "light" as const
      },
      {
        label: t('dashboard.yieldIndex', lang),
        value: yieldIndex,
        change: "0%", // Yield variability not tracked yet
        variant: "light" as const
      }
    ];
  }, [totalDeposits, investedCapital, memberCount, totalShares, yieldIndex, trendData, lang]);

  // If stats haven't loaded yet, show a loader or empty state
  if (!globalStats) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-6">
          <TrendingUp className="animate-pulse text-brand" size={60} />
          <p className="text-sm font-black text-gray-400 uppercase tracking-[0.5em]">Synchronizing Intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen pb-20">
      {/* Background Layer */}
      <div className="mesh-bg opacity-40" />

      <div className="relative z-10 space-y-12 animate-in fade-in duration-700">
        {/* Header Section */}
        <div className="flex items-end justify-between px-2">
          <div>
            <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
              <span>INVESTWISE</span>
              <span className="opacity-30">/</span>
              <span className="text-brand">{t('dashboard.intelligence', lang)}</span>
            </nav>
          </div>
          <button
            onClick={async () => {
              const btn = document.getElementById('sync-btn');
              if (btn) btn.classList.add('animate-spin');
              try {
                await analyticsService.recalculate();
                await refreshAnalytics();
              } catch (e) { console.error(e); }
              if (btn) btn.classList.remove('animate-spin');
            }}
            className="p-2 bg-white/50 dark:bg-white/5 rounded-full hover:bg-white dark:hover:bg-white/10 transition-colors"
            title="Sync Intelligence"
          >
            <RefreshCw id="sync-btn" size={14} className="text-gray-400 dark:text-gray-500" />
          </button>
        </div>

        {/* Primary High-Impact Metric Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
          {statCards.map((stat, idx) => (
            <div key={idx} className="animate-stagger opacity-0" style={{ animationDelay: `${idx * 100}ms` }}>
              <StatCard {...stat} />
            </div>
          ))}
        </div>

        {/* Core Analytics Suite */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
          <div className="xl:col-span-3 glass p-12 rounded-[5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.08)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] border border-gray-100 dark:border-white/5 transition-all hover:shadow-2xl animate-stagger opacity-0" style={{ animationDelay: '500ms' }}>
            <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-16">
              <div>
                <h3 className="font-black text-4xl text-dark dark:text-white uppercase tracking-tighter drop-shadow-sm">
                  {t('dashboard.capitalTrends', lang)}
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-[0.4em] mt-3">
                  {t('dashboard.trendDesc', lang)}
                </p>
              </div>
              <div className="flex gap-8 bg-gray-50 dark:bg-white/5 p-5 rounded-[2.5rem] shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-brand shadow-[0_0_15px_rgba(191,243,0,0.5)]"></div>
                  <span className="text-[11px] font-black uppercase tracking-widest dark:text-gray-400">{t('dashboard.earnings', lang)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)]"></div>
                  <span className="text-[11px] font-black uppercase tracking-widest dark:text-gray-400">{t('dashboard.outflow', lang)}</span>
                </div>
              </div>
            </div>
            <div className="h-[480px] w-full">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorInflow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isDarkMode ? "#BFF300" : "#151D18"} stopOpacity={0.5} />
                        <stop offset="95%" stopColor={isDarkMode ? "#BFF300" : "#151D18"} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorOutflow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366F1" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="10 10" vertical={false} strokeOpacity={0.07} />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fontWeight: 900, fill: '#64748B' }}
                      dy={10}
                    />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ borderRadius: '2.5rem', border: 'none', backgroundColor: isDarkMode ? '#1A221D' : '#FFF', boxShadow: '0 30px 60px -15px rgba(0,0,0,0.5)', padding: '20px' }}
                      itemStyle={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase' }}
                    />
                    <Area type="monotone" dataKey="inflow" stroke={isDarkMode ? "#BFF300" : "#151D18"} strokeWidth={6} fillOpacity={1} fill="url(#colorInflow)" dot={{ r: 6, fill: '#BFF300', strokeWidth: 3, stroke: '#151D18' }} activeDot={{ r: 10 }} />
                    <Area type="monotone" dataKey="outflow" stroke="#6366F1" strokeWidth={6} fillOpacity={1} fill="url(#colorOutflow)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                  {t('transactions.noTransactions', lang)}
                </div>
              )}
            </div>
          </div>

          <div className="xl:col-span-2 glass p-12 rounded-[5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.08)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] border border-gray-100 dark:border-white/5 transition-all hover:shadow-2xl flex flex-col justify-between overflow-hidden animate-stagger opacity-0" style={{ animationDelay: '600ms' }}>
            <div className="mb-10">
              <h3 className="font-black text-4xl text-dark dark:text-white uppercase tracking-tighter drop-shadow-sm">
                {t('dashboard.diversification', lang)}
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-[0.4em] mt-3">
                {t('dashboard.sectorPortfolio', lang)}
              </p>
            </div>
            <div className="h-[420px] relative transform-gpu hover:scale-105 transition-transform duration-700">
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 drop-shadow-2xl text-center">
                <span className="text-5xl font-black text-dark dark:text-white tracking-tighter leading-none">
                  {pieData.length > 0 ? '100%' : '0%'}
                </span>
                <span className="text-[12px] font-black text-brand uppercase tracking-[0.4em] mt-2">{t('dashboard.allocated', lang)}</span>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={100}
                    outerRadius={150}
                    paddingAngle={8}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry: any, index: any) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        className="drop-shadow-2xl cursor-pointer transition-all hover:scale-110"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: '2.5rem', border: 'none', backgroundColor: isDarkMode ? '#111814' : '#FFF', boxShadow: '0 30px 60px -15px rgba(0,0,0,0.5)' }}
                  />
                  <Legend verticalAlign="bottom" height={50} iconType="circle" wrapperStyle={{ fontWeight: '900', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1.5px', paddingTop: '20px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Advanced Chart Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-10">
          <div className="bg-white/60 dark:bg-[#1A221D] p-12 rounded-[3.5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.05)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] border border-white/40 dark:border-white/5 h-[550px] flex flex-col hover:scale-[1.02] transition-transform duration-500">
            <div className="mb-12">
              <h3 className="font-black text-3xl text-dark dark:text-white uppercase tracking-tighter drop-shadow-sm">
                {t('dashboard.partnerSpectrum', lang)}
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-[0.3em] mt-2">
                {t('dashboard.partnerBenchmark', lang)}
              </p>
            </div>
            <div className="flex-1 drop-shadow-2xl w-full min-h-[300px]">
              {radarData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                    <defs>
                      <linearGradient id="radarFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isDarkMode ? "#BFF300" : "#151D18"} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={isDarkMode ? "#BFF300" : "#151D18"} stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <PolarGrid stroke={isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)"} gridType="polygon" />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fontSize: 11, fontWeight: 900, fill: isDarkMode ? 'rgba(255,255,255,0.6)' : '#64748B' }}
                    />
                    <Radar
                      name={t('dashboard.engagement', lang)}
                      dataKey="A"
                      stroke={isDarkMode ? "#BFF300" : "#151D18"}
                      fill="url(#radarFill)"
                      fillOpacity={1}
                      strokeWidth={3}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: '1.5rem', border: 'none', backgroundColor: isDarkMode ? '#1A221D' : '#FFF', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', padding: '16px' }}
                      itemStyle={{ fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', color: isDarkMode ? '#fff' : '#000' }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                  {t('members.noMembers', lang) || "No Member Data"}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white/60 dark:bg-[#1A221D] p-12 rounded-[3.5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.05)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] border border-white/40 dark:border-white/5 h-[550px] flex flex-col hover:scale-[1.02] transition-transform duration-500">
            <div className="mb-14">
              <h3 className="font-black text-3xl text-dark dark:text-white uppercase tracking-tighter drop-shadow-sm">
                {t('dashboard.efficiencyMatrix', lang)}
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-[0.3em] mt-2">
                {t('dashboard.efficiencyDesc', lang)}
              </p>
            </div>
            <div className="flex-1 w-full min-h-[300px]">
              {performanceData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performanceData}>
                    <defs>
                      <linearGradient id="perfBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={isDarkMode ? "#BFF300" : "#151D18"} stopOpacity={1} />
                        <stop offset="100%" stopColor={isDarkMode ? "#BFF300" : "#151D18"} stopOpacity={0.6} />
                      </linearGradient>
                      <linearGradient id="riskBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366F1" stopOpacity={1} />
                        <stop offset="100%" stopColor="#818CF8" stopOpacity={0.6} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="10 10" vertical={false} strokeOpacity={0.07} />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fontWeight: 900, fill: '#64748B' }}
                      dy={10}
                    />
                    <Tooltip
                      cursor={{ fill: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className={`p-4 rounded-3xl shadow-2xl border ${isDarkMode ? 'bg-[#1A221D] border-white/10' : 'bg-white border-gray-100'}`}>
                              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                {(payload[0].payload as any).fullName}
                              </p>
                              <div className="space-y-1">
                                {payload.map((entry: any, index: number) => (
                                  <div key={index} className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></div>
                                    <span className={`text-xs font-bold ${isDarkMode ? 'text-white' : 'text-dark'}`}>
                                      {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}%
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
                    <Bar name={t('dashboard.performance', lang)} dataKey="performance" fill="url(#perfBarGradient)" radius={[6, 6, 0, 0]} barSize={20} className="drop-shadow-md" />
                    <Bar name={t('dashboard.risk', lang)} dataKey="risk" fill="url(#riskBarGradient)" radius={[6, 6, 0, 0]} barSize={20} className="drop-shadow-md" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                  {t('projects.noProjects', lang) || "No Performance Data"}
                </div>
              )}
            </div>
          </div>

          <div className="bg-dark p-14 rounded-[3.5rem] text-white flex flex-col transition-all shadow-[0_60px_120px_-30px_rgba(0,0,0,0.7)] relative overflow-hidden group h-[550px] hover:scale-[1.02] duration-500">
            <div className="absolute top-0 right-0 p-40 bg-brand/10 rounded-full -mr-20 -mt-20 blur-3xl transition-transform duration-[4s] group-hover:scale-125" />
            <div className="relative z-10 mb-12">
              <p className="text-[12px] font-black text-brand uppercase tracking-[0.6em] mb-4">{t('dashboard.peaks', lang)}</p>
              <h3 className="text-5xl font-black uppercase tracking-tighter leading-none drop-shadow-2xl">
                {t('dashboard.alphaMonths', lang)}
              </h3>
              <p className="text-sm font-medium text-white/40 mt-6 leading-relaxed">
                {t('dashboard.alphaDesc', lang)}
              </p>
            </div>

            <div className="relative z-10 flex-1 flex flex-col justify-between">
              <div className="space-y-8">
                {topMonths.length > 0 ? (
                  topMonths.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between group/item transition-all hover:-translate-y-1 duration-300">
                      <div className="flex items-center gap-8">
                        <span className="text-sm font-black text-white/20 uppercase w-12 tracking-widest">0{idx + 1}</span>
                        <div className="flex flex-col">
                          <span className="text-xl font-black uppercase tracking-[0.2em] text-white group-hover/item:text-brand transition-colors drop-shadow-md">{item.month}</span>
                          <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
                            {((item.inflow - item.outflow) > 0 ? '+' : '') + formatCompactNumber(item.inflow - item.outflow)} Net Profit
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-8 flex-1 max-w-[220px]">
                        <div className="h-3 bg-white/5 rounded-full flex-1 overflow-hidden shadow-inner relative">
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent w-full -translate-x-full group-hover/item:animate-[shimmer_1.5s_infinite]"></div>
                          {/* Progress bar based on Net Profit relative to max Net Profit */}
                          <div
                            className="h-full bg-gradient-to-r from-brand/80 to-brand shadow-[0_0_20px_rgba(191,243,0,0.6)] transition-all duration-1000 ease-out rounded-full"
                            style={{ width: `${Math.max(0, ((item.inflow - item.outflow) / (Math.max(...topMonths.map(m => (m.inflow - m.outflow) || 0)) || 1)) * 100)}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-black text-white/40 min-w-[60px] text-right">{formatCompactNumber(item.inflow - item.outflow)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-20 text-white/20">
                    <p className="text-xs font-bold uppercase tracking-widest">No Peak Data</p>
                  </div>
                )}
              </div>

              <div className="pt-12 mt-12 border-t border-white/10 flex items-center justify-between relative">
                <div className="group-hover:translate-x-2 transition-transform duration-500">
                  <p className="text-[12px] font-black text-white/30 uppercase tracking-widest mb-3">Highest Profit Month</p>
                  <p className="text-5xl font-black text-brand tracking-tighter leading-none drop-shadow-[0_10px_20px_rgba(191,243,0,0.3)]">
                    {formatCompactNumber(Math.max(...topMonths.map(m => (m.inflow - m.outflow) || 0)) || 0)} <span className="text-sm opacity-30">{t('common.bdt', lang)}</span>
                  </p>
                </div>
                <div className="w-24 h-24 rounded-[3rem] bg-brand text-dark flex items-center justify-center hover:rotate-12 transition-all cursor-pointer shadow-[0_25px_50px_rgba(191,243,0,0.4)] ring-8 ring-white/5 active:scale-90">
                  <TrendingUp size={44} strokeWidth={3} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Strategic Summary Bottom Cards with Depth */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-10">
          <div className="bg-white/60 dark:bg-[#1A221D] p-12 rounded-[3.5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.05)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] transition-all border border-white/40 dark:border-white/5 group hover:shadow-2xl hover:scale-[1.02] duration-500">
            <div className="flex justify-between items-center mb-10">
              <h3 className="font-black text-[11px] uppercase text-gray-500 tracking-[0.3em]">{t('dashboard.equityHealth', lang)}</h3>
            </div>
            <div className="flex items-center gap-10 mb-12">
              <div className="w-24 h-24 rounded-[3rem] bg-gray-50 dark:bg-white/5 flex items-center justify-center border border-gray-100 dark:border-white/5 shadow-inner">
                <Landmark size={48} className="text-brand drop-shadow-md" strokeWidth={3} />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-bold leading-relaxed mb-2 opacity-60">{t('dashboard.healthVerified', lang)}</p>
                <p className="text-2xl font-black dark:text-white uppercase tracking-tighter drop-shadow-sm">{t('dashboard.optimalReserves', lang)}</p>
              </div>
            </div>
            <div className="flex gap-5 mb-6">
              {[1, 1, 1, 1, 0.4].map((v, i) => (
                <div key={i} className="h-5 flex-1 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden shadow-inner">
                  <div className="h-full bg-brand transition-all duration-1000 shadow-[0_0_15px_rgba(191,243,0,0.5)]" style={{ width: `${v * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center">
              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">{t('dashboard.stability', lang)}</p>
              <p className="text-5xl font-black text-dark dark:text-white tracking-tighter drop-shadow-sm">92.4%</p>
            </div>
          </div>

          <div className="bg-white/60 dark:bg-[#1A221D] p-12 rounded-[3.5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.05)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] transition-all border border-white/40 dark:border-white/5 group hover:shadow-2xl hover:scale-[1.02] duration-500">
            <div className="flex justify-between items-center mb-12">
              <h3 className="font-black text-[11px] uppercase text-gray-500 tracking-[0.3em]">{t('dashboard.benchmarks', lang)}</h3>
              <span className="text-[11px] font-black text-brand bg-dark px-6 py-3 rounded-[1.5rem] shadow-[0_15px_30px_rgba(0,0,0,0.4)] ring-2 ring-white/5">08/12 {t('dashboard.met', lang)}</span>
            </div>
            <div className="space-y-10">
              {[
                { label: t('dashboard.auditShift', lang), done: true },
                { label: t('dashboard.riskAssessment', lang), done: false },
                { label: t('dashboard.poolExpansion', lang), done: false }
              ].map((goal, i) => (
                <div key={i} className="flex items-center gap-8 group/goal cursor-pointer">
                  <div className="relative">
                    {goal.done ? (
                      <div className="bg-brand rounded-xl p-2 shadow-lg shadow-brand/20">
                        <svg className="w-7 h-7 text-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : (
                      <div className="border-4 border-gray-200 dark:border-gray-800 rounded-xl p-2 group-hover/goal:border-brand transition-colors">
                        <div className="w-7 h-7"></div>
                      </div>
                    )}
                  </div>
                  <span className={`text-lg font-black uppercase tracking-widest transition-all ${goal.done ? 'text-dark dark:text-white line-through opacity-30 scale-95 origin-left' : 'text-gray-500 dark:text-gray-400 group-hover/goal:text-dark dark:group-hover/goal:text-white group-hover/goal:translate-x-2'}`}>
                    {goal.label}
                  </span>
                </div>
              ))}
            </div>
            <button className="w-full mt-14 py-7 border-4 border-dashed border-gray-200 dark:border-white/10 rounded-[3rem] text-[12px] font-black text-gray-400 uppercase tracking-[0.4em] hover:border-brand hover:text-brand hover:shadow-xl transition-all active:scale-95 group/btn">
              {t('dashboard.newObjective', lang)} <ArrowUpRight size={18} className="inline ml-2 group-hover/btn:translate-x-1 group-hover/btn:-translate-y-1 transition-transform" />
            </button>
          </div>

          <div className="bg-brand p-14 rounded-[3.5rem] text-dark shadow-[0_70px_140px_-30px_rgba(191,243,0,0.4)] flex flex-col justify-between transition-all group overflow-hidden relative border-4 border-dark/5 hover:scale-[1.02] duration-500">
            <div className="absolute top-0 right-0 p-48 bg-dark/10 rounded-full -mr-24 -mt-24 blur-3xl transition-transform duration-[4s] group-hover:scale-125" />
            <div className="relative z-10">
              <p className="text-[12px] font-black opacity-60 uppercase mb-12 tracking-[0.6em]">{t('dashboard.executiveLead', lang)}</p>
              <div className="flex items-center gap-10 mb-14">
                <div className="relative">
                  <div className="absolute inset-0 bg-dark/20 rounded-[3.5rem] blur-xl group-hover:blur-2xl transition-all" />
                  <Avatar name={topInvestor.name} size="xl" />
                </div>
                <div>
                  <h4 className="font-black text-3xl tracking-tighter drop-shadow-sm">{topInvestor.name}</h4>
                  <p className="text-[12px] font-black opacity-50 uppercase tracking-[0.3em] mt-3">{topInvestor.role}</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-12 border-t-2 border-dark/10 pt-12 relative z-10 text-center">
              <div className="group-hover:translate-y-[-5px] transition-transform">
                <p className="text-4xl font-black tracking-tighter leading-none mb-3 drop-shadow-sm">
                  BDT {formatCompactNumber(totalDeposits)}
                </p>
                <p className="text-[11px] font-black opacity-40 uppercase tracking-widest">{t('dashboard.managedAssets', lang)}</p>
              </div>
              <div className="group-hover:translate-y-[-5px] transition-transform delay-75">
                <p className="text-4xl font-black tracking-tighter leading-none mb-3 drop-shadow-sm">
                  {totalShares}
                </p>
                <p className="text-[11px] font-black opacity-40 uppercase tracking-widest">{t('dashboard.trust', lang)} (Shares)</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
