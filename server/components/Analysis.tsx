
import React, { useState, useMemo } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Users, Calendar,
  Search, Filter, ChevronLeft, ChevronRight, Award,
  CheckCircle2, AlertCircle, PieChart as LucidePieChart, Activity,
  ArrowUpRight, Download, Eye
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Cell, AreaChart, Area,
  PieChart, Pie, ComposedChart
} from 'recharts';
import { Member, Deposit } from '../types';
import { useGlobalState } from '../context/GlobalStateContext';
import { formatCurrency } from '../utils/formatters';
import ExportMenu from './ExportMenu';
import { Language, t } from '../i18n/translations';

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const monthKeys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Remove hardcoded YEARS, will compute dynamically

interface AnalysisProps {
  lang: Language;
}

const Analysis: React.FC<AnalysisProps> = ({ lang }) => {
  const { members, deposits, projects } = useGlobalState();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[new Date().getMonth()]);
  const [activeTab, setActiveTab] = useState<'Portfolio' | 'Dashboard' | 'Regularity' | 'Leaderboard'>('Dashboard');
  const [selectedMember, setSelectedMember] = useState<string>('All');

  // Helper to get { month, year } from a deposit
  const getDepositPeriod = (d: Deposit) => {
    // STRICT: Use Transaction Date. We have synced these to be the 1st of the Deposit Month.
    // This avoids string parsing issues and localization mismatches.
    const date = new Date(d.date);
    return { month: date.getMonth(), year: date.getFullYear() };
  };

  // Dynamically calculate available years from data
  const validYears = useMemo(() => {
    const years = new Set<number>();
    const currentYear = new Date().getFullYear();
    years.add(currentYear); // Always include current year

    deposits.forEach(d => {
      const { year } = getDepositPeriod(d);
      if (!isNaN(year)) {
        years.add(year);
      }
    });

    return Array.from(years).sort((a, b) => a - b);
  }, [deposits, lang]);

  // Realistic Enterprise Metrics
  const metrics = useMemo(() => {
    const filteredDeposits = selectedMember === 'All' ? deposits : deposits.filter(d => d.memberId === selectedMember);
    const totalInvested = filteredDeposits.reduce((sum, d) => sum + d.amount, 0);
    const totalDistributed = 0; // Currently no dividend history structure, but placeholder for enterprise
    // Always calculate global asset value to use for pro-rata calc
    const globalTotalAssetValue = projects.reduce((sum, p) => sum + p.currentFundBalance, 0);

    // For individual view:
    // Estimate share of asset value: (Their Total Deposits / Total Pool Deposits) * Global Total Asset Value
    const globalTotalInvested = deposits.reduce((sum, d) => sum + d.amount, 0);
    const estimatedIndividualAssetValue = selectedMember === 'All'
      ? globalTotalAssetValue
      : (globalTotalInvested > 0 ? (totalInvested / globalTotalInvested) * globalTotalAssetValue : 0);

    const activeValue = selectedMember === 'All' ? globalTotalAssetValue : estimatedIndividualAssetValue;

    // Simplified Calculations
    const netProfit = (activeValue + totalDistributed) - totalInvested;
    const roi = totalInvested > 0 ? (netProfit / totalInvested) * 100 : 0;

    return {
      totalInvested,
      totalAssetValue: activeValue,
      netProfit,
      roi: roi.toFixed(1)
    };
  }, [deposits, projects, selectedMember]);

  // Portfolio Data Aggregation
  const sectorData = useMemo(() => {
    const sectors: { [key: string]: number } = {};
    projects.forEach(p => {
      sectors[p.category] = (sectors[p.category] || 0) + p.currentFundBalance;
    });
    return Object.entries(sectors).map(([name, value]) => ({ name, value }));
  }, [projects]);

  const COLORS = ['#BFF300', '#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  const trendData = useMemo(() => {
    const last6Months = [];
    const now = new Date();
    // Use selectedYear if possible, or relative to now? Usually trends are relative to now or selected period
    // The previous implementation was "Last 6 Months from Now". Let's keep it relative to "Now" or "Selected Year/Month"?
    // The previous code used `now`. Let's stick to showing relevant trends.
    // Actually, usually users want to see the trend relative to the selection.
    // If "All Months" selected, maybe show whole year trend?
    // Let's keep 6 months history from the selected context or just last 6 months generally.
    // The original code was `for (let i = 5; i >= 0; i--)` from `now`.

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = MONTHS[d.getMonth()].substring(0, 3);
      const monthDeposits = deposits.filter(dep => {
        const { month, year } = getDepositPeriod(dep);
        const matchesMember = selectedMember === 'All' || dep.memberId === selectedMember;
        return matchesMember && month === d.getMonth() && year === d.getFullYear();
      });
      const amount = monthDeposits.reduce((sum, dep) => sum + dep.amount, 0);
      last6Months.push({ month: monthName, amount });
    }
    return last6Months;
  }, [deposits, selectedMember, lang]);

  const paymentMatrixData = useMemo(() => {
    const relevantMembers = selectedMember === 'All'
      ? members
      : members.filter(m => m.id === selectedMember);

    return relevantMembers.map(m => {
      const payments: any = {};
      MONTHS.forEach((month, idx) => {
        const key = `${month} ${selectedYear}`;
        const monthDeposits = deposits.filter(d => {
          const { month: dMonth, year: dYear } = getDepositPeriod(d);
          return d.memberId === m.id && dMonth === idx && dYear === selectedYear;
        });
        payments[key] = monthDeposits.reduce((sum, d) => sum + d.amount, 0);
      });
      return { memberId: m.memberId, memberName: m.name, payments };
    });
  }, [members, deposits, selectedYear, selectedMember, lang]);

  const topContributorOfMonth = useMemo(() => {
    const monthIndex = MONTHS.indexOf(selectedMonth);
    const monthDeposits = deposits.filter(d => {
      const { month: dMonth, year: dYear } = getDepositPeriod(d);
      const matchesMember = selectedMember === 'All' || d.memberId === selectedMember;
      const matchesMonth = selectedMonth === 'All' || dMonth === monthIndex;
      return matchesMember && matchesMonth && dYear === selectedYear;
    });

    const contributionMap = new Map<string, number>();
    monthDeposits.forEach(d => {
      contributionMap.set(d.memberId, (contributionMap.get(d.memberId) || 0) + d.amount);
    });

    // If specific member selected, force return that member if they have a deposit
    if (selectedMember !== 'All') {
      const member = members.find(m => m.id === selectedMember);
      if (member) {
        // Calculate lifetime total for this member to show in snapshot
        const lifetimeTotal = deposits
          .filter(d => d.memberId === selectedMember)
          .reduce((sum, d) => sum + d.amount, 0);

        return {
          ...member,
          totalContributed: lifetimeTotal
        };
      }
    }

    if (monthDeposits.length === 0) return null;

    let topMemberId = '';
    let maxAmount = 0;
    contributionMap.forEach((amount, memberId) => {
      if (amount > maxAmount) {
        maxAmount = amount;
        topMemberId = memberId;
      }
    });

    const topMember = members.find(m => m.id === topMemberId);
    return topMember ? { ...topMember, totalContributed: maxAmount } : null; // Ensure we display the MONTHLY max amount, not global total
  }, [selectedMonth, selectedYear, deposits, members, selectedMember, lang]);

  const monthStats = useMemo(() => {
    const monthIndex = MONTHS.indexOf(selectedMonth);
    const isAllMonths = selectedMonth === 'All';

    const currentPeriodDeposits = deposits.filter(d => {
      const { month, year } = getDepositPeriod(d);
      const matchesMember = selectedMember === 'All' || d.memberId === selectedMember;
      const matchesMonth = isAllMonths || month === monthIndex;
      return matchesMember && matchesMonth && year === selectedYear;
    });

    // Strategy for 'All Months': Compare to Previous Year Total, or just hide growth if complexity is too high.
    // Let's compare to Previous Year Total for 'All', or Previous Month for 'Month View'
    const prevPeriodDeposits = deposits.filter(d => {
      const { month, year } = getDepositPeriod(d);
      const matchesMember = selectedMember === 'All' || d.memberId === selectedMember;

      if (isAllMonths) {
        // Compare with previous YEAR
        return matchesMember && year === selectedYear - 1;
      } else {
        // Compare with previous MONTH
        const prevMonth = monthIndex === 0 ? 11 : monthIndex - 1;
        const prevYear = monthIndex === 0 ? selectedYear - 1 : selectedYear;
        return matchesMember && month === prevMonth && year === prevYear;
      }
    });

    const total = currentPeriodDeposits.reduce((sum, d) => sum + d.amount, 0);
    const prevTotal = prevPeriodDeposits.reduce((sum, d) => sum + d.amount, 0);

    // Safety check for division by zero
    const growth = prevTotal > 0 ? (((total - prevTotal) / prevTotal) * 100).toFixed(1) : (total > 0 ? '100.0' : '0.0');

    // For completion: Calculate based on active members' share counts
    const filteredMembers = selectedMember === 'All'
      ? members.filter(m => m.status === 'active')
      : members.filter(m => m.id === selectedMember);

    const monthlyTarget = filteredMembers.reduce((sum, m) => sum + (m.shares * 1000), 0);
    const monthsInTarget = isAllMonths ? 12 : 1;
    const expectedTotal = monthlyTarget * monthsInTarget;

    const completion = expectedTotal > 0 ? ((total / expectedTotal) * 100).toFixed(0) : '0';
    const growthNum = Number(growth);

    return { total, growth: `${growthNum > 0 ? '+' : ''}${growth}%`, completion: `${completion}%` };
  }, [selectedMonth, selectedYear, deposits, members, selectedMember, lang]);

  const avgMonthlyPay = useMemo(() => {
    const filteredDeposits = selectedMember === 'All' ? deposits : deposits.filter(d => d.memberId === selectedMember);
    const totalDeposits = filteredDeposits.reduce((sum, d) => sum + d.amount, 0);
    // Use getDepositPeriod for counting unique months
    const uniqueMonths = new Set(filteredDeposits.map(d => {
      const { month, year } = getDepositPeriod(d);
      return `${month}-${year}`;
    }));
    const monthsCount = uniqueMonths.size || 1;
    return (totalDeposits / monthsCount / 1000).toFixed(1);
  }, [deposits, selectedMember, lang]);

  const retentionRate = useMemo(() => {
    const activeMembers = members.filter(m => m.status === 'active').length;
    return members.length > 0 ? ((activeMembers / members.length) * 100).toFixed(1) : '0.0';
  }, [members]);

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.strategy', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.analysis', lang)}</span>
          </nav>
          <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.analysis', lang)}</h1>
        </div>
        <div className="flex items-center gap-4">
          <ExportMenu
            data={paymentMatrixData.map(row => ({
              ...row,
              ...row.payments
            }))}
            columns={[
              { header: t('analysis.partnerEntity', lang), key: 'memberName' },
              { header: t('members.memberId', lang), key: 'memberId' },
              ...MONTHS.map((m, i) => ({
                header: `${t(`common.months.${monthKeys[i]}`, lang)} (BDT)`,
                key: `${m} ${selectedYear}`,
                format: (item: any) => (item[`${m} ${selectedYear}`] || 0).toLocaleString()
              }))
            ]}
            fileName={`contribution_analysis_${selectedYear}`}
            title={`${t('analysis.regularityMatrix', lang)} - ${selectedYear}`}
            lang={lang}
            targetId="analysis-snapshot-target"
          />

          <select
            value={selectedMember}
            onChange={(e) => setSelectedMember(e.target.value)}
            className="bg-white dark:bg-[#1A221D] text-dark dark:text-white px-6 py-3.5 rounded-2xl border border-gray-100 dark:border-white/5 font-black text-xs uppercase outline-none hover:bg-gray-50 dark:hover:bg-white/10 transition-all cursor-pointer"
          >
            <option value="All">All Partners</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          <div className="flex bg-white dark:bg-[#1A221D] p-1 rounded-2xl border border-gray-100 dark:border-white/5">
            {validYears.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${selectedYear === y ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-lg' : 'text-gray-400'}`}
              >
                {y}
              </button>
            ))}
          </div>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-dark dark:bg-brand text-white dark:text-dark px-6 py-3.5 rounded-2xl font-black text-xs uppercase outline-none shadow-xl shadow-brand/10 cursor-pointer"
          >
            <option value="All">{t('common.allMonths', lang) || 'All Months'}</option>
            {MONTHS.map((m, i) => <option key={m} value={m}>{t(`common.months.${monthKeys[i]}`, lang)}</option>)}
          </select>
        </div>
      </div>

      {/* Primary Analytics Tabs */}
      <div className="flex gap-4 p-2 bg-white/50 dark:bg-white/5 rounded-[2.5rem] backdrop-blur-xl border border-gray-100 dark:border-white/5 max-w-fit">
        {(['Portfolio', 'Dashboard', 'Regularity', 'Leaderboard'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab
              ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-xl'
              : 'text-gray-500 hover:text-dark dark:hover:text-white'
              }`}
          >
            {tab === 'Dashboard' ? t('nav.dashboard', lang) : t(`analysis.${tab.toLowerCase()}`, lang)}
          </button>
        ))}
      </div>

      <div id="analysis-snapshot-target" className="space-y-10">
        {/* Report Context Header - Included in Export */}
        <div className="bg-gradient-to-r from-gray-50 to-white dark:from-white/5 dark:to-transparent p-8 rounded-[2rem] border border-gray-100 dark:border-white/5 flex items-center justify-between mb-8">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('reports.periodSelection', lang)}</p>
            <h2 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">
              {selectedMonth === 'All'
                ? (t('common.allMonths', lang) || 'All Months')
                : t(`common.months.${monthKeys[MONTHS.indexOf(selectedMonth)]}`, lang)} {selectedYear}
            </h2>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('nav.analysis', lang)}</p>
            <div className="inline-block px-4 py-1.5 bg-brand text-dark rounded-full">
              <span className="text-xs font-black uppercase tracking-widest">{t(`analysis.${activeTab.toLowerCase()}`, lang)}</span>
            </div>
          </div>
        </div>

        {activeTab === 'Portfolio' && (
          <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-dark p-12 rounded-[4rem] text-white flex flex-col justify-between shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-32 bg-brand/5 rounded-full -mr-20 -mt-20 blur-3xl group-hover:scale-125 transition-transform duration-[2s]"></div>
                <div className="relative z-10">
                  <div className="inline-block px-5 py-2 bg-brand/10 border border-brand/20 rounded-full mb-8">
                    <p className="text-[10px] font-black text-brand uppercase tracking-[0.4em]">{t('analysis.portfolioOverview', lang)}</p>
                  </div>
                  <h4 className="text-5xl font-black text-white uppercase tracking-tighter leading-[0.8] mb-8">{t('analysis.totalAssetValue', lang)}</h4>
                  <p className="text-5xl font-black text-brand tracking-tighter leading-none mb-8">{formatCurrency(metrics.totalAssetValue)}</p>
                  <p className="text-white/40 text-sm font-medium leading-relaxed max-w-sm">
                    {t('analysis.partnersContributing', lang).replace('{count}', members.length.toString()).replace('{total}', formatCurrency(metrics.totalInvested))}
                  </p>
                </div>
              </div>

              <div className="lg:col-span-2 bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5">
                <div className="flex items-center justify-between mb-10">
                  <div>
                    <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('analysis.diversification', lang)}</h4>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-2">{t('analysis.investmentDist', lang)}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-3xl">
                    <LucidePieChart size={24} className="text-brand" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={sectorData}
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {sectorData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ borderRadius: '1.5rem', border: 'none', backgroundColor: '#151D18', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', color: '#FFF' }}
                          itemStyle={{ fontWeight: 900, fontSize: '12px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-4">
                    {sectorData.map((entry, index) => (
                      <div key={index} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-2xl">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                          <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{entry.name}</span>
                        </div>
                        <span className="text-xs font-black text-dark dark:text-white uppercase tracking-tighter">{formatCurrency(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-[#1A221D] rounded-[4rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5">
              <div className="p-10 border-b border-gray-50 dark:border-white/5 flex items-center justify-between">
                <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('analysis.projects', lang)}</h4>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-brand animate-pulse"></div>
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{projects.length} {t('analysis.activeMembers', lang)}</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-white/5">
                      <th className="px-10 py-6 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.projectIdentifier', lang)}</th>
                      <th className="px-6 py-6 text-center text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.initialInvestment', lang)}</th>
                      <th className="px-6 py-6 text-center text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.roiProjection', lang)}</th>
                      <th className="px-6 py-6 text-center text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('analysis.healthIndex', lang)}</th>
                      <th className="px-10 py-6 text-right text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.currentAllocation', lang)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                    {projects.map((project) => (
                      <tr key={project.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                        <td className="px-10 py-6 font-black text-dark dark:text-white uppercase text-xs tracking-tight">{project.title}</td>
                        <td className="px-6 py-6 text-center font-black text-gray-500 uppercase text-[10px]">{formatCurrency(project.initialInvestment)}</td>
                        <td className="px-6 py-6 text-center font-black text-brand uppercase text-[10px]">{project.expectedRoi}%</td>
                        <td className="px-6 py-6 text-center font-black uppercase text-[10px]">
                          <span className={`px-4 py-1.5 rounded-full ${project.health === 'Stable' ? 'bg-emerald-500/10 text-emerald-500' : project.health === 'At Risk' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'}`}>
                            {t(`common.${project.health.toLowerCase().replace(' ', '')}`, lang)}
                          </span>
                        </td>
                        <td className="px-10 py-6 text-right font-black text-dark dark:text-white uppercase text-xs tracking-tight">{formatCurrency(project.currentFundBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Dashboard' && (
          <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              {/* Core Enterprise Metrics */}
              {[
                { label: t('analysis.invested', lang), value: formatCurrency(metrics.totalInvested), desc: 'Capital Deployed', color: 'text-brand' },
                { label: t('analysis.totalAssetValue', lang), value: formatCurrency(metrics.totalAssetValue), desc: 'Current Valuation', color: 'text-blue-500' },
                { label: t('analysis.netGain', lang), value: formatCurrency(metrics.netProfit), desc: 'Absolute Return', color: metrics.netProfit >= 0 ? 'text-emerald-500' : 'text-red-500' },
                { label: 'ROI', value: `${metrics.roi}%`, desc: 'Performance', color: Number(metrics.roi) >= 0 ? 'text-emerald-500' : 'text-red-500' }
              ].map((m, i) => (
                <div key={i} className="bg-white dark:bg-[#1A221D] p-8 rounded-[3rem] card-shadow border border-gray-100 dark:border-white/5 relative overflow-hidden group hover:-translate-y-1 transition-all">
                  <div className="relative z-10">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{m.label}</p>
                    <p className={`text-4xl font-black ${m.color} tracking-tighter leading-none mb-2`}>{m.value}</p>
                    <p className="text-[9px] font-black text-gray-400/60 uppercase tracking-widest">{m.desc}</p>
                  </div>
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Activity size={40} className={m.color} />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-dark p-10 rounded-[4rem] text-white flex flex-col justify-between shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-20 bg-brand/10 rounded-full -mr-10 -mt-10 blur-3xl group-hover:scale-110 transition-transform duration-1000"></div>
                <div className="relative z-10">

                  {topContributorOfMonth ? (
                    <>
                      <div className="flex items-center gap-6 mb-8">
                        <img src={topContributorOfMonth.avatar || `https://ui-avatars.com/api/?name=${topContributorOfMonth.name}&background=BFF300&color=000`} className="w-20 h-20 rounded-[2.5rem] border-4 border-brand/20 shadow-2xl" alt="" />
                        <div>
                          <h3 className="text-3xl font-black tracking-tighter leading-none">{topContributorOfMonth.name}</h3>
                        </div>
                      </div>
                      <div className="space-y-4 pt-6 border-t border-white/10">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black opacity-40 uppercase tracking-widest">{t('analysis.invested', lang)}</p>
                          <p className="font-black text-brand">BDT {topContributorOfMonth.totalContributed.toLocaleString()}</p>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black opacity-40 uppercase tracking-widest">{t('members.shares', lang)}</p>
                          <p className="font-black">{topContributorOfMonth.shares}</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-white/40">{t('common.noData', lang)}</p>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2 bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('analysis.velocity', lang)}</h4>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-2">
                      {selectedMonth === 'All' ? 'YTD CAPITAL DEPLOYMENT' : t('analysis.capitalDeployment', lang)}
                    </p>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">{monthStats.growth} {t('analysis.growth', lang)}</p>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{monthStats.completion} {t('analysis.targetMet', lang)}</p>
                    </div>
                    <div className="bg-brand/10 p-4 rounded-2xl text-brand">
                      <TrendingUp size={24} />
                    </div>
                  </div>
                </div>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendData}>
                      <defs>
                        <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#BFF300" stopOpacity={0.8} />
                          <stop offset="100%" stopColor="#BFF300" stopOpacity={0.2} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#64748B' }} dy={10} />
                      <YAxis hide domain={['0', 'auto']} />
                      <Tooltip
                        cursor={{ fill: '#BFF300', opacity: 0.1 }}
                        contentStyle={{ borderRadius: '1.5rem', border: 'none', backgroundColor: '#151D18', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', color: '#FFF' }}
                        itemStyle={{ fontWeight: 900, fontSize: '12px' }}
                      />
                      <Bar dataKey="amount" fill="url(#barGradient)" radius={[6, 6, 6, 6]} barSize={40} />
                      <Line type="monotone" dataKey="amount" stroke="#FFF" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: '#1A221D', stroke: '#FFF' }} activeDot={{ r: 6, strokeWidth: 0, fill: '#BFF300' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className={`grid grid-cols-1 ${selectedMember === 'All' ? 'md:grid-cols-4' : 'md:grid-cols-2'} gap-8`}>
              {[
                { label: t('analysis.avgPay', lang), value: `${avgMonthlyPay}K`, icon: <Activity size={20} />, color: 'text-brand' },
                ...(selectedMember === 'All' ? [
                  { label: t('analysis.activeMembers', lang), value: members.filter(m => m.status === 'active').length.toString(), icon: <Users size={20} />, color: 'text-blue-500' },
                  { label: t('analysis.retention', lang), value: `${retentionRate}%`, icon: <Users size={20} />, color: 'text-emerald-500' }
                ] : []),
                { label: t('analysis.totalDeposits', lang), value: (selectedMember === 'All' ? deposits : deposits.filter(d => d.memberId === selectedMember)).length.toString(), icon: <ArrowUpRight size={20} />, color: 'text-amber-500' }
              ].map((stat, i) => (
                <div key={i} className="bg-white dark:bg-[#1A221D] p-8 rounded-[3rem] card-shadow border border-gray-100 dark:border-white/5 flex items-center justify-between transition-all hover:-translate-y-1">
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
                    <p className="text-3xl font-black text-dark dark:text-white tracking-tighter leading-none">{stat.value}</p>
                  </div>
                  <div className={`${stat.color} opacity-40`}>{stat.icon}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Regularity' && (
          <div className="bg-white dark:bg-[#1A221D] rounded-[4rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5 animate-in slide-in-from-bottom-4 duration-500">
            <div className="p-10 border-b border-gray-50 dark:border-white/5 flex items-center justify-between bg-gray-50/30 dark:bg-white/5">
              <div>
                <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('analysis.regularityMatrix', lang)}</h4>
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-2">{t('analysis.visualAudit', lang).replace('{year}', selectedYear.toString())}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-white/5">
                    <th className="sticky left-0 bg-white dark:bg-[#1A221D] z-10 px-10 py-6 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-100 dark:border-white/5 shadow-xl">{t('analysis.partnerEntity', lang)}</th>
                    {MONTHS.map((m, i) => (
                      <th key={m} className="px-6 py-6 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest">{t(`common.months.${monthKeys[i]}`, lang).substring(0, 3)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {paymentMatrixData.map((row) => (
                    <tr key={row.memberId} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                      <td className="sticky left-0 bg-white dark:bg-[#1A221D] z-10 px-10 py-6 border-r border-gray-100 dark:border-white/5 shadow-xl">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center text-[10px] font-black">{row.memberName[0]}</div>
                          <p className="text-xs font-black text-dark dark:text-white uppercase leading-none">{row.memberName}</p>
                        </div>
                      </td>
                      {MONTHS.map(m => {
                        const amount = (row.payments as any)[`${m} ${selectedYear}`] || 0;
                        return (
                          <td key={m} className="px-4 py-6 text-center">
                            <div className={`w-8 h-8 rounded-xl mx-auto flex items-center justify-center transition-all ${amount > 0
                              ? 'bg-brand text-dark shadow-lg shadow-brand/20 scale-110'
                              : 'bg-gray-50 dark:bg-white/5 text-gray-300 dark:text-gray-800'
                              }`}>
                              {amount > 0 ? <CheckCircle2 size={16} strokeWidth={3} /> : <div className="w-1.5 h-1.5 rounded-full bg-current"></div>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'Leaderboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 animate-in fade-in duration-500">
            <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5">
              <div className="flex items-center justify-between mb-10">
                <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter">{t('analysis.strategicLead', lang)}</h4>
                <Award className="text-brand" size={28} />
              </div>
              <div className="space-y-6">
                {members.sort((a, b) => b.totalContributed - a.totalContributed).slice(0, 10).map((m, i) => (
                  <div key={m.id} className="p-8 bg-gray-50 dark:bg-[#111814] rounded-[2.5rem] flex items-center justify-between group hover:translate-x-2 transition-all cursor-pointer">
                    <div className="flex items-center gap-6">
                      <div className="text-2xl font-black text-gray-300 dark:text-gray-800 group-hover:text-brand transition-colors">{String(i + 1).padStart(2, '0')}</div>
                      <img src={m.avatar || `https://ui-avatars.com/api/?name=${m.name}&background=BFF300&color=000`} className="w-14 h-14 rounded-2xl shadow-xl grayscale group-hover:grayscale-0 transition-all duration-500" alt="" />
                      <div>
                        <p className="font-black text-dark dark:text-white text-lg uppercase tracking-tight">{m.name}</p>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('analysis.shareRank', lang)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-brand tracking-tighter leading-none">{formatCurrency(m.totalContributed)}</p>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-1">{t('analysis.totalBDT', lang)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-10">
              <div className="bg-dark p-12 rounded-[4rem] shadow-2xl relative overflow-hidden group h-full">
                <div className="absolute top-0 right-0 p-32 bg-brand/5 rounded-full -mr-20 -mt-20 blur-3xl group-hover:scale-125 transition-transform duration-[2s]"></div>
                <div className="relative z-10 flex flex-col justify-between h-full">
                  <div>
                    <div className="inline-block px-5 py-2 bg-brand/10 border border-brand/20 rounded-full mb-8">
                      <p className="text-[10px] font-black text-brand uppercase tracking-[0.4em]">{t('analysis.portfolioOverview', lang)}</p>
                    </div>
                    <h4 className="text-5xl font-black text-white uppercase tracking-tighter leading-[0.8] mb-8">{t('analysis.investmentDist', lang)}</h4>
                    <p className="text-white/40 text-base font-medium leading-relaxed max-w-sm mb-12">
                      {t('analysis.partnersContributing', lang).replace('{count}', members.length.toString()).replace('{total}', formatCurrency(deposits.reduce((sum, d) => sum + d.amount, 0)))}
                    </p>
                  </div>
                  <div className="pt-12 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">{t('dashboard.totalPartners', lang)}</p>
                        <p className="text-4xl font-black text-white tracking-tighter leading-none">{members.length} <span className="text-xs opacity-30 uppercase">{t('nav.members', lang)}</span></p>
                      </div>
                      <div className="bg-brand w-16 h-16 rounded-[2rem] flex items-center justify-center text-dark hover:rotate-12 transition-all cursor-pointer">
                        <Eye size={28} strokeWidth={3} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Analysis;
