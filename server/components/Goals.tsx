import React, { useState, useEffect } from 'react';
import { Target, Plus, Search, Calendar, DollarSign, TrendingUp, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { t, Language } from '../i18n/translations';
import { goalService, projectService } from '../services/api';
import { Goal, Project } from '../types';
import toast from 'react-hot-toast';

interface GoalsProps {
    lang: Language;
}

const Goals: React.FC<GoalsProps> = ({ lang }) => {
    const [goals, setGoals] = useState<Goal[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

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
            const [goalsData, projectsData] = await Promise.all([
                goalService.getAll(),
                projectService.getAll()
            ]);
            setGoals(goalsData);
            setProjects(projectsData);
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

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'Savings': return <DollarSign size={18} />;
            case 'Investment': return <TrendingUp size={18} />;
            default: return <Target size={18} />;
        }
    };

    // Stats calculation
    const totalTarget = goals.reduce((acc, g) => acc + g.targetAmount, 0);
    const totalAchieved = goals.filter(g => g.status === 'Achieved').length;
    const totalInProgress = goals.filter(g => g.status === 'In Progress').length;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
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
                <button
                    onClick={() => { resetForm(); setIsModalOpen(true); }}
                    className="flex items-center gap-2 bg-[#BFF300] hover:bg-[#aade00] text-black px-6 py-3 rounded-2xl font-bold transition-all transform hover:scale-105 shadow-lg shadow-[#BFF300]/20"
                >
                    <Plus size={20} strokeWidth={2.5} />
                    {t('goals.addGoal', lang)}
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-[#1A221D] p-6 rounded-3xl border border-gray-100 dark:border-white/5 shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-2xl text-purple-600 dark:text-purple-400">
                            <Target size={24} />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{t('goals.stats.totalGoals', lang)}</span>
                    </div>
                    <div className="text-3xl font-black text-gray-900 dark:text-white">{goals.length}</div>
                </div>

                <div className="bg-white dark:bg-[#1A221D] p-6 rounded-3xl border border-gray-100 dark:border-white/5 shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-2xl text-green-600 dark:text-green-400">
                            <CheckCircle2 size={24} />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{t('goals.stats.achieved', lang)}</span>
                    </div>
                    <div className="text-3xl font-black text-gray-900 dark:text-white">{totalAchieved}</div>
                </div>

                <div className="bg-white dark:bg-[#1A221D] p-6 rounded-3xl border border-gray-100 dark:border-white/5 shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl text-blue-600 dark:text-blue-400">
                            <TrendingUp size={24} />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{t('goals.stats.inProgress', lang)}</span>
                    </div>
                    <div className="text-3xl font-black text-gray-900 dark:text-white">{totalInProgress}</div>
                </div>

                <div className="bg-white dark:bg-[#1A221D] p-6 rounded-3xl border border-gray-100 dark:border-white/5 shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-2xl text-orange-600 dark:text-orange-400">
                            <DollarSign size={24} />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{t('goals.stats.totalTarget', lang)}</span>
                    </div>
                    <div className="text-2xl font-black text-gray-900 dark:text-white truncate" title={totalTarget.toLocaleString()}>
                        ৳ {Math.round(totalTarget / 1000)}k
                    </div>
                </div>
            </div>

            {/* Goals Grid */}
            {isLoading ? (
                <div className="text-center py-20">
                    <div className="animate-spin w-10 h-10 border-4 border-gray-200 border-t-purple-600 rounded-full mx-auto mb-4"></div>
                    <p className="text-gray-500">Loading goals...</p>
                </div>
            ) : goals.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-[#1A221D] rounded-3xl border border-dashed border-gray-300 dark:border-white/10">
                    <div className="bg-gray-50 dark:bg-white/5 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Target size={32} className="text-gray-400" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('goals.list.noGoals', lang)}</h3>
                    <p className="text-gray-500">{t('goals.subtitle', lang)}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {goals.map((goal) => {
                        const progress = calculateProgress(goal.currentAmount, goal.targetAmount);
                        const remaining = goal.targetAmount - goal.currentAmount;
                        const daysLeft = goal.deadline ? Math.ceil((new Date(goal.deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : null;

                        return (
                            <motion.div
                                key={goal._id}
                                layout
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                whileHover={{ y: -5 }}
                                className="bg-white dark:bg-[#1A221D] rounded-[2rem] p-6 border border-gray-100 dark:border-white/5 shadow-sm hover:shadow-xl hover:shadow-gray-200/50 dark:hover:shadow-black/50 transition-all duration-300 group relative overflow-hidden"
                            >
                                <div className={`absolute top-0 left-0 w-2 h-full ${goal.type === 'Savings' ? 'bg-emerald-400' :
                                    goal.type === 'Investment' ? 'bg-purple-400' : 'bg-blue-400'
                                    }`}></div>

                                <div className="flex justify-between items-start mb-6 pl-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-3 rounded-2xl ${goal.type === 'Savings' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' :
                                            goal.type === 'Investment' ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600'
                                            }`}>
                                            {getTypeIcon(goal.type)}
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{goal.title}</h3>
                                            <span className={`text-xs font-bold px-2 py-1 rounded-full mt-1 inline-block ${getStatusColor(goal.status)}`}>
                                                {t(`goals.form.statuses.${goal.status === 'In Progress' ? 'inProgress' : goal.status === 'Achieved' ? 'achieved' : 'cancelled'}`, lang)}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                                        <button onClick={() => openEditModal(goal)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl">
                                            {t('common.edit', lang)}
                                        </button>
                                        <button onClick={() => handleDelete(goal._id)} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 rounded-xl">
                                            <XCircle size={18} />
                                        </button>
                                    </div>
                                </div>

                                <div className="pl-4 space-y-6">
                                    {/* Progress Section */}
                                    <div>
                                        <div className="flex justify-between text-sm mb-2">
                                            <span className="text-gray-500 dark:text-gray-400 font-medium">{t('goals.list.progress', lang)}</span>
                                            <span className="font-bold text-gray-900 dark:text-white">{progress}%</span>
                                        </div>
                                        <div className="h-4 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${progress}%` }}
                                                transition={{ duration: 1, ease: 'easeOut' }}
                                                className={`h-full rounded-full ${progress >= 100 ? 'bg-green-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'
                                                    }`}
                                            ></motion.div>
                                        </div>
                                    </div>

                                    {/* Financial Details */}
                                    <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-white/5 p-4 rounded-2xl">
                                        <div>
                                            <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('goals.form.currentAmount', lang)}</span>
                                            <span className="text-lg font-black text-gray-900 dark:text-white">৳ {goal.currentAmount.toLocaleString()}</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('goals.form.targetAmount', lang)}</span>
                                            <span className="text-lg font-black text-gray-900 dark:text-white">৳ {goal.targetAmount.toLocaleString()}</span>
                                        </div>
                                    </div>

                                    {/* Footer Info */}
                                    <div className="flex justify-between items-center text-xs font-medium text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-white/5">
                                        <div className="flex items-center gap-1">
                                            <Calendar size={14} />
                                            {goal.deadline ? new Date(goal.deadline).toLocaleDateString() : 'No deadline'}
                                        </div>
                                        {daysLeft !== null && (
                                            <span className={`${daysLeft < 0 ? 'text-red-500' : 'text-blue-500'}`}>
                                                {daysLeft < 0 ? 'Overdue' : `${daysLeft} ${t('goals.list.daysLeft', lang)}`}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            {/* Modal */}
            <AnimatePresence>
                {isModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="bg-white dark:bg-[#1A221D] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
                        >
                            <div className="p-6 border-b border-gray-100 dark:border-white/5 flex justify-between items-center">
                                <h2 className="text-xl font-black text-gray-900 dark:text-white">
                                    {editingGoal ? t('goals.editGoal', lang) : t('goals.addGoal', lang)}
                                </h2>
                                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full">
                                    <XCircle size={24} className="text-gray-500" />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{t('goals.form.title', lang)}</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.title}
                                        onChange={e => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border-none focus:ring-2 focus:ring-[#BFF300] dark:text-white"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{t('goals.form.targetAmount', lang)}</label>
                                        <input
                                            type="number"
                                            required
                                            value={formData.targetAmount}
                                            onChange={e => setFormData({ ...formData, targetAmount: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border-none focus:ring-2 focus:ring-[#BFF300] dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{t('goals.form.currentAmount', lang)}</label>
                                        <input
                                            type="number"
                                            value={formData.currentAmount}
                                            onChange={e => setFormData({ ...formData, currentAmount: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border-none focus:ring-2 focus:ring-[#BFF300] dark:text-white"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{t('goals.form.deadline', lang)}</label>
                                        <input
                                            type="date"
                                            value={formData.deadline}
                                            onChange={e => setFormData({ ...formData, deadline: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border-none focus:ring-2 focus:ring-[#BFF300] dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{t('goals.form.type', lang)}</label>
                                        <select
                                            value={formData.type}
                                            onChange={e => setFormData({ ...formData, type: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border-none focus:ring-2 focus:ring-[#BFF300] dark:text-white"
                                        >
                                            <option value="Savings">{t('goals.form.types.savings', lang)}</option>
                                            <option value="Investment">{t('goals.form.types.investment', lang)}</option>
                                            <option value="Other">{t('goals.form.types.other', lang)}</option>
                                        </select>
                                    </div>
                                </div>

                                {editingGoal && (
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{t('goals.form.status', lang)}</label>
                                        <select
                                            value={formData.status}
                                            onChange={e => setFormData({ ...formData, status: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border-none focus:ring-2 focus:ring-[#BFF300] dark:text-white"
                                        >
                                            <option value="In Progress">{t('goals.form.statuses.inProgress', lang)}</option>
                                            <option value="Achieved">{t('goals.form.statuses.achieved', lang)}</option>
                                            <option value="Cancelled">{t('goals.form.statuses.cancelled', lang)}</option>
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{t('goals.form.linkedProject', lang)}</label>
                                    <select
                                        value={formData.linkedProject}
                                        onChange={e => setFormData({ ...formData, linkedProject: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border-none focus:ring-2 focus:ring-[#BFF300] dark:text-white"
                                    >
                                        <option value="">{t('goals.form.selectProject', lang)}</option>
                                        {Array.isArray(projects) && projects.map(p => (
                                            <option key={p.id} value={p.id}>{p.title}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex gap-4 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="flex-1 px-6 py-3 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                                    >
                                        {t('common.cancel', lang)}
                                    </button>
                                    <button
                                        type="submit"
                                        className="flex-1 px-6 py-3 rounded-xl bg-[#BFF300] text-black font-bold hover:bg-[#aade00] transition-colors"
                                    >
                                        {t('common.save', lang)}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Goals;
