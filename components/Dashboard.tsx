
import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Radar, RadarChart, PolarGrid, PolarAngleAxis
} from 'recharts';
import { TrendingUp, Landmark, ArrowUpRight } from 'lucide-react';
import StatCard from './StatCard';
import { Language, t } from '../i18n/translations';
import { useGlobalState } from '../context/GlobalStateContext';
import { formatCompactNumber } from '../utils/formatters';

interface DashboardProps {
  isDarkMode: boolean;
  lang: Language;
}

const Dashboard: React.FC<DashboardProps> = ({ isDarkMode, lang }) => {
  const { members, projects, deposits, funds, expenses } = useGlobalState();

  // Basic Metrics
  const totalDeposits = useMemo(() => deposits.reduce((sum, d) => sum + d.amount, 0), [deposits]);
  const investedCapital = useMemo(() => projects.reduce((sum, p) => sum + p.initialInvestment, 0), [projects]);
  const totalShares = useMemo(() => members.reduce((sum, m) => sum + m.shares, 0), [members]);

  // Yield Index - Average of projected returns of active projects
  const yieldIndex = useMemo(() => {
    if (projects.length === 0) return "0%";
    const avg = projects.reduce((sum, p) => sum + (parseFloat(p.projectedReturn || '0') || 0), 0) / projects.length;
    return `${avg.toFixed(1)}%`;
  }, [projects]);

  // Process Trend Data (Last 6 Months)
  const trendData = useMemo(() => {
    const months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']; // Reference labels or dynamic
    const dataMap: Record<string, { name: string, inflow: number, outflow: number }> = {};

    // Initialize last 6 months
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mName = d.toLocaleString('default', { month: 'short' });
      dataMap[mName] = { name: mName, inflow: 0, outflow: 0 };
    }

    deposits.forEach(d => {
      const mName = new Date(d.date).toLocaleString('default', { month: 'short' });
      if (dataMap[mName]) dataMap[mName].inflow += d.amount;
    });

    expenses.forEach(e => {
      const mName = new Date(e.date).toLocaleString('default', { month: 'short' });
      if (dataMap[mName]) dataMap[mName].outflow += e.amount;
    });

    return Object.values(dataMap);
  }, [deposits, expenses]);

  // Process Portfolio Data
  const pieData = useMemo(() => {
    const categories: Record<string, number> = {};
    projects.forEach(p => {
      categories[p.category] = (categories[p.category] || 0) + p.initialInvestment;
    });

    const colors = ['#151D18', '#10B981', '#6366F1', '#F59E0B', '#EC4899'];
    return Object.entries(categories).map(([name, value], idx) => ({
      name,
      value,
      color: colors[idx % colors.length]
    }));
  }, [projects]);

  // Process Radar Data (Member contribution spectrum)
  const radarData = useMemo(() => {
    // Map top 6 members by shares
    return [...members]
      .sort((a, b) => b.shares - a.shares)
      .slice(0, 6)
      .map(m => ({
        subject: (m.name || '').split(' ')[0],
        A: m.shares,
        fullMark: Math.max(...members.map(mem => mem.shares)) || 100
      }));
  }, [members]);

  // Process Performance Data (Efficiency Matrix - simplified for now)
  const performanceData = useMemo(() => {
    return projects.slice(0, 4).map(p => ({
      name: (p.title || '').substring(0, 5),
      performance: parseFloat(p.projectedReturn || '0') || 50,
      risk: 100 - (parseFloat(p.projectedReturn || '0') || 50) / 2
    }));
  }, [projects]);

  // Process Top Months
  const topMonths = useMemo(() => {
    const data = trendData
      .sort((a, b) => b.inflow - a.inflow)
      .slice(0, 5)
      .map(d => ({ month: d.name, total: d.inflow }));
    return data;
  }, [trendData]);

  const topInvestor = members.sort((a, b) => b.shares - a.shares)[0] || { name: 'N/A', role: 'N/A' };

  return (
    <div className="space-y-12 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>INVESTWISE</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('dashboard.intelligence', lang)}</span>
          </nav>
        </div>
      </div>

      {/* Primary High-Impact Metric Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
        <StatCard label={t('dashboard.totalDeposits', lang)} value={`BDT ${formatCompactNumber(totalDeposits)}`} change="+14.2%" variant="brand" />
        <StatCard label={t('dashboard.investedCapital', lang)} value={`BDT ${formatCompactNumber(investedCapital)}`} change="+12.4%" variant="dark" />
        <StatCard label={t('dashboard.totalMembers', lang)} value={members.length.toString()} change="+4" variant="light" />
        <StatCard label={t('dashboard.totalShares', lang)} value={totalShares.toString()} change="+180" variant="light" />
        <StatCard label={t('dashboard.yieldIndex', lang)} value={yieldIndex} change="+2.4%" variant="light" />
      </div>

      {/* Core Analytics Suite */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
        <div className="xl:col-span-3 bg-white dark:bg-[#1A221D] p-12 rounded-[5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.08)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] border border-gray-100 dark:border-white/5 transition-all hover:shadow-2xl">
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
          <div className="h-[480px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
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
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 900, fill: '#64748B' }} dy={10} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ borderRadius: '2.5rem', border: 'none', backgroundColor: isDarkMode ? '#1A221D' : '#FFF', boxShadow: '0 30px 60px -15px rgba(0,0,0,0.5)', padding: '20px' }}
                  itemStyle={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase' }}
                />
                <Area type="monotone" dataKey="inflow" stroke={isDarkMode ? "#BFF300" : "#151D18"} strokeWidth={6} fillOpacity={1} fill="url(#colorInflow)" dot={{ r: 6, fill: '#BFF300', strokeWidth: 3, stroke: '#151D18' }} activeDot={{ r: 10 }} />
                <Area type="monotone" dataKey="outflow" stroke="#6366F1" strokeWidth={6} fillOpacity={1} fill="url(#colorOutflow)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="xl:col-span-2 bg-white dark:bg-[#1A221D] p-12 rounded-[5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.08)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] border border-gray-100 dark:border-white/5 transition-all hover:shadow-2xl flex flex-col justify-between overflow-hidden">
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
              <span className="text-[12px] font-black text-brand uppercase tracking-[0.4em] mt-2">Allocated</span>
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
        <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.08)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] border border-gray-100 dark:border-white/5 h-[550px] flex flex-col">
          <div className="mb-12">
            <h3 className="font-black text-3xl text-dark dark:text-white uppercase tracking-tighter drop-shadow-sm">
              {t('dashboard.partnerSpectrum', lang)}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-[0.3em] mt-2">
              {t('dashboard.partnerBenchmark', lang)}
            </p>
          </div>
          <div className="flex-1 drop-shadow-2xl">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                <PolarGrid stroke={isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)"} />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fontWeight: 900, fill: '#64748B' }} />
                <Radar
                  name="Engagement"
                  dataKey="A"
                  stroke={isDarkMode ? "#BFF300" : "#151D18"}
                  fill={isDarkMode ? "#BFF300" : "#151D18"}
                  fillOpacity={0.65}
                  strokeWidth={4}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '2rem', border: 'none', backgroundColor: isDarkMode ? '#111814' : '#FFF', boxShadow: '0 25px 50px rgba(0,0,0,0.4)' }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.08)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] border border-gray-100 dark:border-white/5 h-[550px] flex flex-col">
          <div className="mb-14">
            <h3 className="font-black text-3xl text-dark dark:text-white uppercase tracking-tighter drop-shadow-sm">
              {t('dashboard.efficiencyMatrix', lang)}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-[0.3em] mt-2">
              {t('dashboard.efficiencyDesc', lang)}
            </p>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={performanceData}>
                <CartesianGrid strokeDasharray="10 10" vertical={false} strokeOpacity={0.07} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#64748B' }} dy={10} />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ borderRadius: '2.5rem', border: 'none', backgroundColor: isDarkMode ? '#111814' : '#FFF', boxShadow: '0 30px 60px -15px rgba(0,0,0,0.5)' }}
                />
                <Bar dataKey="performance" fill={isDarkMode ? '#BFF300' : '#151D18'} radius={[10, 10, 0, 0]} barSize={30} className="drop-shadow-lg" />
                <Bar dataKey="risk" fill="#6366F1" radius={[10, 10, 0, 0]} barSize={30} className="drop-shadow-lg" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-dark p-14 rounded-[5rem] text-white flex flex-col transition-all shadow-[0_60px_120px_-30px_rgba(0,0,0,0.7)] relative overflow-hidden group h-[550px]">
          <div className="absolute top-0 right-0 p-40 bg-brand/10 rounded-full -mr-20 -mt-20 blur-3xl transition-transform duration-[4s] group-hover:scale-125" />
          <div className="relative z-10 mb-12">
            <p className="text-[12px] font-black text-brand uppercase tracking-[0.6em] mb-4">Vesting Peaks</p>
            <h3 className="text-5xl font-black uppercase tracking-tighter leading-none drop-shadow-2xl">
              {t('dashboard.alphaMonths', lang)}
            </h3>
            <p className="text-sm font-medium text-white/40 mt-6 leading-relaxed">
              {t('dashboard.alphaDesc', lang)}
            </p>
          </div>

          <div className="relative z-10 flex-1 flex flex-col justify-between">
            <div className="space-y-8">
              {topMonths.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between group/item">
                  <div className="flex items-center gap-8">
                    <span className="text-sm font-black text-white/20 uppercase w-12 tracking-widest">0{idx + 1}</span>
                    <span className="text-xl font-black uppercase tracking-[0.2em] group-hover/item:text-brand transition-colors drop-shadow-md">{item.month}</span>
                  </div>
                  <div className="flex items-center gap-8 flex-1 max-w-[220px]">
                    <div className="h-3 bg-white/5 rounded-full flex-1 overflow-hidden shadow-inner">
                      <div className="h-full bg-brand shadow-[0_0_20px_rgba(191,243,0,0.6)]" style={{ width: `${(item.total / (Math.max(...topMonths.map(m => m.total)) || 1)) * 100}%` }}></div>
                    </div>
                    <span className="text-sm font-black text-white/40 min-w-[60px] text-right">{formatCompactNumber(item.total)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-12 mt-12 border-t border-white/10 flex items-center justify-between relative">
              <div className="group-hover:translate-x-2 transition-transform duration-500">
                <p className="text-[12px] font-black text-white/30 uppercase tracking-widest mb-3">Max Monthly Inflow</p>
                <p className="text-5xl font-black text-brand tracking-tighter leading-none drop-shadow-[0_10px_20px_rgba(191,243,0,0.3)]">
                  {formatCompactNumber(Math.max(...topMonths.map(m => m.total)) || 0)} <span className="text-sm opacity-30">{t('common.bdt', lang)}</span>
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
        <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.08)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] transition-all border border-gray-100 dark:border-white/5 group hover:shadow-2xl">
          <div className="flex justify-between items-center mb-10">
            <h3 className="font-black text-[11px] uppercase text-gray-500 tracking-[0.3em]">{t('dashboard.equityHealth', lang)}</h3>
          </div>
          <div className="flex items-center gap-10 mb-12">
            <div className="w-24 h-24 rounded-[3rem] bg-gray-50 dark:bg-white/5 flex items-center justify-center border border-gray-100 dark:border-white/5 shadow-inner">
              <Landmark size={48} className="text-brand drop-shadow-md" strokeWidth={3} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-bold leading-relaxed mb-2 opacity-60">System health verified.</p>
              <p className="text-2xl font-black dark:text-white uppercase tracking-tighter drop-shadow-sm">Optimal Reserves</p>
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

        <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[5rem] shadow-[0_40px_80px_-25px_rgba(0,0,0,0.08)] dark:shadow-[0_50px_100px_-30px_rgba(0,0,0,0.5)] transition-all border border-gray-100 dark:border-white/5 group hover:shadow-2xl">
          <div className="flex justify-between items-center mb-12">
            <h3 className="font-black text-[11px] uppercase text-gray-500 tracking-[0.3em]">{t('dashboard.benchmarks', lang)}</h3>
            <span className="text-[11px] font-black text-brand bg-dark px-6 py-3 rounded-[1.5rem] shadow-[0_15px_30px_rgba(0,0,0,0.4)] ring-2 ring-white/5">08/12 MET</span>
          </div>
          <div className="space-y-10">
            {[
              { label: "Quarterly Audit Shift", done: true },
              { label: "Vested Risk Assessment", done: false },
              { label: "Liquid Pool Expansion", done: false }
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

        <div className="bg-brand p-14 rounded-[5rem] text-dark shadow-[0_70px_140px_-30px_rgba(191,243,0,0.4)] flex flex-col justify-between transition-all group overflow-hidden relative border-4 border-dark/5">
          <div className="absolute top-0 right-0 p-48 bg-dark/10 rounded-full -mr-24 -mt-24 blur-3xl transition-transform duration-[4s] group-hover:scale-125" />
          <div className="relative z-10">
            <p className="text-[12px] font-black opacity-60 uppercase mb-12 tracking-[0.6em]">Executive Lead</p>
            <div className="flex items-center gap-10 mb-14">
              <div className="relative">
                <div className="absolute inset-0 bg-dark/20 rounded-[3.5rem] blur-xl group-hover:blur-2xl transition-all" />
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${topInvestor.name}`} className="w-28 h-28 rounded-[3.5rem] border-8 border-dark shadow-2xl group-hover:rotate-12 transition-transform duration-700 relative z-10" alt="Lead" />
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
  );
};

export default Dashboard;
