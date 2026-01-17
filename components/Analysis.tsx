
import React, { useState, useMemo } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Users, Calendar,
  Search, Filter, ChevronLeft, ChevronRight, Award,
  CheckCircle2, AlertCircle, PieChart, Activity,
  ArrowUpRight, Download, Eye
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Cell, AreaChart, Area
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

const YEARS = [2024, 2025, 2026];

interface AnalysisProps {
  lang: Language;
}

const Analysis: React.FC<AnalysisProps> = ({ lang }) => {
  const { members, deposits } = useGlobalState();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[new Date().getMonth()]);
  const [activeTab, setActiveTab] = useState<'Intelligence' | 'Regularity' | 'Leaderboard'>('Intelligence');

  const trendData = useMemo(() => {
    const last6Months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = MONTHS[d.getMonth()].substring(0, 3);
      const monthDeposits = deposits.filter(dep => {
        const depDate = new Date(dep.date);
        return depDate.getMonth() === d.getMonth() && depDate.getFullYear() === d.getFullYear();
      });
      const amount = monthDeposits.reduce((sum, dep) => sum + dep.amount, 0);
      last6Months.push({ month: monthName, amount });
    }
    return last6Months;
  }, [deposits]);

  const paymentMatrixData = useMemo(() => {
    return members.map(m => {
      const payments: any = {};
      MONTHS.forEach(month => {
        const key = `${month} ${selectedYear}`;
        const monthDeposits = deposits.filter(d => {
          const depDate = new Date(d.date);
          return d.memberId === m.id && depDate.getMonth() === MONTHS.indexOf(month) && depDate.getFullYear() === selectedYear;
        });
        payments[key] = monthDeposits.reduce((sum, d) => sum + d.amount, 0);
      });
      return { memberId: m.memberId, memberName: m.name, payments };
    });
  }, [members, deposits, selectedYear]);

  const topContributorOfMonth = useMemo(() => {
    const monthIndex = MONTHS.indexOf(selectedMonth);
    const monthDeposits = deposits.filter(d => {
      const depDate = new Date(d.date);
      return depDate.getMonth() === monthIndex && depDate.getFullYear() === selectedYear;
    });
    const contributionMap = new Map<string, number>();
    monthDeposits.forEach(d => {
      contributionMap.set(d.memberId, (contributionMap.get(d.memberId) || 0) + d.amount);
    });
    let topMemberId = '';
    let maxAmount = 0;
    contributionMap.forEach((amount, memberId) => {
      if (amount > maxAmount) {
        maxAmount = amount;
        topMemberId = memberId;
      }
    });
    return members.find(m => m.id === topMemberId) || members[0];
  }, [selectedMonth, selectedYear, deposits, members]);

  const monthStats = useMemo(() => {
    const monthIndex = MONTHS.indexOf(selectedMonth);
    const currentMonthDeposits = deposits.filter(d => {
      const depDate = new Date(d.date);
      return depDate.getMonth() === monthIndex && depDate.getFullYear() === selectedYear;
    });
    const prevMonthDeposits = deposits.filter(d => {
      const depDate = new Date(d.date);
      const prevMonth = monthIndex === 0 ? 11 : monthIndex - 1;
      const prevYear = monthIndex === 0 ? selectedYear - 1 : selectedYear;
      return depDate.getMonth() === prevMonth && depDate.getFullYear() === prevYear;
    });
    const total = currentMonthDeposits.reduce((sum, d) => sum + d.amount, 0);
    const prevTotal = prevMonthDeposits.reduce((sum, d) => sum + d.amount, 0);
    const growth = prevTotal > 0 ? (((total - prevTotal) / prevTotal) * 100).toFixed(1) : '0.0';
    const expectedTotal = members.length * 10000;
    const completion = expectedTotal > 0 ? ((total / expectedTotal) * 100).toFixed(0) : '0';
    return { total, growth: `${growth > '0' ? '+' : ''}${growth}%`, completion: `${completion}%` };
  }, [selectedMonth, selectedYear, deposits, members]);

  const avgMonthlyPay = useMemo(() => {
    const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);
    const monthsCount = new Set(deposits.map(d => `${new Date(d.date).getMonth()}-${new Date(d.date).getFullYear()}`)).size || 1;
    return (totalDeposits / monthsCount / 1000).toFixed(1);
  }, [deposits]);

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
              { header: 'Partner', key: 'memberName' },
              { header: 'Member ID', key: 'memberId' },
              ...MONTHS.map(m => ({
                header: m,
                key: `${m} ${selectedYear}`,
                format: (item: any) => formatCurrency(item[`${m} ${selectedYear}`] || 0)
              }))
            ]}
            fileName={`contribution_analysis_${selectedYear}`}
            title={`Financial Contribution Analysis - ${selectedYear}`}
            targetId="analysis-snapshot-target"
          />
          <div className="flex bg-white dark:bg-[#1A221D] p-1 rounded-2xl border border-gray-100 dark:border-white/5">
            {YEARS.map(y => (
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
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Primary Analytics Tabs */}
      <div className="flex gap-4 p-2 bg-white/50 dark:bg-white/5 rounded-[2.5rem] backdrop-blur-xl border border-gray-100 dark:border-white/5 max-w-fit">
        {(['Intelligence', 'Regularity', 'Leaderboard'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab
              ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-xl'
              : 'text-gray-500 hover:text-dark dark:hover:text-white'
              }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div id="analysis-snapshot-target" className="space-y-10">
        {activeTab === 'Intelligence' && (
          <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-dark p-10 rounded-[4rem] text-white flex flex-col justify-between shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-20 bg-brand/10 rounded-full -mr-10 -mt-10 blur-3xl group-hover:scale-110 transition-transform duration-1000"></div>
                <div className="relative z-10">
                  <p className="text-[11px] font-black text-brand uppercase tracking-[0.4em] mb-4">Top Performer ({selectedMonth})</p>
                  {topContributorOfMonth ? (
                    <>
                      <div className="flex items-center gap-6 mb-8">
                        <img src={topContributorOfMonth.avatar || `https://ui-avatars.com/api/?name=${topContributorOfMonth.name}&background=BFF300&color=000`} className="w-20 h-20 rounded-[2.5rem] border-4 border-brand/20 shadow-2xl" alt="" />
                        <div>
                          <h3 className="text-3xl font-black tracking-tighter leading-none">{topContributorOfMonth.name}</h3>
                          <p className="text-[10px] font-black opacity-40 uppercase tracking-widest mt-2">Elite Partner Pool</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 py-4 border-t border-white/10">
                        <Award className="text-brand" size={24} />
                        <p className="text-lg font-black tracking-tight leading-none">BDT {topContributorOfMonth.totalContributed.toLocaleString()} <span className="text-[10px] opacity-40 uppercase">Invested</span></p>
                      </div>
                    </>
                  ) : (
                    <p className="text-white/40">No data available</p>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2 bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-8">
                  <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter">Collection Velocity</h4>
                  <div className="flex items-center gap-4 text-[10px] font-black">
                    <div className="flex items-center gap-1.5 text-emerald-500"><TrendingUp size={14} /> {monthStats.growth} Growth</div>
                    <div className="flex items-center gap-1.5 text-gray-400"><CheckCircle2 size={14} /> {monthStats.completion} Target Met</div>
                  </div>
                </div>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData}>
                      <defs>
                        <linearGradient id="colorAmt" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#BFF300" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#BFF300" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="6 6" vertical={false} strokeOpacity={0.05} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 900, fill: '#64748B' }} />
                      <YAxis hide domain={['dataMin - 50000', 'dataMax + 50000']} />
                      <Tooltip
                        contentStyle={{ borderRadius: '1.5rem', border: 'none', backgroundColor: '#151D18', boxShadow: '0 20px 40px rgba(0,0,0,0.4)', color: '#FFF' }}
                      />
                      <Area type="monotone" dataKey="amount" stroke="#BFF300" strokeWidth={4} fillOpacity={1} fill="url(#colorAmt)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              {[
                { label: 'Avg Monthly Pay', value: `${avgMonthlyPay}K`, icon: <Activity size={20} />, color: 'text-brand' },
                { label: 'Active Members', value: members.filter(m => m.status === 'active').length.toString(), icon: <Users size={20} />, color: 'text-blue-500' },
                { label: 'Retention rate', value: `${retentionRate}%`, icon: <Users size={20} />, color: 'text-emerald-500' },
                { label: 'Total Deposits', value: deposits.length.toString(), icon: <ArrowUpRight size={20} />, color: 'text-amber-500' }
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
                <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">Payment Regularity Matrix</h4>
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-2">Visual audit of member contributions for {selectedYear}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-white/5">
                    <th className="sticky left-0 bg-white dark:bg-[#1A221D] z-10 px-10 py-6 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest border-r border-gray-100 dark:border-white/5 shadow-xl">Partner Entity</th>
                    {MONTHS.map(m => (
                      <th key={m} className="px-6 py-6 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest">{m.substring(0, 3)}</th>
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
                <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter">Strategic Lead Partners</h4>
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
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Share Rank: Platinum</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-brand tracking-tighter leading-none">{formatCurrency(m.totalContributed)}</p>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-1">Total BDT Vested</p>
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
                      <p className="text-[10px] font-black text-brand uppercase tracking-[0.4em]">Portfolio Overview</p>
                    </div>
                    <h4 className="text-5xl font-black text-white uppercase tracking-tighter leading-[0.8] mb-8">Investment Distribution</h4>
                    <p className="text-white/40 text-base font-medium leading-relaxed max-w-sm mb-12">
                      {members.length} active partners contributing to the investment pool. Total contributions: {formatCurrency(deposits.reduce((sum, d) => sum + d.amount, 0))}
                    </p>
                  </div>
                  <div className="pt-12 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">Total Members</p>
                        <p className="text-4xl font-black text-white tracking-tighter leading-none">{members.length} <span className="text-xs opacity-30">PARTNERS</span></p>
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
