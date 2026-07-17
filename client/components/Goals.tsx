import React, { useState, useEffect, useMemo } from 'react';
import { Target, Plus, Calendar, DollarSign, TrendingUp, AlertCircle, CheckCircle2, XCircle, Zap, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { t, Language } from '../i18n/translations';
import { goalService, projectService } from '../services/api';
import { Goal, Project } from '../types';
import toast from 'react-hot-toast';
import { ModalForm, FormInput, FormSelect, FormTextarea } from './ui/FormElements';
import { Button } from './ui/Button';

interface GoalsProps {
  lang: Language;
}

// Circular progress ring component
const ProgressRing: React.FC<{
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}> = ({ progress, size = 120, strokeWidth = 8, className = '' }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
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
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="text-brand"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter">{progress}%</span>
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-0.5">complete</span>
      </div>
    </div>
  );
};

// Mini circular progress for cards
const MiniProgressRing: React.FC<{
  progress: number;
  color: string;
}> = ({ progress, color }) => {
  const size = 56;
  const strokeWidth = 5;
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
      <span className="absolute text-xs font-black text-gray-900 dark:text-white">{progress}%</span>
    </div>
  );
};

const Goals: React.FC<GoalsProps> = ({ lang }) => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [filterType, setFilterType] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('goals.deleteConfirm', lang))) {
      try {
        await goalService.delete(id);
        toast.success('Goal deleted');
        fetchData();
      } catch (error) {
        toast.error('Failed to delete goal');
      }
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

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'Savings': return <DollarSign size={18} />;
      case 'Investment': return <TrendingUp size={18} />;
      default: return <Target size={18} />;
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
      return true;
    });
  }, [goals, filterType, filterStatus]);

  // Stats calculation
  const totalTarget = goals.reduce((acc, g) => acc + g.targetAmount, 0);
  const totalCurrent = goals.reduce((acc, g) => acc + g.currentAmount, 0);
  const totalAchieved = goals.filter(g => g.status === 'Achieved').length;
  const totalInProgress = goals.filter(g => g.status === 'In Progress').length;
  const totalCancelled = goals.filter(g => g.status === 'Cancelled').length;
  const overallProgress = totalTarget > 0 ? Math.min(Math.round((totalCurrent / totalTarget) * 100), 100) : 0;

  // Milestone markers
  const milestones = [25, 50, 75];

  return (
    <div className="compact-screen space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
            {t('goals.title', lang)}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {t('goals.subtitle', lang)}
          </p>
        </div>
        <Button
          variant="brand"
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          icon={<Plus size={20} strokeWidth={2.5} />}
        >
          {t('goals.addGoal', lang)}
        </Button>
      </div>

      {/* Hero Summary Section */}
      <div className="bg-white dark:bg-[#1A221D] rounded-[2.5rem] p-8 border border-gray-100 dark:border-white/5 shadow-sm">
        <div className="flex flex-col lg:flex-row items-center gap-8">
          {/* Circular Progress Ring */}
          <div className="flex-shrink-0">
            <ProgressRing progress={overallProgress} size={160} strokeWidth={10} />
          </div>

          {/* Stats */}
          <div className="flex-1 w-full">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-gray-50 dark:bg-white/5 rounded-2xl">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-xl text-purple-600 dark:text-purple-400">
                    <Target size={16} />
                  </div>
                </div>
                <p className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter">{goals.length}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-1">{t('goals.stats.totalGoals', lang)}</p>
              </div>

              <div className="text-center p-4 bg-gray-50 dark:bg-white/5 rounded-2xl">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-xl text-green-600 dark:text-green-400">
                    <CheckCircle2 size={16} />
                  </div>
                </div>
                <p className="text-2xl font-black text-green-600 dark:text-green-400 tracking-tighter">{totalAchieved}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-1">{t('goals.stats.achieved', lang)}</p>
              </div>

              <div className="text-center p-4 bg-gray-50 dark:bg-white/5 rounded-2xl">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-blue-600 dark:text-blue-400">
                    <TrendingUp size={16} />
                  </div>
                </div>
                <p className="text-2xl font-black text-blue-600 dark:text-blue-400 tracking-tighter">{totalInProgress}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-1">{t('goals.stats.inProgress', lang)}</p>
              </div>

              <div className="text-center p-4 bg-gray-50 dark:bg-white/5 rounded-2xl">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-xl text-orange-600 dark:text-orange-400">
                    <DollarSign size={16} />
                  </div>
                </div>
                <p className="text-2xl font-black text-orange-600 dark:text-orange-400 tracking-tighter">৳{Math.round(totalTarget / 1000)}k</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mt-1">{t('goals.stats.totalTarget', lang)}</p>
              </div>
            </div>

            {/* Overall progress bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500 dark:text-gray-400 font-medium">{t('goals.list.progress', lang)}</span>
                <span className="font-bold text-gray-900 dark:text-white">{overallProgress}%</span>
              </div>
              <div className="h-3 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden relative">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${overallProgress}%` }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                  className="h-full rounded-full bg-gradient-to-r from-brand to-emerald-400"
                />
                {/* Milestone markers */}
                {milestones.map(m => (
                  <div
                    key={m}
                    className="absolute top-0 h-full w-px bg-gray-300 dark:bg-white/20"
                    style={{ left: `${m}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      {goals.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
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

          <div className="w-px h-8 bg-gray-200 dark:bg-white/10 hidden sm:block mx-2" />

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

      {/* Goals Grid */}
      {isLoading ? (
        <div className="text-center py-20">
          <div className="animate-spin w-10 h-10 border-4 border-gray-200 border-t-brand rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading goals...</p>
        </div>
      ) : goals.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-[#1A221D] rounded-3xl border border-dashed border-gray-300 dark:border-white/10">
          <div className="bg-gray-50 dark:bg-white/5 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Target size={32} className="text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('goals.list.noGoals', lang)}</h3>
          <p className="text-gray-500 mb-6">{t('goals.subtitle', lang)}</p>
          <Button
            variant="brand"
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            icon={<Plus size={18} />}
          >
            {t('goals.addGoal', lang)}
          </Button>
        </div>
      ) : filteredGoals.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-[#1A221D] rounded-3xl border border-dashed border-gray-300 dark:border-white/10">
          <div className="bg-gray-50 dark:bg-white/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Target size={24} className="text-gray-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400">No goals match the selected filters.</p>
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
                  whileHover={{ y: -5 }}
                  className="bg-white dark:bg-[#1A221D] rounded-[2rem] p-6 border border-gray-100 dark:border-white/5 shadow-sm hover:shadow-xl hover:shadow-gray-200/50 dark:hover:shadow-black/50 transition-all duration-300 group relative overflow-hidden"
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

                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditModal(goal)}>
                        {t('common.edit', lang)}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(goal._id)} icon={<XCircle size={16} />} />
                    </div>
                  </div>

                  {/* Description */}
                  {goal.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 pl-4 line-clamp-2">{goal.description}</p>
                  )}

                  {/* Financial Details */}
                  <div className="pl-4 space-y-4">
                    {/* Current / Target */}
                    <div className="grid grid-cols-2 gap-3 bg-gray-50 dark:bg-white/5 p-3.5 rounded-2xl">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-1">{t('goals.form.currentAmount', lang)}</span>
                        <span className="text-lg font-black text-gray-900 dark:text-white tracking-tighter">৳{goal.currentAmount.toLocaleString()}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 block mb-1">{t('goals.form.targetAmount', lang)}</span>
                        <span className="text-lg font-black text-gray-900 dark:text-white tracking-tighter">৳{goal.targetAmount.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Milestone Progress Bar */}
                    <div>
                      <div className="relative h-3 bg-gray-100 dark:bg-white/5 rounded-full overflow-visible">
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

                    {/* Footer: Deadline + Linked Project */}
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

      <ModalForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingGoal ? t('goals.editGoal', lang) : t('goals.addGoal', lang)}
        onSubmit={handleSubmit}
        submitLabel={t('common.save', lang)}
        maxWidth="max-w-lg"
      >
        <div className="space-y-4 pt-4">
          <FormInput
            label={t('goals.form.title', lang)}
            type="text"
            required
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
          />

          <FormTextarea
            label={t('goals.form.description', lang)}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            rows={3}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label={t('goals.form.targetAmount', lang)}
              type="number"
              required
              value={formData.targetAmount}
              onChange={e => setFormData({ ...formData, targetAmount: e.target.value })}
            />
            <FormInput
              label={t('goals.form.currentAmount', lang)}
              type="number"
              value={formData.currentAmount}
              onChange={e => setFormData({ ...formData, currentAmount: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label={t('goals.form.deadline', lang)}
              type="date"
              value={formData.deadline}
              onChange={e => setFormData({ ...formData, deadline: e.target.value })}
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
      </ModalForm>
    </div>
  );
};

export default Goals;
