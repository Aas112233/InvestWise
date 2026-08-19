import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Award,
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Users,
  Eye,
  RotateCcw,
  CheckCircle2,
  X,
  Plus,
  ArrowUpRight,
  UserX,
  FileText,
  DollarSign,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { governanceService, memberService } from '../services/api';
import { LeaderboardEntry, MemberPenalty, PerformanceBreakdown, Member, User, AccessLevel } from '../types';
import { Language } from '../i18n/translations';
import Toast from './Toast';
import { TableRowSkeleton } from './ui/Skeleton';
import { useGlobalState } from '../context/GlobalStateContext';

interface GovernancePerformanceProps {
  lang: Language;
  currentUser?: User | null;
}

export const GovernancePerformance: React.FC<GovernancePerformanceProps> = ({ currentUser }) => {
  const { currencyCode } = useGlobalState();
  const [activeTab, setActiveTab] = useState<'LEADERBOARD' | 'PENALTIES'>('LEADERBOARD');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [penalties, setPenalties] = useState<MemberPenalty[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRecalculatingAll, setIsRecalculatingAll] = useState<boolean>(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [gradeFilter, setGradeFilter] = useState<string>('ALL');

  // Breakdown Modal State
  const [selectedMemberBreakdown, setSelectedMemberBreakdown] = useState<PerformanceBreakdown | null>(null);
  const [isLoadingBreakdown, setIsLoadingBreakdown] = useState<boolean>(false);

  // Issue Penalty Modal State
  const [isIssuePenaltyOpen, setIsIssuePenaltyOpen] = useState<boolean>(false);
  const [penaltyTargetMemberId, setPenaltyTargetMemberId] = useState<string>('');
  const [penaltyTier, setPenaltyTier] = useState<1 | 2 | 3 | 4>(1);
  const [penaltyReason, setPenaltyReason] = useState<string>('');
  const [isSubmittingPenalty, setIsSubmittingPenalty] = useState<boolean>(false);

  // Waive Penalty Modal State
  const [waiveTargetPenalty, setWaiveTargetPenalty] = useState<MemberPenalty | null>(null);
  const [waiveReason, setWaiveReason] = useState<string>('');
  const [isSubmittingWaive, setIsSubmittingWaive] = useState<boolean>(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const canWrite = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.role === 'Admin' || currentUser.role === 'Administrator' || currentUser.role === 'Manager') return true;
    return currentUser.permissions?.['MEMBERS'] === AccessLevel.WRITE;
  }, [currentUser]);

  const isAdmin = useMemo(() => {
    return currentUser?.role === 'Admin' || currentUser?.role === 'Administrator';
  }, [currentUser]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [leaderboardRes, penaltiesRes, membersRes] = await Promise.all([
        governanceService.getLeaderboard(),
        governanceService.getPenalties({ limit: 100 }),
        memberService.getAll(),
      ]);

      const lData = Array.isArray(leaderboardRes?.data) ? leaderboardRes.data : Array.isArray(leaderboardRes) ? leaderboardRes : [];
      setLeaderboard(lData);

      const pData = Array.isArray(penaltiesRes?.data) ? penaltiesRes.data : Array.isArray(penaltiesRes) ? penaltiesRes : [];
      setPenalties(pData);

      const mData = Array.isArray(membersRes?.data) ? membersRes.data : Array.isArray(membersRes) ? membersRes : [];
      setMembers(mData);
    } catch (err: unknown) {
      console.error('Failed to load governance data:', err);
      showToast('Failed to load governance data', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Recalculate All
  const handleRecalculateAll = async () => {
    try {
      setIsRecalculatingAll(true);
      await governanceService.recalculateAllPerformance();
      showToast('All member performance scores refreshed!');
      await loadData();
    } catch (err: unknown) {
      console.error('Failed to recalculate all scores:', err);
      showToast('Failed to recalculate performance scores', 'error');
    } finally {
      setIsRecalculatingAll(false);
    }
  };

  // View Performance Breakdown
  const handleViewBreakdown = async (memberId: string) => {
    try {
      setIsLoadingBreakdown(true);
      const breakdown = await governanceService.getMemberPerformance(memberId);
      setSelectedMemberBreakdown(breakdown);
    } catch (err: unknown) {
      console.error('Failed to fetch member breakdown:', err);
      showToast('Failed to load performance breakdown', 'error');
    } finally {
      setIsLoadingBreakdown(false);
    }
  };

  // Recalculate Single Member
  const handleRecalculateSingle = async (memberId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await governanceService.recalculateMemberPerformance(memberId);
      showToast('Member score updated');
      loadData();
    } catch (err: unknown) {
      console.error('Failed to update member score:', err);
      showToast('Failed to recalculate member score', 'error');
    }
  };

  // Issue Penalty Submit
  const handleIssuePenaltySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!penaltyTargetMemberId) {
      showToast('Please select a target member', 'error');
      return;
    }

    try {
      setIsSubmittingPenalty(true);
      await governanceService.issuePenalty({
        memberId: penaltyTargetMemberId,
        tier: penaltyTier,
        reason: penaltyReason,
      });

      showToast(`Tier ${penaltyTier} penalty successfully issued!`);
      setIsIssuePenaltyOpen(false);
      setPenaltyTargetMemberId('');
      setPenaltyReason('');
      loadData();
    } catch (err: unknown) {
      console.error('Failed to issue penalty:', err);
      showToast(err instanceof Error ? err.message : 'Failed to issue penalty', 'error');
    } finally {
      setIsSubmittingPenalty(false);
    }
  };

  // Waive Penalty Submit
  const handleWaivePenaltySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waiveTargetPenalty) return;

    try {
      setIsSubmittingWaive(true);
      await governanceService.waivePenalty(waiveTargetPenalty.id, waiveReason);
      showToast(`Penalty waived and fine of ${waiveTargetPenalty.calculatedDeduction} ${currencyCode} refunded!`);
      setWaiveTargetPenalty(null);
      setWaiveReason('');
      loadData();
    } catch (err: unknown) {
      console.error('Failed to waive penalty:', err);
      showToast(err instanceof Error ? err.message : 'Failed to waive penalty', 'error');
    } finally {
      setIsSubmittingWaive(false);
    }
  };

  // Filtered Leaderboard
  const filteredLeaderboard = useMemo(() => {
    return leaderboard.filter((entry) => {
      const matchesSearch =
        entry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (entry.memberId && entry.memberId.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesGrade = gradeFilter === 'ALL' || entry.grade === gradeFilter;
      return matchesSearch && matchesGrade;
    });
  }, [leaderboard, searchTerm, gradeFilter]);

  // Overall KPI Metrics
  const metrics = useMemo(() => {
    const totalMembers = leaderboard.length;
    if (totalMembers === 0) {
      return { avgScore: 100, topPerformers: 0, atRisk: 0, activePenalties: 0 };
    }

    const avgScore = Math.round(
      leaderboard.reduce((sum, item) => sum + Number(item.performanceScore || 0), 0) / totalMembers,
    );
    const topPerformers = leaderboard.filter((item) => item.grade === 'A+' || item.grade === 'A').length;
    const atRisk = leaderboard.filter((item) => Number(item.performanceScore) < 60).length;
    const activePenalties = penalties.filter((p) => p.status === 'ACTIVE').length;

    return { avgScore, topPerformers, atRisk, activePenalties };
  }, [leaderboard, penalties]);

  const getGradeBadge = (grade: string) => {
    switch (grade) {
      case 'A+':
        return <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">A+ Stellar</span>;
      case 'A':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">A Excellent</span>;
      case 'B':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">B Good</span>;
      case 'C':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">C Fair</span>;
      case 'D':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300">D Warning</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300">F Critical</span>;
    }
  };

  const getTierBadge = (tier: number, type: string) => {
    switch (tier) {
      case 1:
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Tier 1: Verbal Warning</span>;
      case 2:
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Tier 2: Minor Fine</span>;
      case 3:
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">Tier 3: Major Fine</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">Tier 4: Suspension</span>;
    }
  };

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Governance & Performance</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
              Disciplinary & Ratings
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Member performance scoring (60% Deposit Punctuality + 40% Meeting Attendance) and 4-tier escalating penalty management.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {canWrite && (
            <>
              <button
                onClick={handleRecalculateAll}
                disabled={isRecalculatingAll}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-800 dark:text-slate-200 text-sm font-medium rounded-lg transition-colors"
              >
                <RotateCcw className={`w-4 h-4 ${isRecalculatingAll ? 'animate-spin' : ''}`} />
                Recalculate All
              </button>

              <button
                onClick={() => {
                  setPenaltyTargetMemberId(members[0]?.id || '');
                  setPenaltyTier(1);
                  setPenaltyReason('');
                  setIsIssuePenaltyOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium rounded-lg shadow-sm transition-all"
              >
                <ShieldAlert className="w-4 h-4" />
                Issue Penalty
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Group Avg Score</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.avgScore}%</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Top Performers (A+/A)</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.topPerformers}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">At-Risk (&lt;60%)</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.atRisk}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Active Penalties</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.activePenalties}</h3>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setActiveTab('LEADERBOARD')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'LEADERBOARD'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Award className="w-4 h-4" />
          Performance Leaderboard ({leaderboard.length})
        </button>

        <button
          onClick={() => setActiveTab('PENALTIES')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'PENALTIES'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          Penalties & Disciplinary Log ({penalties.length})
        </button>
      </div>

      {/* TAB 1: LEADERBOARD */}
      {activeTab === 'LEADERBOARD' && (
        <div className="space-y-4">
          {/* Search & Grade Filter */}
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search member by name or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
              >
                <option value="ALL">All Grades</option>
                <option value="A+">A+ Stellar</option>
                <option value="A">A Excellent</option>
                <option value="B">B Good</option>
                <option value="C">C Fair</option>
                <option value="D">D Warning</option>
                <option value="F">F Critical</option>
              </select>
            </div>
          </div>

          {/* Leaderboard Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-4 text-center w-16">Rank</th>
                    <th className="p-4">Member</th>
                    <th className="p-4">Shares</th>
                    <th className="p-4 text-center">Performance Rating</th>
                    <th className="p-4 text-center">Disciplinary Warnings</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRowSkeleton key={`lb-skel-${i}`} columns={6} />
                    ))
                  ) : filteredLeaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No members found matching current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredLeaderboard.map((entry) => {
                      const score = Number(entry.performanceScore || 0);

                      return (
                        <tr key={entry.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition-colors">
                          <td className="p-4 text-center font-bold text-slate-700 dark:text-slate-300">
                            {entry.rank === 1 ? (
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 font-extrabold text-xs">
                                1
                              </span>
                            ) : entry.rank === 2 ? (
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold text-xs">
                                2
                              </span>
                            ) : entry.rank === 3 ? (
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-extrabold text-xs">
                                3
                              </span>
                            ) : (
                              `#${entry.rank}`
                            )}
                          </td>

                          <td className="p-4">
                            <div className="font-semibold text-slate-900 dark:text-white">{entry.name}</div>
                            <div className="text-xs text-slate-400">{entry.memberId} • {entry.role}</div>
                          </td>

                          <td className="p-4 font-medium text-slate-700 dark:text-slate-300">
                            {entry.shares || 1} Shares
                          </td>

                          <td className="p-4">
                            <div className="flex flex-col items-center gap-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-base font-bold text-slate-900 dark:text-white">{score.toFixed(1)}%</span>
                                {getGradeBadge(entry.grade)}
                              </div>
                              <div className="w-32 bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    score >= 85 ? 'bg-emerald-500' : score >= 70 ? 'bg-blue-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${score}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="p-4 text-center">
                            {(entry.warningCount ?? 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                {entry.warningCount} {entry.warningCount === 1 ? 'Warning' : 'Warnings'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                <ShieldCheck className="w-3.5 h-3.5" /> Clean Record
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleViewBreakdown(entry.id)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-semibold transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Breakdown
                              </button>

                              {canWrite && (
                                <button
                                  onClick={(e) => handleRecalculateSingle(entry.id, e)}
                                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                                  title="Refresh Score"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVE PENALTIES & DISCIPLINARY LOG */}
      {activeTab === 'PENALTIES' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700 text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-4">Member</th>
                  <th className="p-4">Tier & Policy</th>
                  <th className="p-4">Fund Deduction</th>
                  <th className="p-4">Reason / Violation</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Date Issued</th>
                  {isAdmin && <th className="p-4 text-right">Admin Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRowSkeleton key={`pen-skel-${i}`} columns={7} />
                  ))
                ) : penalties.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                      No penalties or disciplinary notices recorded. Clean record!
                    </td>
                  </tr>
                ) : (
                  penalties.map((pen) => {
                    const isWaived = pen.status === 'WAIVED';

                    return (
                      <tr key={pen.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                        <td className="p-4">
                          <div className="font-semibold text-slate-900 dark:text-white">{pen.memberName}</div>
                          <div className="text-xs text-slate-400">{pen.memberDisplayId}</div>
                        </td>

                        <td className="p-4">
                          <div className="space-y-1">
                            {getTierBadge(pen.tier, pen.type)}
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{pen.title}</div>
                          </div>
                        </td>

                        <td className="p-4 font-bold text-slate-900 dark:text-white">
                          {Number(pen.calculatedDeduction) > 0 ? (
                            <span className="text-rose-600 dark:text-rose-400">-{Number(pen.calculatedDeduction).toLocaleString()} {currencyCode}</span>
                          ) : (
                            <span className="text-slate-400 font-normal">0 {currencyCode} (Verbal)</span>
                          )}
                        </td>

                        <td className="p-4">
                          <p className="text-xs text-slate-600 dark:text-slate-300 max-w-xs">{pen.reason}</p>
                          {isWaived && pen.waiveReason && (
                            <p className="text-[11px] text-amber-600 italic mt-0.5">Waive Reason: {pen.waiveReason}</p>
                          )}
                        </td>

                        <td className="p-4">
                          {pen.status === 'ACTIVE' && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                              Active Penalty
                            </span>
                          )}
                          {pen.status === 'WAIVED' && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              Waived & Refunded
                            </span>
                          )}
                          {pen.status === 'RESOLVED' && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                              Resolved
                            </span>
                          )}
                        </td>

                        <td className="p-4 text-xs text-slate-500 dark:text-slate-400">
                          {new Date(pen.issuedAt || pen.createdAt).toLocaleDateString()}
                        </td>

                        {isAdmin && (
                          <td className="p-4 text-right">
                            {pen.status === 'ACTIVE' && (
                              <button
                                onClick={() => {
                                  setWaiveTargetPenalty(pen);
                                  setWaiveReason('');
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 rounded-lg text-xs font-semibold transition-colors"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                Waive & Refund
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PERFORMANCE BREAKDOWN MODAL */}
      {selectedMemberBreakdown && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <Award className="w-6 h-6 text-blue-600" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    {selectedMemberBreakdown.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Comprehensive Performance Rating & Governance Breakdown
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedMemberBreakdown(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {/* Overall Score Header */}
              <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-xl text-white flex items-center justify-between">
                <div>
                  <span className="text-xs uppercase tracking-wider text-blue-100 font-semibold">Total Performance Rating</span>
                  <div className="flex items-baseline gap-3 mt-1">
                    <h2 className="text-4xl font-extrabold">{selectedMemberBreakdown.overallScore.toFixed(1)}%</h2>
                    <span className="text-lg font-bold bg-white/20 px-3 py-0.5 rounded-full">
                      Grade {selectedMemberBreakdown.grade}
                    </span>
                  </div>
                </div>
                <Award className="w-14 h-14 text-white/30" />
              </div>

              {/* Deposit Punctuality (60%) */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                      1. Deposit Punctuality (60% Weight)
                    </h4>
                  </div>
                  <span className="text-xs font-bold text-emerald-600">
                    {selectedMemberBreakdown.depositMetrics.score.toFixed(1)} / 100 pts
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs pt-2">
                  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 block text-[11px]">On-Time</span>
                    <span className="font-bold text-emerald-600 text-base">
                      {selectedMemberBreakdown.depositMetrics.onTimeMonths}
                    </span>
                  </div>
                  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 block text-[11px]">Late</span>
                    <span className="font-bold text-amber-600 text-base">
                      {selectedMemberBreakdown.depositMetrics.lateMonths}
                    </span>
                  </div>
                  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 block text-[11px]">Missed</span>
                    <span className="font-bold text-rose-600 text-base">
                      {selectedMemberBreakdown.depositMetrics.missedMonths}
                    </span>
                  </div>
                </div>
              </div>

              {/* Meeting Attendance (40%) */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                      2. Meeting Attendance (40% Weight)
                    </h4>
                  </div>
                  <span className="text-xs font-bold text-blue-600">
                    {selectedMemberBreakdown.attendanceMetrics.score.toFixed(1)} / 100 pts
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs pt-2">
                  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 block text-[11px]">Present</span>
                    <span className="font-bold text-emerald-600 text-base">
                      {selectedMemberBreakdown.attendanceMetrics.presentCount}
                    </span>
                  </div>
                  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 block text-[11px]">Excused</span>
                    <span className="font-bold text-amber-600 text-base">
                      {selectedMemberBreakdown.attendanceMetrics.excusedCount}
                    </span>
                  </div>
                  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 block text-[11px]">Absent</span>
                    <span className="font-bold text-rose-600 text-base">
                      {selectedMemberBreakdown.attendanceMetrics.absentCount}
                    </span>
                  </div>
                </div>
              </div>

              {/* Penalty Deductions */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-600" />
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                      3. Disciplinary Point Deductions
                    </h4>
                  </div>
                  <span className="text-xs font-bold text-rose-600">
                    -{selectedMemberBreakdown.penaltyMetrics.totalDeductionPoints} pts
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedMemberBreakdown.penaltyMetrics.activePenaltiesCount} active penalties registered.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ISSUE PENALTY MODAL */}
      {isIssuePenaltyOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700 bg-rose-50/50 dark:bg-rose-900/20">
              <div className="flex items-center gap-2 text-rose-600">
                <ShieldAlert className="w-5 h-5" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Issue Member Penalty</h3>
              </div>
              <button
                onClick={() => setIsIssuePenaltyOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleIssuePenaltySubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Select Member *
                </label>
                <select
                  required
                  value={penaltyTargetMemberId}
                  onChange={(e) => setPenaltyTargetMemberId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 dark:text-white"
                >
                  <option value="" disabled>Choose a member...</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.memberId || 'ID'}) - {m.role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Escalating Penalty Tier *
                </label>
                <select
                  value={penaltyTier}
                  onChange={(e) => setPenaltyTier(parseInt(e.target.value, 10) as 1 | 2 | 3 | 4)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 dark:text-white font-medium"
                >
                  <option value={1}>Tier 1: 1st Offense - Verbal Warning (0 BDT fine, -5 pts)</option>
                  <option value={2}>Tier 2: 2nd Offense - Minor Fine (50 BDT deduction, -10 pts)</option>
                  <option value={3}>Tier 3: 3rd Offense - Major Fine (200 BDT deduction, -20 pts)</option>
                  <option value={4}>Tier 4: 4th Offense - Suspension & 500 BDT fine (-35 pts)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Reason & Context *
                </label>
                <textarea
                  required
                  rows={3}
                  value={penaltyReason}
                  onChange={(e) => setPenaltyReason(e.target.value)}
                  placeholder="Describe the violation, missed deadline, or behavioral offense..."
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsIssuePenaltyOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPenalty}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {isSubmittingPenalty ? 'Processing...' : 'Confirm Penalty'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WAIVE PENALTY MODAL */}
      {waiveTargetPenalty && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700 bg-amber-50/50 dark:bg-amber-900/20">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <Undo2 className="w-5 h-5" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Waive Penalty & Refund</h3>
              </div>
              <button
                onClick={() => setWaiveTargetPenalty(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleWaivePenaltySubmit} className="p-6 space-y-4">
              <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg text-xs space-y-1">
                <div><strong>Member:</strong> {waiveTargetPenalty.memberName}</div>
                <div><strong>Tier:</strong> Tier {waiveTargetPenalty.tier} ({waiveTargetPenalty.title})</div>
                <div><strong>Refund Amount:</strong> {waiveTargetPenalty.calculatedDeduction} {currencyCode}</div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Reason for Waiver *
                </label>
                <textarea
                  required
                  rows={3}
                  value={waiveReason}
                  onChange={(e) => setWaiveReason(e.target.value)}
                  placeholder="Explain why this penalty is being waived and refunded..."
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setWaiveTargetPenalty(null)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingWaive}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {isSubmittingWaive ? 'Processing...' : 'Confirm Waiver & Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default GovernancePerformance;
