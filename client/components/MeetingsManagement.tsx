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
} from 'lucide-react';
import { meetingsService, governanceService, memberService } from '../services/api';
import { Meeting, MeetingAttendee, Member, User, AccessLevel } from '../types';
import { Language } from '../i18n/translations';
import Toast from './Toast';
import { Skeleton, SkeletonBadge } from './ui/Skeleton';

interface MeetingsManagementProps {
  lang: Language;
  currentUser?: User | null;
}

export const MeetingsManagement: React.FC<MeetingsManagementProps> = ({ currentUser }) => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isLiveRoomOpen, setIsLiveRoomOpen] = useState<boolean>(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [isPenaltyModalOpen, setIsPenaltyModalOpen] = useState<boolean>(false);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);

  // Form States
  const [formData, setFormData] = useState({
    title: '',
    meetingType: 'FOUNDING_MEMBER',
    meetingDate: new Date().toISOString().slice(0, 16),
    location: 'Main HQ / Google Meet',
    agenda: '',
    notes: '',
  });

  // Penalty Modal Form
  const [penaltyMember, setPenaltyMember] = useState<{ id: string; name: string } | null>(null);
  const [penaltyTier, setPenaltyTier] = useState<1 | 2 | 3 | 4>(1);
  const [penaltyReason, setPenaltyReason] = useState<string>('');
  const [isSubmittingPenalty, setIsSubmittingPenalty] = useState<boolean>(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Permissions
  const canWrite = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.role === 'Admin' || currentUser.role === 'Administrator' || currentUser.role === 'Manager') return true;
    return currentUser.permissions?.['MEMBERS'] === AccessLevel.WRITE;
  }, [currentUser]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [meetingsRes, membersRes] = await Promise.all([
        meetingsService.getMeetings({ limit: 100 }),
        memberService.getAll(),
      ]);

      const meetingList = Array.isArray(meetingsRes?.data) ? meetingsRes.data : Array.isArray(meetingsRes) ? meetingsRes : [];
      setMeetings(meetingList);

      const memberList = Array.isArray(membersRes?.data) ? membersRes.data : Array.isArray(membersRes) ? membersRes : [];
      setMembers(memberList);
    } catch (err: unknown) {
      console.error('Failed to load meetings data:', err);
      showToast('Failed to load meetings data', 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open Live Meeting Room or Details
  const handleOpenLiveRoom = async (meeting: Meeting) => {
    try {
      const fullMeeting = await meetingsService.getMeetingById(meeting.id);
      setActiveMeeting(fullMeeting);
      setIsLiveRoomOpen(true);
    } catch (err) {
      console.error('Failed to load meeting details:', err);
      showToast('Failed to open meeting room', 'error');
    }
  };

  const handleOpenDetailModal = async (meeting: Meeting) => {
    try {
      const fullMeeting = await meetingsService.getMeetingById(meeting.id);
      setActiveMeeting(fullMeeting);
      setIsDetailModalOpen(true);
    } catch (err) {
      console.error('Failed to load meeting details:', err);
      showToast('Failed to load meeting details', 'error');
    }
  };

  // Start Meeting
  const handleStartMeeting = async (meetingId: string) => {
    try {
      const updated = await meetingsService.startMeeting(meetingId);
      showToast('Meeting session started!');
      loadData();
      handleOpenLiveRoom(updated);
    } catch (err: unknown) {
      console.error('Failed to start meeting:', err);
      showToast(err instanceof Error ? err.message : 'Failed to start meeting', 'error');
    }
  };

  // Attendance Toggle in Live Room
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

  // Save Attendance to Backend
  const handleSaveAttendance = async () => {
    if (!activeMeeting || !activeMeeting.attendees) return;

    try {
      const payload = activeMeeting.attendees.map((att) => ({
        memberId: att.memberId,
        attendanceStatus: att.attendanceStatus,
        notes: att.notes || '',
      }));

      await meetingsService.recordAttendance(activeMeeting.id, payload);
      showToast('Attendance records saved');
      loadData();
    } catch (err: unknown) {
      console.error('Failed to save attendance:', err);
      showToast('Failed to save attendance', 'error');
    }
  };

  // Complete Meeting
  const handleCompleteMeeting = async () => {
    if (!activeMeeting) return;
    if (!window.confirm('Are you sure you want to finalize and complete this meeting? This will calculate deposit punctuality and update performance scores.')) {
      return;
    }

    try {
      await handleSaveAttendance();
      await meetingsService.completeMeeting(activeMeeting.id, activeMeeting.notes);
      showToast('Meeting successfully completed and performance scores refreshed!');
      setIsLiveRoomOpen(false);
      setActiveMeeting(null);
      loadData();
    } catch (err: unknown) {
      console.error('Failed to complete meeting:', err);
      showToast('Failed to complete meeting', 'error');
    }
  };

  // Create Meeting Submit
  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await meetingsService.createMeeting(formData);
      showToast('Meeting scheduled successfully!');
      setIsCreateModalOpen(false);
      setFormData({
        title: '',
        meetingType: 'FOUNDING_MEMBER',
        meetingDate: new Date().toISOString().slice(0, 16),
        location: 'Main HQ / Google Meet',
        agenda: '',
        notes: '',
      });
      loadData();
    } catch (err: unknown) {
      console.error('Failed to create meeting:', err);
      showToast(err instanceof Error ? err.message : 'Failed to schedule meeting', 'error');
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
      console.error('Failed to delete meeting:', err);
      showToast('Failed to delete meeting', 'error');
    }
  };

  // Issue In-Meeting Penalty
  const handleOpenPenaltyModal = (memberId: string, memberName: string) => {
    setPenaltyMember({ id: memberId, name: memberName });
    setPenaltyTier(1);
    setPenaltyReason(`Meeting Disciplinary Notice (${activeMeeting?.title || 'General Session'})`);
    setIsPenaltyModalOpen(true);
  };

  const handleIssuePenaltySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!penaltyMember) return;

    try {
      setIsSubmittingPenalty(true);
      await governanceService.issuePenalty({
        memberId: penaltyMember.id,
        meetingId: activeMeeting?.id,
        tier: penaltyTier,
        reason: penaltyReason,
      });

      showToast(`Tier ${penaltyTier} warning/penalty issued to ${penaltyMember.name}!`);
      setIsPenaltyModalOpen(false);
      setPenaltyMember(null);
      setPenaltyReason('');

      // Refresh active meeting data if open
      if (activeMeeting) {
        const fullMeeting = await meetingsService.getMeetingById(activeMeeting.id);
        setActiveMeeting(fullMeeting);
      }
      loadData();
    } catch (err: unknown) {
      console.error('Failed to issue penalty:', err);
      showToast(err instanceof Error ? err.message : 'Failed to issue penalty', 'error');
    } finally {
      setIsSubmittingPenalty(false);
    }
  };

  // Filtered Meetings
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      const matchesSearch =
        m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.agenda && m.agenda.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesStatus = statusFilter === 'ALL' || m.status === statusFilter;
      const matchesType = typeFilter === 'ALL' || m.meetingType === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [meetings, searchTerm, statusFilter, typeFilter]);

  // Metric Stats
  const metrics = useMemo(() => {
    const total = meetings.length;
    const scheduled = meetings.filter((m) => m.status === 'SCHEDULED').length;
    const inProgress = meetings.filter((m) => m.status === 'IN_PROGRESS').length;
    const completed = meetings.filter((m) => m.status === 'COMPLETED').length;

    let totalAttendancePercentSum = 0;
    let completedWithAttendees = 0;

    for (const m of meetings.filter((m) => m.status === 'COMPLETED')) {
      const tot = m.totalAttendees || (m.presentCount ?? 0) + (m.absentCount ?? 0) + (m.excusedCount ?? 0);
      if (tot > 0) {
        const rate = (((m.presentCount ?? 0) + (m.excusedCount ?? 0)) / tot) * 100;
        totalAttendancePercentSum += rate;
        completedWithAttendees++;
      }
    }

    const avgAttendance = completedWithAttendees > 0 ? Math.round(totalAttendancePercentSum / completedWithAttendees) : 100;

    return { total, scheduled, inProgress, completed, avgAttendance };
  }, [meetings]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
            Live In Progress
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
            <X className="w-3.5 h-3.5" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
            <Clock className="w-3.5 h-3.5" />
            Scheduled
          </span>
        );
    }
  };

  const getTypeBadge = (type: string) => {
    const map: Record<string, { label: string; color: string }> = {
      FOUNDING_MEMBER: { label: 'Founding Member', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
      SHAREHOLDER: { label: 'Shareholder', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
      INVESTOR: { label: 'Investor', color: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300' },
      GENERAL: { label: 'General', color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300' },
    };

    const conf = map[type] || { label: type, color: 'bg-slate-100 text-slate-800' };
    return <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${conf.color}`}>{conf.label}</span>;
  };

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Member Meetings & Sessions</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
              Governance Hub
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Schedule recurring member meetings, track live attendance, evaluate deposit deadlines, and enforce governance policies.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {canWrite && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm hover:shadow transition-all"
            >
              <Plus className="w-4 h-4" />
              Schedule Meeting
            </button>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Meetings</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.total}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Upcoming Scheduled</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.scheduled}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Avg Attendance Rate</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.avgAttendance}%</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Completed Sessions</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">{metrics.completed}</h3>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search meetings by title or agenda..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
            >
              <option value="ALL">All Statuses</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="IN_PROGRESS">Live In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
          >
            <option value="ALL">All Types</option>
            <option value="FOUNDING_MEMBER">Founding Member</option>
            <option value="SHAREHOLDER">Shareholder</option>
            <option value="INVESTOR">Investor</option>
            <option value="GENERAL">General</option>
          </select>
        </div>
      </div>

      {/* Meetings List */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={`meet-skel-${i}`} className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <Skeleton width="4rem" height="1.25rem" borderRadius="9999px" />
                  <Skeleton width="12rem" height="1rem" borderRadius="0.25rem" />
                </div>
                <div className="flex items-center gap-4">
                  <Skeleton width="6rem" height="0.75rem" borderRadius="0.25rem" />
                  <Skeleton width="8rem" height="0.75rem" borderRadius="0.25rem" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton width="6rem" height="2rem" borderRadius="0.5rem" />
              </div>
            </div>
          ))
        ) : filteredMeetings.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 p-12 text-center rounded-xl border border-slate-200 dark:border-slate-700">
            <Calendar className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <h4 className="text-base font-semibold text-slate-800 dark:text-slate-200">No Meetings Found</h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
              No meetings match your current filters. Click &quot;Schedule Meeting&quot; above to create a new session.
            </p>
          </div>
        ) : (
          filteredMeetings.map((meeting) => {
            const meetingDateObj = new Date(meeting.meetingDate);
            const isLive = meeting.status === 'IN_PROGRESS';
            const isScheduled = meeting.status === 'SCHEDULED';
            const isCompleted = meeting.status === 'COMPLETED';

            const present = meeting.presentCount ?? 0;
            const excused = meeting.excusedCount ?? 0;
            const absent = meeting.absentCount ?? 0;
            const totalAttendees = meeting.totalAttendees ?? present + excused + absent;
            const attendancePct = totalAttendees > 0 ? Math.round(((present + excused) / totalAttendees) * 100) : 0;

            return (
              <div
                key={meeting.id}
                onClick={() => (isLive ? handleOpenLiveRoom(meeting) : handleOpenDetailModal(meeting))}
                className={`bg-white dark:bg-slate-800 p-5 rounded-xl border transition-all cursor-pointer shadow-sm hover:shadow-md ${
                  isLive
                    ? 'border-blue-400 dark:border-blue-600 bg-blue-50/20 dark:bg-blue-900/10 ring-1 ring-blue-400'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Title & Info */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">{meeting.title}</h3>
                      {getStatusBadge(meeting.status)}
                      {getTypeBadge(meeting.meetingType)}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {meetingDateObj.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {meetingDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        {meeting.location || 'HQ / Online'}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        {totalAttendees} Active Members
                      </span>
                    </div>

                    {meeting.agenda && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-1 italic">
                        Agenda: {meeting.agenda}
                      </p>
                    )}
                  </div>

                  {/* Attendance Stats & Actions */}
                  <div className="flex items-center gap-4 justify-between lg:justify-end border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100 dark:border-slate-700/60">
                    {isCompleted && (
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-sm font-bold text-slate-900 dark:text-white">{attendancePct}%</span>
                          <span className="text-xs text-slate-400">Attendance</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {present} Present • {excused} Excused • {absent} Absent
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {isScheduled && canWrite && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartMeeting(meeting.id);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Start Meeting
                        </button>
                      )}

                      {isLive && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenLiveRoom(meeting);
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm animate-bounce transition-colors"
                        >
                          <Users className="w-3.5 h-3.5" />
                          Enter Live Room
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetailModal(meeting);
                        }}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                        title="View Details & Minutes"
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      {isScheduled && canWrite && (
                        <button
                          onClick={(e) => handleDeleteMeeting(meeting.id, e)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30"
                          title="Delete Scheduled Meeting"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}

                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* SCHEDULE MEETING MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Schedule Member Meeting</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateMeeting} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Meeting Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Monthly General Meeting - August 2026"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Meeting Type *
                  </label>
                  <select
                    value={formData.meetingType}
                    onChange={(e) => setFormData({ ...formData, meetingType: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                  >
                    <option value="FOUNDING_MEMBER">Founding Member</option>
                    <option value="SHAREHOLDER">Shareholder</option>
                    <option value="INVESTOR">Investor</option>
                    <option value="GENERAL">General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                    Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={formData.meetingDate}
                    onChange={(e) => setFormData({ ...formData, meetingDate: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Location / Meeting Link
                </label>
                <input
                  type="text"
                  placeholder="e.g. Office HQ / Google Meet Link"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Agenda & Key Discussion Topics
                </label>
                <textarea
                  rows={3}
                  placeholder="1. Monthly deposit status review&#10;2. Project investment decisions&#10;3. Governance disciplinary policy"
                  value={formData.agenda}
                  onChange={(e) => setFormData({ ...formData, agenda: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                />
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg flex items-start gap-2.5 text-xs text-blue-700 dark:text-blue-300">
                <Users className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  All active members ({members.filter((m) => m.status === 'active').length} members) will be automatically added to the meeting attendance roster.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm"
                >
                  Schedule Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LIVE MEETING ROOM & ATTENDANCE TRACKER */}
      {isLiveRoomOpen && activeMeeting && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-5xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/60">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span className="text-xs font-bold text-red-600 uppercase tracking-widest">LIVE SESSION</span>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{activeMeeting.title}</h2>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Record member presence/absence, verify deposit deadlines, and issue warnings or fines.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveAttendance}
                  className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  Save Progress
                </button>
                <button
                  onClick={handleCompleteMeeting}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
                >
                  Finish & Complete Meeting
                </button>
                <button
                  onClick={() => setIsLiveRoomOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Attendance Roster Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60 text-center">
                <div>
                  <span className="text-xs text-slate-500">Present</span>
                  <p className="text-lg font-bold text-emerald-600">
                    {activeMeeting.attendees?.filter((a) => a.attendanceStatus === 'PRESENT').length || 0}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Excused</span>
                  <p className="text-lg font-bold text-amber-600">
                    {activeMeeting.attendees?.filter((a) => a.attendanceStatus === 'EXCUSED').length || 0}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-500">Absent</span>
                  <p className="text-lg font-bold text-rose-600">
                    {activeMeeting.attendees?.filter((a) => a.attendanceStatus === 'ABSENT').length || 0}
                  </p>
                </div>
              </div>

              {/* Attendee Table */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="p-3">Member</th>
                      <th className="p-3">Shares</th>
                      <th className="p-3">Deposit Deadline Status</th>
                      <th className="p-3 text-center">Attendance Status</th>
                      <th className="p-3 text-right">Disciplinary Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeMeeting.attendees?.map((att) => {
                      const isPresent = att.attendanceStatus === 'PRESENT';
                      const isExcused = att.attendanceStatus === 'EXCUSED';
                      const isAbsent = att.attendanceStatus === 'ABSENT';

                      return (
                        <tr key={att.memberId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="p-3">
                            <div className="font-semibold text-slate-900 dark:text-white">{att.name}</div>
                            <div className="text-[11px] text-slate-400">{att.displayId} • {att.role}</div>
                          </td>

                          <td className="p-3 font-medium text-slate-700 dark:text-slate-300">
                            {att.shares || 1} Shares
                          </td>

                          <td className="p-3">
                            {att.depositStatus === 'PAID_ON_TIME' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" /> Paid On-Time
                              </span>
                            )}
                            {att.depositStatus === 'PAID_LATE' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                <Clock className="w-3 h-3" /> Paid Late
                              </span>
                            )}
                            {att.depositStatus === 'PENDING' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                                <AlertTriangle className="w-3 h-3" /> Deposit Pending
                              </span>
                            )}
                          </td>

                          <td className="p-3">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleToggleAttendance(att.memberId, 'PRESENT')}
                                className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all ${
                                  isPresent
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                                }`}
                              >
                                <UserCheck className="w-3 h-3" /> Present
                              </button>
                              <button
                                onClick={() => handleToggleAttendance(att.memberId, 'EXCUSED')}
                                className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all ${
                                  isExcused
                                    ? 'bg-amber-600 text-white shadow-sm'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                                }`}
                              >
                                Excused
                              </button>
                              <button
                                onClick={() => handleToggleAttendance(att.memberId, 'ABSENT')}
                                className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all ${
                                  isAbsent
                                    ? 'bg-rose-600 text-white shadow-sm'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                                }`}
                              >
                                <UserX className="w-3 h-3" /> Absent
                              </button>
                            </div>
                          </td>

                          <td className="p-3 text-right">
                            <button
                              onClick={() => handleOpenPenaltyModal(att.memberId, att.name || 'Member')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100 rounded text-xs font-medium border border-rose-200 dark:border-rose-800/60"
                            >
                              <ShieldAlert className="w-3 h-3" />
                              Issue Penalty
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MEETING DETAILS & MINUTES MODAL */}
      {isDetailModalOpen && activeMeeting && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">{activeMeeting.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(activeMeeting.meetingDate).toLocaleString()} • {activeMeeting.location}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {activeMeeting.agenda && (
                <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Agenda & Discussion Points
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{activeMeeting.agenda}</p>
                </div>
              )}

              {/* Attendees breakdown */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                  Attendee Roster & Attendance History ({activeMeeting.attendees?.length || 0})
                </h4>
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="p-2.5">Member</th>
                        <th className="p-2.5">Attendance</th>
                        <th className="p-2.5">Deposit Punctuality</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {activeMeeting.attendees?.map((att) => (
                        <tr key={att.id}>
                          <td className="p-2.5 font-medium text-slate-800 dark:text-slate-200">{att.name}</td>
                          <td className="p-2.5">
                            <span
                              className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                                att.attendanceStatus === 'PRESENT'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                  : att.attendanceStatus === 'EXCUSED'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                              }`}
                            >
                              {att.attendanceStatus}
                            </span>
                          </td>
                          <td className="p-2.5">
                            <span className="text-[11px] text-slate-600 dark:text-slate-400">
                              {att.depositStatus.replace(/_/g, ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QUICK ISSUE PENALTY DIALOG */}
      {isPenaltyModalOpen && penaltyMember && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700 bg-rose-50/50 dark:bg-rose-900/20">
              <div className="flex items-center gap-2 text-rose-600">
                <ShieldAlert className="w-5 h-5" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Issue Disciplinary Penalty
                </h3>
              </div>
              <button
                onClick={() => setIsPenaltyModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleIssuePenaltySubmit} className="p-6 space-y-4">
              <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg">
                <span className="text-xs text-slate-500">Target Member</span>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{penaltyMember.name}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Escalating Penalty Tier *
                </label>
                <select
                  value={penaltyTier}
                  onChange={(e) => setPenaltyTier(parseInt(e.target.value, 10) as 1 | 2 | 3 | 4)}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 dark:text-white font-medium"
                >
                  <option value={1}>Tier 1: 1st Offense - Verbal Warning (0 BDT fine, -5 pts)</option>
                  <option value={2}>Tier 2: 2nd Offense - Minor Fine (50 BDT deduction, -10 pts)</option>
                  <option value={3}>Tier 3: 3rd Offense - Major Fine (200 BDT deduction, -20 pts)</option>
                  <option value={4}>Tier 4: 4th Offense - Suspension & 500 BDT fine (-35 pts)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Reason & Violation Context *
                </label>
                <textarea
                  required
                  rows={3}
                  value={penaltyReason}
                  onChange={(e) => setPenaltyReason(e.target.value)}
                  placeholder="Explain why this penalty or warning is being issued..."
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 dark:text-white"
                />
              </div>

              {penaltyTier >= 2 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                  <DollarSign className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>
                    This penalty will automatically debit the fine from the member&apos;s contributed fund balance and record a ledger transaction.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPenaltyModalOpen(false)}
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
    </div>
  );
};

export default MeetingsManagement;
