import React, { useState, useEffect, useMemo } from 'react';
import { Target, Plus, Calendar, DollarSign, TrendingUp, AlertCircle, CheckCircle2, XCircle, Zap, Clock, Search, Filter, RefreshCw, Edit2, Trash2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { t, Language } from '../i18n/translations';
import { goalService, projectService } from '../services/api';
import { Goal, Project, AppScreen, AccessLevel } from '../types';
import toast from 'react-hot-toast';
import { ModalForm, FormInput, FormSelect, FormTextarea } from './ui/FormElements';
import { InlineTopForm } from './ui/InlineTopForm';
import { Button } from './ui/Button';
import SummaryMetricCard from './SummaryMetricCard';
import ExportMenu from './ExportMenu';
import ActionDialog from './ActionDialog';
import { Skeleton, SkeletonText } from './ui/Skeleton';
import { usePermission } from '../hooks/usePermission';

interface GoalsProps {
  lang: Language;
}

// Mini circular progress for cards
const MiniProgressRing: React.FC<{
  progress: number;
  color: string;
}> = ({ progress, color }) => {
  const size = 48;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-gray-100 dark:text-white/5"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={color}
        />
      </svg>
      <span className="absolute text-[11px] font-black text-gray-900 dark:text-white">{progress}%</span>
    </div>
  );
};

const Goals: React.FC<GoalsProps> = ({ lang }) => {
  const canWrite = usePermission(AppScreen.GOALS, AccessLevel.WRITE);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [filterType, setFilterType] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    goalId: string;
    title: string;
  }>({
    isOpen: false,
    goalId: '',
    title: ''
  });

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    targetAmount: '',
    currentAmount: '',
    deadline: '',
    type: 'Other',
    linkedProject: '',
    status: 'In Progress'
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const [goalsResponse, projectsResponse] = await Promise.all([
        goalService.getAll(),
        projectService.getAll()
      ]);
      setGoals(goalsResponse?.data || goalsResponse || []);
      setProjects(projectsResponse?.data || projectsResponse || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load goals');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        ...formData,
        targetAmount: Number(formData.targetAmount),
        currentAmount: Number(formData.currentAmount),
        deadline: formData.deadline ? new Date(formData.deadline).toISOString() : undefined,
        linkedProject: formData.linkedProject || undefined
      };

      if (editingGoal) {
        await goalService.update(editingGoal._id, payload);
        toast.success('Goal updated successfully');
      } else {
        await goalService.create(payload);
        toast.success('Goal created successfully');
      }

      setIsModalOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('Error saving goal:', error);
      toast.error('Failed to save goal');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (id: string, title: string) => {
    setDeleteDialog({ isOpen: true, goalId: id, title });
  };

  const handleDelete = async () => {
    if (processingId) return;
    const { goalId } = deleteDialog;

    try {
      setProcessingId(goalId);
      setIsSubmitting(true);
      await goalService.delete(goalId);
      toast.success('Goal deleted');
      await fetchData();
      setDeleteDialog({ isOpen: false, goalId: '', title: '' });
    } catch (error) {
      toast.error('Failed to delete goal');
    } finally {
      setProcessingId(null);
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      targetAmount: '',
      currentAmount: '',
      deadline: '',
      type: 'Other',
      linkedProject: '',
      status: 'In Progress'
    });
    setEditingGoal(null);
  };

  const openEditModal = (goal: Goal) => {
    setEditingGoal(goal);
    setFormData({
      title: goal.title,
      description: goal.description || '',
      targetAmount: goal.targetAmount.toString(),
      currentAmount: goal.currentAmount.toString(),
      deadline: goal.deadline ? new Date(goal.deadline).toISOString().split('T')[0] : '',
      type: goal.type,
      linkedProject: goal.linkedProject || '',
      status: goal.status
    });
    setIsModalOpen(true);
  };

  const calculateProgress = (current: number, target: number) => {
    if (target === 0) return 0;
    return Math.min(Math.round((current / target) * 100), 100);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Achieved': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'Cancelled': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'Savings': return { ring: 'text-emerald-500', icon: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600', stripe: 'bg-emerald-400' };
      case 'Investment': return { ring: 'text-purple-500', icon: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600', stripe: 'bg-purple-400' };
      default: return { ring: 'text-blue-500', icon: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600', stripe: 'bg-blue-400' };
    }
  };

  const getDaysLeft = (deadline?: string) => {
    if (!deadline) return null;
    return Math.ceil((new Date(deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  };

  const getUrgencyBadge = (daysLeft: number | null, status: string) => {
    if (status !== 'In Progress' || daysLeft === null) return null;
    if (daysLeft < 0) return { label: `${Math.abs(daysLeft)}d overdue`, color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400', icon: <AlertCircle size={12} /> };
    if (daysLeft <= 7) return { label: `${daysLeft}d left`, color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400', icon: <Zap size={12} /> };
    return null;
  };

  // Filtered goals
  const filteredGoals = useMemo(() => {
    return goals.filter(goal => {
      if (filterType !== 'All' && goal.type !== filterType) return false;
      if (filterStatus !== 'All' && goal.status !== filterStatus) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          goal.title.toLowerCase().includes(query) ||
          (goal.description || '').toLowerCase().includes(query) ||
          goal.type.toLowerCase().includes(query) ||
          goal.status.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [goals, filterType, filterStatus, searchQuery]);

  // Stats calculation
  const totalTarget = goals.reduce((acc, g) => acc + g.targetAmount, 0);
  const totalCurrent = goals.reduce((acc, g) => acc + g.currentAmount, 0);
  const totalAchieved = goals.filter(g => g.status === 'Achieved').length;
  const totalInProgress = goals.filter(g => g.status === 'In Progress').length;
  const overallProgress = totalTarget > 0 ? Math.min(Math.round((totalCurrent / totalTarget) * 100), 100) : 0;

  // Milestone markers
  const milestones = [25, 50, 75];

  return (
    <div className="compact-screen space-y-10 animate-in fade-in duration-500">
      {/* Delete Confirmation Dialog */}
      <ActionDialog
        isOpen={deleteDialog.isOpen}
        type="delete"
        title={t('goals.deleteConfirm', lang)}
        message={`Are you sure you want to delete "${deleteDialog.title}"?`}
        onConfirm={handleDelete}
        onClose={() => setDeleteDialog({ isOpen: false, goalId: '', title: '' })}
        confirmLabel={t('common.delete', lang)}
        cancelLabel={t('common.cancel', lang)}
        loading={isSubmitting}
      />

      {/* Header Section - matching Expenses pattern */}
      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.strategy', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.goals', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.goals', lang)}</h1>
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-all ${refreshing ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ExportMenu
            data={filteredGoals}
            columns={[
              { header: 'Title', key: 'title' },
              { header: 'Type', key: 'type' },
              { header: 'Status', key: 'status' },
              { header: 'Target Amount', key: 'targetAmount', format: (g: any) => g.targetAmount.toLocaleString() },
              { header: 'Current Amount', key: 'currentAmount', format: (g: any) => g.currentAmount.toLocaleString() },
              { header: 'Progress', key: 'progress', format: (g: any) => `${calculateProgress(g.currentAmount, g.targetAmount)}%` },
              { header: 'Deadline', key: 'deadline', format: (g: any) => g.deadline ? new Date(g.deadline).toLocaleDateString() : 'N/A' },
            ]}
            fileName={`goals_${new Date().toISOString().split('T')[0]}`}
            title={t('goals.title', lang)}
            lang={lang}
            targetId="goals-snapshot-target"
          />
          {canWrite && (
            <button
              onClick={() => { resetForm(); setIsModalOpen(true); }}
              className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
            >
              <Plus size={20} strokeWidth={3} /> {t('goals.addGoal', lang)}
            </button>
          )}
        </div>
      </div>

      {/* Summary Metric Cards - matching Expenses/Deposits layout */}
      <div id="goals-snapshot-target" className="space-y-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <SummaryMetricCard
            label={t('goals.stats.totalGoals', lang)}
            value={goals.length}
            note={`${overallProgress}% ${t('goals.list.progress', lang).toLowerCase()}`}
            icon={<Target size={18} />}
          />
          <SummaryMetricCard
            label={t('goals.stats.achieved', lang)}
            value={totalAchieved}
            note={goals.length > 0 ? `${Math.round((totalAchieved / goals.length) * 100)}%` : '0%'}
            noteClassName="text-green-500"
            icon={<CheckCircle2 size={18} />}
          />
          <SummaryMetricCard
            label={t('goals.stats.inProgress', lang)}
            value={totalInProgress}
            note="active"
            noteClassName="text-blue-500"
            icon={<TrendingUp size={18} />}
            variant="dark"
          />
          <SummaryMetricCard
            label={t('goals.stats.totalTarget', lang)}
            value={totalTarget.toLocaleString()}
            note={`${totalCurrent.toLocaleString()} saved`}
            noteClassName="text-emerald-500"
            icon={<DollarSign size={18} />}
          />
        </div>

        {/* Main Content Card - matching Expenses white container */}
        <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5">
          {/* Search + Filter Bar */}
          <div className="px-10 py-8 border-b border-gray-50 dark:border-white/5 flex flex-col gap-6">
            <div className="flex items-center justify-between gap-6">
              <div className="relative flex-1 max-w-lg">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('goals.list.noGoals', lang).includes('No') ? 'Search goals by title, type, or status...' : t('goals.list.noGoals', lang)}
                  className="w-full bg-gray-50/80 dark:bg-[#111814] pl-14 pr-6 py-4 rounded-2xl border border-gray-200 dark:border-white/5 ring-0 focus:ring-2 focus:ring-dark dark:focus:ring-brand text-sm font-bold transition-all text-dark dark:text-white"
                />
              </div>
              <button className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white transition-colors">
                <Filter size={20} />
              </button>
            </div>

            {/* Filter Pills */}
            {goals.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mr-1">Type</span>
                  {['All', 'Savings', 'Investment', 'Other'].map(type => (
                    <button
                      key={type}
                      onClick={() => setFilterType(type)}
                      className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-200 ${
                        filterType === type
                          ? 'bg-brand text-dark shadow-md shadow-brand/20'
                          : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                      }`}
                    >
                      {type === 'All' ? t('common.all', lang) || 'All' : type}
                    </button>
                  ))}
                </div>

                <div className="w-px h-8 bg-gray-200 dark:bg-white/10 hidden sm:block" />

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mr-1">Status</span>
                  {['All', 'In Progress', 'Achieved', 'Cancelled'].map(status => (
                    <button
                      key={status}
                      onClick={() => setFilterStatus(status)}
                      className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-200 ${
                        filterStatus === status
                          ? 'bg-brand text-dark shadow-md shadow-brand/20'
                          : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                      }`}
                    >
                      {status === 'All' ? t('common.all', lang) || 'All' : t(`goals.form.statuses.${status === 'In Progress' ? 'inProgress' : status === 'Achieved' ? 'achieved' : 'cancelled'}`, lang)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Goals Grid */}
          <div className="px-10 py-8">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={`goal-skel-${i}`} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-150 dark:border-gray-800 shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                      <Skeleton width="40%" height="1.25rem" borderRadius="9999px" />
                      <Skeleton width="20%" height="1.25rem" borderRadius="9999px" />
                    </div>
                    <Skeleton width="80%" height="1.25rem" borderRadius="0.25rem" />
                    <SkeletonText lines={2} />
                    <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex justify-between">
                        <Skeleton width="30%" height="0.65rem" />
                        <Skeleton width="20%" height="0.65rem" />
                      </div>
                      <Skeleton width="100%" height="0.5rem" borderRadius="9999px" />
                    </div>
                  </div>
                ))}
              </div>
            ) : goals.length === 0 ? (
              <div className="text-center py-20">
                <div className="bg-gray-50 dark:bg-white/5 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Target size={32} className="text-gray-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('goals.list.noGoals', lang)}</h3>
                <p className="text-gray-500 mb-6">{t('goals.subtitle', lang)}</p>
                {canWrite && (
                  <button
                    onClick={() => { resetForm(); setIsModalOpen(true); }}
                    className="bg-dark dark:bg-brand text-white dark:text-dark px-8 py-4 rounded-2xl font-black text-sm uppercase inline-flex items-center gap-3 hover:scale-105 transition-all"
                  >
                    <Plus size={18} strokeWidth={3} /> {t('goals.addGoal', lang)}
                  </button>
                )}
              </div>
            ) : filteredGoals.length === 0 ? (
              <div className="text-center py-16">
                <div className="bg-gray-50 dark:bg-white/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Target size={24} className="text-gray-400" />
                </div>
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">No goals match the selected filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                <AnimatePresence mode="popLayout">
                  {filteredGoals.map((goal) => {
                    const progress = calculateProgress(goal.currentAmount, goal.targetAmount);
                    const daysLeft = getDaysLeft(goal.deadline);
                    const urgency = getUrgencyBadge(daysLeft, goal.status);
                    const colors = getTypeColor(goal.type);

                    return (
                      <motion.div
                        key={goal._id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        whileHover={{ y: -4 }}
                        className="bg-gray-50/50 dark:bg-white/[0.02] rounded-[2rem] p-6 border border-gray-100 dark:border-white/5 hover:border-gray-200 dark:hover:border-white/10 transition-all duration-300 group relative overflow-hidden"
                      >
                        {/* Left color stripe */}
                        <div className={`absolute top-0 left-0 w-1.5 h-full ${colors.stripe}`} />

                        {/* Header: Icon + Title + Actions */}
                        <div className="flex justify-between items-start mb-5 pl-4">
                          <div className="flex items-center gap-3">
                            <MiniProgressRing progress={progress} color={colors.ring} />
                            <div className="ml-1">
                              <h3 className="text-base font-bold text-gray-900 dark:text-white leading-tight">{goal.title}</h3>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${getStatusColor(goal.status)}`}>
                                  {t(`goals.form.statuses.${goal.status === 'In Progress' ? 'inProgress' : goal.status === 'Achieved' ? 'achieved' : 'cancelled'}`, lang)}
                                </span>
                                {urgency && (
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${urgency.color}`}>
                                    {urgency.icon}
                                    {urgency.label}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {canWrite && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all">
                              <button
                                onClick={() => openEditModal(goal)}
                                className="p-3 bg-white dark:bg-[#111814] rounded-2xl border border-gray-100 dark:border-white/5 text-gray-500 hover:text-brand hover:border-brand/30 transition-all shadow-sm"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteClick(goal._id, goal.title);
                                }}
                                disabled={!!processingId}
                                className={`p-3 rounded-2xl border transition-all ${processingId === goal._id
                                  ? 'bg-rose-50 border-rose-100 cursor-wait'
                                  : 'bg-white dark:bg-[#111814] border-gray-100 dark:border-white/5 text-gray-500 hover:text-rose-500 hover:border-rose-500/30 shadow-sm'
                                }`}
                              >
                                {processingId === goal._id ? <Loader2 size={16} className="animate-spin text-rose-500" /> : <Trash2 size={16} />}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Description */}
                        {goal.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 pl-4 line-clamp-2">{goal.description}</p>
                        )}

                        {/* Financial Details */}
                        <div className="pl-4 space-y-4">
                          {/* Current / Target */}
                          <div className="grid grid-cols-2 gap-3 bg-white dark:bg-white/5 p-3.5 rounded-2xl border border-gray-100 dark:border-white/5">
                            <div>
                              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-1">{t('goals.form.currentAmount', lang)}</span>
                              <span className="text-lg font-black text-gray-900 dark:text-white tracking-tighter">{goal.currentAmount.toLocaleString()}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-1">{t('goals.form.targetAmount', lang)}</span>
                              <span className="text-lg font-black text-gray-900 dark:text-white tracking-tighter">{goal.targetAmount.toLocaleString()}</span>
                            </div>
                          </div>

                          {/* Milestone Progress Bar */}
                          <div>
                            <div className="relative h-2.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-visible">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 1, ease: 'easeOut' }}
                                className={`h-full rounded-full ${
                                  progress >= 100 ? 'bg-gradient-to-r from-green-400 to-emerald-500' : colors.ring.replace('text-', 'bg-')
                                }`}
                              />
                              {/* Milestone ticks */}
                              {milestones.map(m => (
                                <div
                                  key={m}
                                  className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 border-white dark:border-[#1A221D] ${
                                    progress >= m ? 'bg-brand' : 'bg-gray-200 dark:bg-white/10'
                                  }`}
                                  style={{ left: `calc(${m}% - 4px)` }}
                                />
                              ))}
                            </div>
                            <div className="flex justify-between mt-1.5">
                              {milestones.map(m => (
                                <span key={m} className={`text-[9px] font-bold ${progress >= m ? 'text-brand' : 'text-gray-300 dark:text-white/20'}`}>{m}%</span>
                              ))}
                            </div>
                          </div>

                          {/* Footer: Deadline + Days Left */}
                          <div className="flex justify-between items-center text-xs font-medium text-gray-500 dark:text-gray-400 pt-3 border-t border-gray-100 dark:border-white/5">
                            <div className="flex items-center gap-1.5">
                              <Calendar size={13} />
                              {goal.deadline ? new Date(goal.deadline).toLocaleDateString() : 'No deadline'}
                            </div>
                            {daysLeft !== null && goal.status === 'In Progress' && (
                              <span className={`flex items-center gap-1 ${daysLeft < 0 ? 'text-red-500' : daysLeft <= 7 ? 'text-amber-500' : 'text-blue-500'}`}>
                                <Clock size={13} />
                                {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>

      <InlineTopForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingGoal ? t('goals.editGoal', lang) : t('goals.addGoal', lang)}
        onSubmit={handleSubmit}
        submitLabel={t('common.save', lang)}
        loading={isSubmitting}
      >
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <FormInput
              label={t('goals.form.title', lang)}
              type="text"
              required
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
            />
            <FormSelect
              label={t('goals.form.type', lang)}
              value={formData.type}
              onChange={e => setFormData({ ...formData, type: e.target.value })}
              options={[
                { value: 'Savings', label: t('goals.form.types.savings', lang) },
                { value: 'Investment', label: t('goals.form.types.investment', lang) },
                { value: 'Other', label: t('goals.form.types.other', lang) }
              ]}
            />
          </div>

          <FormTextarea
            label={t('goals.form.description', lang)}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            rows={3}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <FormInput
              label={t('goals.form.targetAmount', lang)}
              type="number"
              required
              value={formData.targetAmount}
              onChange={e => setFormData({ ...formData, targetAmount: e.target.value })}
              placeholder="0.00"
            />
            <FormInput
              label={t('goals.form.currentAmount', lang)}
              type="number"
              value={formData.currentAmount}
              onChange={e => setFormData({ ...formData, currentAmount: e.target.value })}
              placeholder="0.00"
            />
            <FormInput
              label={t('goals.form.deadline', lang)}
              type="date"
              value={formData.deadline}
              onChange={e => setFormData({ ...formData, deadline: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {editingGoal && (
              <FormSelect
                label={t('goals.form.status', lang)}
                value={formData.status}
                onChange={e => setFormData({ ...formData, status: e.target.value })}
                options={[
                  { value: 'In Progress', label: t('goals.form.statuses.inProgress', lang) },
                  { value: 'Achieved', label: t('goals.form.statuses.achieved', lang) },
                  { value: 'Cancelled', label: t('goals.form.statuses.cancelled', lang) }
                ]}
              />
            )}
            <FormSelect
              label={t('goals.form.linkedProject', lang)}
              value={formData.linkedProject}
              onChange={e => setFormData({ ...formData, linkedProject: e.target.value })}
              placeholder={t('goals.form.selectProject', lang)}
              options={Array.isArray(projects) ? projects.map(p => ({
                value: p.id,
                label: p.title
              })) : []}
            />
          </div>

          {/* Impact Preview */}
          <div className="pt-6 flex items-center justify-between border-t border-gray-100 dark:border-white/10 mt-2">
            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">{t('goals.form.targetAmount', lang)}</p>
              <p className="text-3xl font-black text-brand tracking-tighter leading-none">
                {(parseFloat(formData.targetAmount || '0')).toLocaleString()} <span className="text-sm opacity-40">target</span>
              </p>
            </div>
            {formData.currentAmount && (
              <div className="text-right">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">{t('goals.list.progress', lang)}</p>
                <p className="text-3xl font-black text-emerald-500 tracking-tighter leading-none">
                  {calculateProgress(parseFloat(formData.currentAmount || '0'), parseFloat(formData.targetAmount || '0'))}%
                </p>
              </div>
            )}
          </div>
        </div>
      </InlineTopForm>
    </div>
  );
};

export default Goals;
