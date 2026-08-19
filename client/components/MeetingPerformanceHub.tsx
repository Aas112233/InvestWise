import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Play,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Trash2,
  X,
  ShieldAlert,
  ChevronRight,
  UserCheck,
  UserX,
  FileText,
  DollarSign,
  Award,
  TrendingUp,
  RotateCcw,
  ShieldCheck,
  Undo2,
  Edit3,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { meetingsService, governanceService, memberService } from '../services/api';
import {
  Meeting,
  MeetingAttendee,
  Member,
  User,
  AccessLevel,
  LeaderboardEntry,
  MemberPenalty,
  PerformanceBreakdown,
  AppScreen,
} from '../types';
import { Language } from '../i18n/translations';
import Toast from './Toast';
import { TableSkeleton } from './ui/Skeleton';
import { useGlobalState } from '../context/GlobalStateContext';
import { InlineTopForm } from './ui/InlineTopForm';
import { checkUserPermission } from '../utils/permissions';

interface MeetingPerformanceHubProps {
  lang: Language;
  currentUser?: User | null;
  defaultTab?: 'MEETINGS' | 'POST_REVIEW' | 'LEADERBOARD' | 'PENALTIES';
}

export const MeetingPerformanceHub: React.FC<MeetingPerformanceHubProps> = ({ currentUser, defaultTab = 'MEETINGS' }) => {
  const { currencyCode } = useGlobalState();
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'MEETINGS' | 'POST_REVIEW' | 'LEADERBOARD' | 'PENALTIES'>(defaultTab);

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  // Core Data
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [penalties, setPenalties] = useState<MemberPenalty[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Selected Meeting for Post-Meeting Review Tab
  const [selectedReviewMeetingId, setSelectedReviewMeetingId] = useState<string>('');
  const [reviewMeetingDetails, setReviewMeetingDetails] = useState<Meeting | null>(null);
  const [isLoadingReviewMeeting, setIsLoadingReviewMeeting] = useState<boolean>(false);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [gradeFilter, setGradeFilter] = useState<string>('ALL');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isLiveRoomOpen, setIsLiveRoomOpen] = useState<boolean>(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);

  // Manual Score Adjustment Modal
  const [adjustScoreTarget, setAdjustScoreTarget] = useState<{ id: string; name: string; currentScore: number } | null>(null);
  const [newScoreInput, setNewScoreInput] = useState<number>(100);
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [isSubmittingAdjustScore, setIsSubmittingAdjustScore] = useState<boolean>(false);

  // Breakdown Modal
  const [selectedMemberBreakdown, setSelectedMemberBreakdown] = useState<PerformanceBreakdown | null>(null);

  // Penalty Modal
  const [isPenaltyModalOpen, setIsPenaltyModalOpen] = useState<boolean>(false);
  const [penaltyTargetMemberId, setPenaltyTargetMemberId] = useState<string>('');
  const [penaltyTier, setPenaltyTier] = useState<1 | 2 | 3 | 4>(1);
  const [penaltyReason, setPenaltyReason] = useState<string>('');
  const [isSubmittingPenalty, setIsSubmittingPenalty] = useState<boolean>(false);

  // Waive Penalty Modal
  const [waiveTargetPenalty, setWaiveTargetPenalty] = useState<MemberPenalty | null>(null);
  const [waiveReason, setWaiveReason] = useState<string>('');
  const [isSubmittingWaive, setIsSubmittingWaive] = useState<boolean>(false);

  // Form State for Scheduling Meeting
  const [meetingFormData, setMeetingFormData] = useState({
    title: '',
    meetingType: 'FOUNDING_MEMBER',
    meetingDate: new Date().toISOString().slice(0, 16),
    location: 'Main HQ / Google Meet',
    agenda: '',
    notes: '',
  });
  const [isSubmittingMeeting, setIsSubmittingMeeting] = useState<boolean>(false);
  const [isSavingAttendance, setIsSavingAttendance] = useState<boolean>(false);
  const [isCompletingMeeting, setIsCompletingMeeting] = useState<boolean>(false);

  // Global Actions State
  const [isRecalculatingAll, setIsRecalculatingAll] = useState<boolean>(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Permissions
  const canWrite = useMemo(() => {
    return checkUserPermission(currentUser, AppScreen.MEMBERS, AccessLevel.WRITE);
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
      const [meetingsRes, membersRes, leaderboardRes, penaltiesRes] = await Promise.all([
        meetingsService.getMeetings({ limit: 100 }),
        memberService.getAll(),
        governanceService.getLeaderboard(),
        governanceService.getPenalties({ limit: 100 }),
      ]);

      const mList = Array.isArray(meetingsRes?.data) ? meetingsRes.data : Array.isArray(meetingsRes) ? meetingsRes : [];
      setMeetings(mList);

      const memList = Array.isArray(membersRes?.data) ? membersRes.data : Array.isArray(membersRes) ? membersRes : [];
      setMembers(memList);

      const lData = Array.isArray(leaderboardRes?.data) ? leaderboardRes.data : Array.isArray(leaderboardRes) ? leaderboardRes : [];
      setLeaderboard(lData);

      const pData = Array.isArray(penaltiesRes?.data) ? penaltiesRes.data : Array.isArray(penaltiesRes) ? penaltiesRes : [];
      setPenalties(pData);

      // Default review meeting if not set
      if (!selectedReviewMeetingId && mList.length > 0) {
        const completedOrFirst = mList.find((m: Meeting) => m.status === 'COMPLETED') || mList[0];
        setSelectedReviewMeetingId(completedOrFirst.id);
      }
    } catch (err: unknown) {
      console.error('Failed to load hub data:', err);
      showToast('Failed to load meeting and performance records', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedReviewMeetingId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load Review Meeting Details when selected
  useEffect(() => {
    if (!selectedReviewMeetingId) return;

    const fetchReviewMeeting = async () => {
      try {
        setIsLoadingReviewMeeting(true);
        const fullMeeting = await meetingsService.getMeetingById(selectedReviewMeetingId);
        setReviewMeetingDetails(fullMeeting);
      } catch (err) {
        console.error('Failed to fetch review meeting:', err);
      } finally {
        setIsLoadingReviewMeeting(false);
      }
    };

    fetchReviewMeeting();
  }, [selectedReviewMeetingId]);

  // Handle Recalculate All
  const handleRecalculateAll = async () => {
    try {
      setIsRecalculatingAll(true);
      await governanceService.recalculateAllPerformance();
      showToast('All member performance scores refreshed!');
      await loadData();
    } catch (err: unknown) {
      console.error('Failed to recalculate scores:', err);
      showToast('Failed to recalculate performance scores', 'error');
    } finally {
      setIsRecalculatingAll(false);
    }
  };

  // Schedule Meeting
  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingMeeting) return;

    try {
      setIsSubmittingMeeting(true);
      await meetingsService.createMeeting(meetingFormData);
      showToast('Meeting scheduled successfully!');
      setIsCreateModalOpen(false);
      setMeetingFormData({
        title: '',
        meetingType: 'FOUNDING_MEMBER',
        meetingDate: new Date().toISOString().slice(0, 16),
        location: 'Main HQ / Google Meet',
        agenda: '',
        notes: '',
      });
      await loadData();
    } catch (err: unknown) {
      console.error('Failed to create meeting:', err);
      showToast(err instanceof Error ? err.message : 'Failed to schedule meeting', 'error');
    } finally {
      setIsSubmittingMeeting(false);
    }
  };

  // Start Meeting
  const handleStartMeeting = async (meetingId: string) => {
    try {
      const updated = await meetingsService.startMeeting(meetingId);
      showToast('Meeting session started!');
      loadData();
      const full = await meetingsService.getMeetingById(updated.id || meetingId);
      setActiveMeeting(full);
      setIsLiveRoomOpen(true);
    } catch (err: unknown) {
      console.error('Failed to start meeting:', err);
      showToast(err instanceof Error ? err.message : 'Failed to start meeting', 'error');
    }
  };

  // Toggle Attendance in Live Room
  const handleToggleAttendance = (memberId: string, status: 'PRESENT' | 'ABSENT' | 'EXCUSED') => {
    if (!activeMeeting || !activeMeeting.attendees) return;

    const updatedAttendees = activeMeeting.attendees.map((att) =>
      att.memberId === memberId ? { ...att, attendanceStatus: status } : att,
    );

    setActiveMeeting({
      ...activeMeeting,
      attendees: updatedAttendees,
    });
  };

  // Save Attendance Progress
  const handleSaveAttendance = async (closeOnSave: boolean = true) => {
    if (!activeMeeting || !activeMeeting.attendees || isSavingAttendance) return;

    try {
      setIsSavingAttendance(true);
      const payload = activeMeeting.attendees.map((att) => ({
        memberId: att.memberId,
        attendanceStatus: att.attendanceStatus,
        notes: att.notes || '',
      }));

      await meetingsService.recordAttendance(activeMeeting.id, payload);
      showToast('Attendance records saved successfully!');
      if (closeOnSave) {
        setIsLiveRoomOpen(false);
        setActiveMeeting(null);
      }
      await loadData();
    } catch (err: unknown) {
      console.error('Failed to save attendance:', err);
      showToast('Failed to save attendance', 'error');
    } finally {
      setIsSavingAttendance(false);
    }
  };

  // Complete Meeting
  const handleCompleteMeeting = async () => {
    if (!activeMeeting || isCompletingMeeting) return;
    if (!window.confirm('Are you sure you want to finalize this meeting? This will evaluate deposit deadlines and refresh scores.')) {
      return;
    }

    try {
      setIsCompletingMeeting(true);
      await handleSaveAttendance(false);
      await meetingsService.completeMeeting(activeMeeting.id, activeMeeting.notes);
      showToast('Meeting successfully completed and performance scores updated!');
      setIsLiveRoomOpen(false);
      setSelectedReviewMeetingId(activeMeeting.id);
      setActiveMeeting(null);
      setActiveTab('POST_REVIEW');
      await loadData();
    } catch (err: unknown) {
      console.error('Failed to complete meeting:', err);
      showToast('Failed to complete meeting', 'error');
    } finally {
      setIsCompletingMeeting(false);
    }
  };

  // Open Live Room
  const handleOpenLiveRoom = async (meeting: Meeting) => {
    try {
      const full = await meetingsService.getMeetingById(meeting.id);
      setActiveMeeting(full);
      setIsLiveRoomOpen(true);
    } catch (err) {
      showToast('Failed to open meeting room', 'error');
    }
  };

  // Open Detail Modal
  const handleOpenDetailModal = async (meeting: Meeting) => {
    try {
      const full = await meetingsService.getMeetingById(meeting.id);
      setActiveMeeting(full);
      setIsDetailModalOpen(true);
    } catch (err) {
      showToast('Failed to load meeting details', 'error');
    }
  };

  // Delete Meeting
  const handleDeleteMeeting = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this scheduled meeting?')) return;
    try {
      await meetingsService.deleteMeeting(id);
      showToast('Meeting deleted');
      loadData();
    } catch (err: unknown) {
      showToast('Failed to delete meeting', 'error');
    }
  };

  // Submit Manual Score Adjustment
  const handleAdjustScoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustScoreTarget) return;

    try {
      setIsSubmittingAdjustScore(true);
      await governanceService.adjustMemberPerformance(adjustScoreTarget.id, newScoreInput, adjustReason);
      showToast(`Performance score for ${adjustScoreTarget.name} updated to ${newScoreInput}%!`);
      setAdjustScoreTarget(null);
      setAdjustReason('');
      await loadData();

      // Refresh review meeting if currently open
      if (selectedReviewMeetingId) {
        const fullMeeting = await meetingsService.getMeetingById(selectedReviewMeetingId);
        setReviewMeetingDetails(fullMeeting);
      }
    } catch (err: unknown) {
      console.error('Failed to adjust score:', err);
      showToast(err instanceof Error ? err.message : 'Failed to adjust score', 'error');
    } finally {
      setIsSubmittingAdjustScore(false);
    }
  };

  // Issue Penalty Submit
  const handleIssuePenaltySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!penaltyTargetMemberId) {
      showToast('Please choose a member', 'error');
      return;
    }

    try {
      setIsSubmittingPenalty(true);
      await governanceService.issuePenalty({
        memberId: penaltyTargetMemberId,
        meetingId: selectedReviewMeetingId || activeMeeting?.id,
        tier: penaltyTier,
        reason: penaltyReason,
      });

      showToast(`Tier ${penaltyTier} penalty successfully issued!`);
      setIsPenaltyModalOpen(false);
      setPenaltyReason('');
      await loadData();

      if (selectedReviewMeetingId) {
        const fullMeeting = await meetingsService.getMeetingById(selectedReviewMeetingId);
        setReviewMeetingDetails(fullMeeting);
      }
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
      showToast(`Penalty waived and ${waiveTargetPenalty.calculatedDeduction} ${currencyCode} refunded!`);
      setWaiveTargetPenalty(null);
      setWaiveReason('');
      loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to waive penalty', 'error');
    } finally {
      setIsSubmittingWaive(false);
    }
  };

  // View Member Breakdown
  const handleViewBreakdown = async (memberId: string) => {
    try {
      const breakdown = await governanceService.getMemberPerformance(memberId);
      setSelectedMemberBreakdown(breakdown);
    } catch (err) {
      showToast('Failed to load performance breakdown', 'error');
    }
  };

  // Metrics
  const summaryMetrics = useMemo(() => {
    const totalMeetings = meetings.length;
    const scheduled = meetings.filter((m) => m.status === 'SCHEDULED').length;
    const completed = meetings.filter((m) => m.status === 'COMPLETED').length;
    const avgScore = leaderboard.length > 0
      ? Math.round(leaderboard.reduce((s, r) => s + Number(r.performanceScore ?? 100), 0) / leaderboard.length)
      : 100;
    const activePenalties = penalties.filter((p) => p.status === 'ACTIVE').length;

    return { totalMeetings, scheduled, completed, avgScore, activePenalties };
  }, [meetings, leaderboard, penalties]);

  const getGradeBadge = (grade: string) => {
    switch (grade) {
      case 'A+':
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">A+ Stellar</span>;
      case 'A':
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">A Excellent</span>;
      case 'B':
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">B Good</span>;
      case 'C':
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">C Fair</span>;
      case 'D':
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300">D Warning</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300">F Critical</span>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
            Live In Progress
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
            <X className="w-3.5 h-3.5" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <Clock className="w-3.5 h-3.5" />
            Scheduled
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Top Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-sm">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                Meeting & Performance Management
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Unified Governance Center • Schedule Sessions, Track Live Attendance, Post-Meeting Member Ratings & 4-Tier Penalties
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {canWrite && (
            <>
              <button
                onClick={handleRecalculateAll}
                disabled={isRecalculatingAll}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors"
              >
                <RotateCcw className={`w-4 h-4 ${isRecalculatingAll ? 'animate-spin' : ''}`} />
                Recalculate Scores
              </button>

              <button
                onClick={() => {
                  setPenaltyTargetMemberId(members[0]?.id || '');
                  setPenaltyTier(1);
                  setPenaltyReason('');
                  setIsPenaltyModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
              >
                <ShieldAlert className="w-4 h-4" />
                Issue Penalty
              </button>

              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                Schedule Meeting
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Sessions</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white">{summaryMetrics.totalMeetings}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Upcoming</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white">{summaryMetrics.scheduled}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Group Avg Score</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white">{summaryMetrics.avgScore}%</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Active Fines/Penalties</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white">{summaryMetrics.activePenalties}</span>
          </div>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('MEETINGS')}
          className={`pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'MEETINGS'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Calendar className="w-4 h-4" />
          1. Meetings & Live Sessions ({meetings.length})
        </button>

        <button
          onClick={() => setActiveTab('POST_REVIEW')}
          className={`pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'POST_REVIEW'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Edit3 className="w-4 h-4" />
          2. Post-Meeting Scoring & Review
        </button>

        <button
          onClick={() => setActiveTab('LEADERBOARD')}
          className={`pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'LEADERBOARD'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Award className="w-4 h-4" />
          3. Performance Leaderboard ({leaderboard.length})
        </button>

        <button
          onClick={() => setActiveTab('PENALTIES')}
          className={`pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'PENALTIES'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          4. Disciplinary Penalties Log ({penalties.length})
        </button>
      </div>

      {/* TAB 1: MEETINGS LIST & SCHEDULING */}
      {activeTab === 'MEETINGS' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search meetings..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs px-3 py-2 dark:text-white"
              >
                <option value="ALL">All Statuses</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="IN_PROGRESS">Live In Progress</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {meetings.map((meeting) => {
              const isLive = meeting.status === 'IN_PROGRESS';
              const isScheduled = meeting.status === 'SCHEDULED';
              const isCompleted = meeting.status === 'COMPLETED';

              return (
                <div
                  key={meeting.id}
                  className={`bg-white dark:bg-slate-800 p-5 rounded-xl border transition-all ${
                    isLive ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-900/10' : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{meeting.title}</h3>
                        {getStatusBadge(meeting.status)}
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                          {meeting.meetingType}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {new Date(meeting.meetingDate).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {new Date(meeting.meetingDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {meeting.location || 'HQ'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isScheduled && canWrite && (
                        <button
                          onClick={() => handleStartMeeting(meeting.id)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                        >
                          <Play className="w-3.5 h-3.5" /> Start Meeting
                        </button>
                      )}

                      {isLive && (
                        <button
                          onClick={() => handleOpenLiveRoom(meeting)}
                          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 animate-pulse"
                        >
                          <Users className="w-3.5 h-3.5" /> Enter Live Room
                        </button>
                      )}

                      {isCompleted && (
                        <button
                          onClick={() => {
                            setSelectedReviewMeetingId(meeting.id);
                            setActiveTab('POST_REVIEW');
                          }}
                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 rounded-lg text-xs font-bold flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Review & Score Attendees
                        </button>
                      )}

                      <button
                        onClick={() => handleOpenDetailModal(meeting)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                        title="View Minutes"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      {isScheduled && canWrite && (
                        <button
                          onClick={(e) => handleDeleteMeeting(meeting.id, e)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: POST-MEETING SCORING & REVIEW */}
      {activeTab === 'POST_REVIEW' && (
        <div className="space-y-5">
          {/* Meeting Selector Header */}
          <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest block">Post-Session Evaluation</span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Review & Adjust Attendee Performance Scores</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Select a completed meeting session to review attendance, evaluate member deposit deadlines, override individual scores, or issue disciplinary fines.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">Session:</label>
              <select
                value={selectedReviewMeetingId}
                onChange={(e) => setSelectedReviewMeetingId(e.target.value)}
                className="px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({new Date(m.meetingDate).toLocaleDateString()}) - {m.status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isLoadingReviewMeeting ? (
            <TableSkeleton rows={5} columns={5} showHeader={false} />
          ) : !reviewMeetingDetails ? (
            <div className="p-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 text-center text-slate-500">
              Please select a meeting to inspect attendee ratings.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Meeting Summary Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Session Agenda</span>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{reviewMeetingDetails.agenda || 'General Meeting'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Total Registered Attendees</span>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{reviewMeetingDetails.attendees?.length || 0} Members</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Status</span>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{reviewMeetingDetails.status}</p>
                </div>
              </div>

              {/* Attendees Review Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reviewMeetingDetails.attendees?.map((att) => {
                  const memberRecord = members.find((m) => m.id === att.memberId);
                  const currentScore = Number(memberRecord?.performanceScore ?? att.performanceScore ?? 100);

                  return (
                    <div
                      key={att.memberId}
                      className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 shadow-sm hover:shadow transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{att.name}</h4>
                          <span className="text-[11px] text-slate-400">{att.displayId} • {att.role}</span>
                        </div>

                        <div className="text-right">
                          <span className="text-base font-black text-slate-900 dark:text-white">{currentScore.toFixed(1)}%</span>
                          <span className="text-[10px] text-slate-400 block font-bold">Overall Rating</span>
                        </div>
                      </div>

                      {/* Status Badges */}
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-700/60 text-xs">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          att.attendanceStatus === 'PRESENT' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' :
                          att.attendanceStatus === 'EXCUSED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' :
                          'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                        }`}>
                          {att.attendanceStatus}
                        </span>

                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          att.depositStatus === 'PAID_ON_TIME' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30' :
                          att.depositStatus === 'PAID_LATE' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30' :
                          'bg-rose-50 text-rose-700 dark:bg-rose-900/30'
                        }`}>
                          {att.depositStatus?.replace(/_/g, ' ')}
                        </span>
                      </div>

                      {/* Quick Actions */}
                      {canWrite && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                          <button
                            onClick={() => {
                              setAdjustScoreTarget({ id: att.memberId, name: att.name || 'Member', currentScore });
                              setNewScoreInput(currentScore);
                              setAdjustReason(`Post-Meeting Assessment (${reviewMeetingDetails.title})`);
                            }}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-lg text-xs font-bold flex items-center gap-1"
                          >
                            <Sliders className="w-3.5 h-3.5" /> Adjust Score
                          </button>

                          <button
                            onClick={() => {
                              setPenaltyTargetMemberId(att.memberId);
                              setPenaltyTier(1);
                              setPenaltyReason(`Meeting Disciplinary Notice: ${reviewMeetingDetails.title}`);
                              setIsPenaltyModalOpen(true);
                            }}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 rounded-lg text-xs font-bold flex items-center gap-1"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" /> Issue Fine
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PERFORMANCE LEADERBOARD */}
      {activeTab === 'LEADERBOARD' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search leaderboard..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs px-3 py-2 dark:text-white"
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
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-3.5 text-center w-12">Rank</th>
                  <th className="p-3.5">Member</th>
                  <th className="p-3.5">Shares</th>
                  <th className="p-3.5 text-center">Score & Grade</th>
                  <th className="p-3.5 text-center">Warnings</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {leaderboard.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                    <td className="p-3.5 text-center font-bold">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-black ${
                        entry.rank === 1 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' :
                        entry.rank === 2 ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' :
                        entry.rank === 3 ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' :
                        'text-slate-500'
                      }`}>
                        {entry.rank}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="font-bold text-slate-900 dark:text-white">{entry.name}</div>
                      <div className="text-[10px] text-slate-400">{entry.memberId} • {entry.role}</div>
                    </td>
                    <td className="p-3.5 font-medium">{entry.shares} Shares</td>
                    <td className="p-3.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-sm font-black">{Number(entry.performanceScore).toFixed(1)}%</span>
                        {getGradeBadge(entry.grade)}
                      </div>
                    </td>
                    <td className="p-3.5 text-center">
                      {(entry.warningCount ?? 0) > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-bold text-[10px]">
                          {entry.warningCount} Warning(s)
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-medium text-[11px]">Clean</span>
                      )}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleViewBreakdown(entry.id)}
                          className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-bold"
                        >
                          Breakdown
                        </button>
                        {canWrite && (
                          <button
                            onClick={() => {
                              setAdjustScoreTarget({ id: entry.id, name: entry.name, currentScore: Number(entry.performanceScore) });
                              setNewScoreInput(Number(entry.performanceScore));
                              setAdjustReason('Admin Score Adjustment');
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-bold"
                          >
                            Adjust
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: DISCIPLINARY & PENALTIES LOG */}
      {activeTab === 'PENALTIES' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">
              <tr>
                <th className="p-3.5">Member</th>
                <th className="p-3.5">Tier</th>
                <th className="p-3.5">Fine Deduction</th>
                <th className="p-3.5">Reason</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Date</th>
                {isAdmin && <th className="p-3.5 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {penalties.map((pen) => (
                <tr key={pen.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                  <td className="p-3.5">
                    <div className="font-bold text-slate-900 dark:text-white">{pen.memberName}</div>
                    <div className="text-[10px] text-slate-400">{pen.memberDisplayId}</div>
                  </td>
                  <td className="p-3.5 font-bold">Tier {pen.tier}: {pen.title}</td>
                  <td className="p-3.5 font-bold text-rose-600">
                    {Number(pen.calculatedDeduction) > 0 ? `-${pen.calculatedDeduction} ${currencyCode}` : `0 ${currencyCode} (Verbal)`}
                  </td>
                  <td className="p-3.5 max-w-xs">{pen.reason}</td>
                  <td className="p-3.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      pen.status === 'ACTIVE' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {pen.status}
                    </span>
                  </td>
                  <td className="p-3.5 text-slate-400">{new Date(pen.issuedAt || pen.createdAt).toLocaleDateString()}</td>
                  {isAdmin && (
                    <td className="p-3.5 text-right">
                      {pen.status === 'ACTIVE' && (
                        <button
                          onClick={() => {
                            setWaiveTargetPenalty(pen);
                            setWaiveReason('');
                          }}
                          className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded text-xs font-bold"
                        >
                          Waive & Refund
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SCHEDULE MEETING MODAL */}
      <InlineTopForm
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Schedule New Session"
        subtitle="Configure meeting details, schedule date, and sync attendees"
        onSubmit={handleCreateMeeting}
        submitLabel="Schedule Session"
        loading={isSubmittingMeeting}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="md:col-span-2">
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Meeting Title *
            </label>
            <input
              type="text"
              required
              value={meetingFormData.title}
              onChange={(e) => setMeetingFormData({ ...meetingFormData, title: e.target.value })}
              placeholder="e.g. Founding Member Strategy Meeting"
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Meeting Type *
            </label>
            <select
              value={meetingFormData.meetingType}
              onChange={(e) => setMeetingFormData({ ...meetingFormData, meetingType: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="FOUNDING_MEMBER">Founding Member</option>
              <option value="SHAREHOLDER">Shareholder</option>
              <option value="INVESTOR">Investor</option>
              <option value="GENERAL">General</option>
            </select>
          </div>

          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Date & Time *
            </label>
            <input
              type="datetime-local"
              required
              value={meetingFormData.meetingDate}
              onChange={(e) => setMeetingFormData({ ...meetingFormData, meetingDate: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Location / Link
            </label>
            <input
              type="text"
              value={meetingFormData.location}
              onChange={(e) => setMeetingFormData({ ...meetingFormData, location: e.target.value })}
              placeholder="e.g. Conference Room A / Zoom Link"
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Agenda Items & Description
            </label>
            <textarea
              rows={3}
              value={meetingFormData.agenda}
              onChange={(e) => setMeetingFormData({ ...meetingFormData, agenda: e.target.value })}
              placeholder="Outline session topics, key discussions, and goals..."
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </InlineTopForm>

      {/* ADJUST SCORE MODAL */}
      <InlineTopForm
        isOpen={!!adjustScoreTarget}
        onClose={() => setAdjustScoreTarget(null)}
        title="Adjust Member Performance Score"
        subtitle={`Manual rating adjustment for ${adjustScoreTarget?.name || 'Member'}`}
        onSubmit={handleAdjustScoreSubmit}
        submitLabel="Save Rating"
        loading={isSubmittingAdjustScore}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Target Member
            </label>
            <div className="px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white">
              {adjustScoreTarget?.name} (Current: {adjustScoreTarget?.currentScore}%)
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              New Performance Score (0–100%) *
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              required
              value={newScoreInput}
              onChange={(e) => setNewScoreInput(parseFloat(e.target.value) || 0)}
              className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-sm bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Reason / Assessment Notes
            </label>
            <textarea
              rows={3}
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="e.g. Active participation in assembly and exceptional project contributions..."
              className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-900 text-xs dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </InlineTopForm>

      {/* ISSUE PENALTY MODAL */}
      <InlineTopForm
        isOpen={isPenaltyModalOpen}
        onClose={() => setIsPenaltyModalOpen(false)}
        title="Issue Member Penalty / Fine"
        subtitle="Select member and apply governance tier fine or penalty"
        onSubmit={handleIssuePenaltySubmit}
        submitLabel="Issue Penalty"
        loading={isSubmittingPenalty}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Select Target Member *
            </label>
            <select
              value={penaltyTargetMemberId}
              onChange={(e) => setPenaltyTargetMemberId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.memberId || 'ID'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Penalty Tier *
            </label>
            <select
              value={penaltyTier}
              onChange={(e) => setPenaltyTier(parseInt(e.target.value, 10) as 1 | 2 | 3 | 4)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 focus:ring-2 focus:ring-rose-500 focus:outline-none"
            >
              <option value={1}>Tier 1: Verbal Warning (0 {currencyCode}, -5 pts)</option>
              <option value={2}>Tier 2: Minor Fine (50 {currencyCode} fine, -10 pts)</option>
              <option value={3}>Tier 3: Major Fine (200 {currencyCode} fine, -20 pts)</option>
              <option value={4}>Tier 4: Suspension & Fine (500 {currencyCode}, -35 pts)</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1 uppercase tracking-wider text-[10px]">
              Violation Reason *
            </label>
            <textarea
              required
              rows={3}
              value={penaltyReason}
              onChange={(e) => setPenaltyReason(e.target.value)}
              placeholder="State the governance violation, unexcused absence, or non-compliance detail..."
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </InlineTopForm>

      {/* WAIVE PENALTY MODAL */}
      <InlineTopForm
        isOpen={!!waiveTargetPenalty}
        onClose={() => setWaiveTargetPenalty(null)}
        title="Waive Penalty & Refund Fine"
        subtitle={`Approve governance fine reversal for ${waiveTargetPenalty?.memberName || 'Member'}`}
        onSubmit={handleWaivePenaltySubmit}
        submitLabel="Waive & Refund"
        loading={isSubmittingWaive}
      >
        <div className="space-y-4 text-xs">
          <div className="bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
            <p className="text-slate-800 dark:text-slate-200"><strong>Member:</strong> {waiveTargetPenalty?.memberName}</p>
            <p className="text-slate-800 dark:text-slate-200"><strong>Fine to Refund:</strong> {waiveTargetPenalty?.calculatedDeduction} {currencyCode}</p>
          </div>
          <div>
            <label className="font-bold block mb-1 text-[10px] uppercase tracking-wider text-slate-700 dark:text-slate-300">Reason for Waiver *</label>
            <textarea
              required
              rows={3}
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              placeholder="State reason for waiving this penalty..."
              className="w-full px-3.5 py-2.5 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
            />
          </div>
        </div>
      </InlineTopForm>

      {/* LIVE ROOM MODAL */}
      {isLiveRoomOpen && activeMeeting && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-3">
          <div className="bg-white dark:bg-slate-800 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border flex flex-col overflow-hidden text-xs">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{activeMeeting.title} (Live Session)</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSaveAttendance(true)}
                  disabled={isSavingAttendance || isCompletingMeeting}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 rounded font-bold flex items-center gap-1 transition-all disabled:opacity-50"
                >
                  {isSavingAttendance && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {isSavingAttendance ? 'Saving...' : 'Save & Close'}
                </button>
                <button
                  onClick={handleCompleteMeeting}
                  disabled={isCompletingMeeting || isSavingAttendance}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold flex items-center gap-1 transition-all shadow-sm disabled:opacity-50"
                >
                  {isCompletingMeeting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {isCompletingMeeting ? 'Finalizing...' : 'Finish Meeting'}
                </button>
                <button
                  onClick={() => setIsLiveRoomOpen(false)}
                  disabled={isCompletingMeeting}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              <table className="w-full text-left">
                <thead className="bg-slate-100 dark:bg-slate-900 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Member</th>
                    <th className="p-2.5">Deposit Status</th>
                    <th className="p-2.5 text-center">Attendance</th>
                    <th className="p-2.5 text-right">Penalty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {activeMeeting.attendees?.map((att) => (
                    <tr key={att.memberId}>
                      <td className="p-2.5 font-bold text-slate-900 dark:text-white">{att.name}</td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          att.depositStatus === 'PAID_ON_TIME' ? 'bg-emerald-100 text-emerald-800' :
                          att.depositStatus === 'PAID_LATE' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {att.depositStatus?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => handleToggleAttendance(att.memberId, 'PRESENT')}
                            className={`px-2 py-0.5 rounded font-bold ${att.attendanceStatus === 'PRESENT' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                          >
                            Present
                          </button>
                          <button
                            onClick={() => handleToggleAttendance(att.memberId, 'EXCUSED')}
                            className={`px-2 py-0.5 rounded font-bold ${att.attendanceStatus === 'EXCUSED' ? 'bg-amber-600 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                          >
                            Excused
                          </button>
                          <button
                            onClick={() => handleToggleAttendance(att.memberId, 'ABSENT')}
                            className={`px-2 py-0.5 rounded font-bold ${att.attendanceStatus === 'ABSENT' ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-700'}`}
                          >
                            Absent
                          </button>
                        </div>
                      </td>
                      <td className="p-2.5 text-right">
                        <button
                          onClick={() => {
                            setPenaltyTargetMemberId(att.memberId);
                            setPenaltyTier(1);
                            setPenaltyReason(`In-Meeting Notice: ${activeMeeting.title}`);
                            setIsPenaltyModalOpen(true);
                          }}
                          className="px-2 py-1 bg-rose-50 text-rose-700 rounded font-bold text-[10px]"
                        >
                          Issue Fine
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PERFORMANCE BREAKDOWN MODAL */}
      {selectedMemberBreakdown && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-blue-50 dark:bg-blue-900/20">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{selectedMemberBreakdown.name} - Performance Report</h3>
              <button onClick={() => setSelectedMemberBreakdown(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 rounded-xl text-white flex justify-between items-center">
                <div>
                  <span className="text-[10px] uppercase font-bold text-blue-200">Overall Rating</span>
                  <div className="text-3xl font-black">{selectedMemberBreakdown.overallScore.toFixed(1)}%</div>
                </div>
                <span className="px-3 py-1 rounded-full bg-white/20 font-black text-sm">Grade {selectedMemberBreakdown.grade}</span>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg space-y-1">
                <span className="font-bold block">1. Deposit Punctuality (60% Weight): {selectedMemberBreakdown.depositMetrics.score.toFixed(1)}/100</span>
                <p className="text-slate-400">On-Time: {selectedMemberBreakdown.depositMetrics.onTimeMonths} • Late: {selectedMemberBreakdown.depositMetrics.lateMonths} • Missed: {selectedMemberBreakdown.depositMetrics.missedMonths}</p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg space-y-1">
                <span className="font-bold block">2. Meeting Attendance (40% Weight): {selectedMemberBreakdown.attendanceMetrics.score.toFixed(1)}/100</span>
                <p className="text-slate-400">Present: {selectedMemberBreakdown.attendanceMetrics.presentCount} • Excused: {selectedMemberBreakdown.attendanceMetrics.excusedCount} • Absent: {selectedMemberBreakdown.attendanceMetrics.absentCount}</p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg space-y-1">
                <span className="font-bold block text-rose-600">3. Active Penalty Deductions: -{selectedMemberBreakdown.penaltyMetrics.totalDeductionPoints} pts</span>
                <p className="text-slate-400">{selectedMemberBreakdown.penaltyMetrics.activePenaltiesCount} active disciplinary violations</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingPerformanceHub;
