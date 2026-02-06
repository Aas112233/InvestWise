import React, { useState, useEffect, useMemo } from 'react';
import {
    Briefcase,
    Calendar,
    DollarSign,
    FileText,
    TrendingUp,
    TrendingDown,
    ShieldCheck,
    Database,
    ArrowRight,
    Calculator,
    AlertCircle
} from 'lucide-react';
import { Project, Fund, AccessLevel, AppScreen } from '../types';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import { ModalForm, FormInput, FormSelect, FormTextarea } from './ui/FormElements';
import Toast, { ToastType } from './Toast';
import { Language, t } from '../i18n/translations';
import { formatCurrency } from '../utils/formatters';

interface ProjectTransactionMasterProps {
    lang: Language;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    initialProjectId?: string;
}

const ProjectTransactionMaster: React.FC<ProjectTransactionMasterProps> = ({
    lang,
    isOpen,
    onClose,
    onSuccess,
    initialProjectId
}) => {
    const { projects, funds, refreshData } = useGlobalState();

    // Toast State
    const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
        isVisible: false,
        message: '',
        type: 'success',
    });

    const showToast = (message: string, type: ToastType = 'success') => {
        setToast({ isVisible: true, message, type });
    };

    const [loading, setLoading] = useState(false);
    const [projectId, setProjectId] = useState(initialProjectId || '');
    const [type, setType] = useState<'Earning' | 'Expense'>('Earning');
    const [amount, setAmount] = useState<number>(0);
    const [description, setDescription] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
    const [category, setCategory] = useState('');

    // Selected Project Data
    const selectedProject = useMemo(() =>
        projects.find(p => p.id === projectId),
        [projects, projectId]);

    // Financial calculations
    const preBalance = selectedProject?.currentFundBalance || 0;
    const postBalance = type === 'Earning' ? preBalance + amount : preBalance - amount;
    const isOverBudget = type === 'Expense' && selectedProject && (selectedProject.totalExpenses + amount > selectedProject.budget);

    // Ledger Account (Linked Fund)
    const linkedFund = useMemo(() =>
        funds.find(f => f.id === selectedProject?.linkedFundId),
        [funds, selectedProject]);

    useEffect(() => {
        if (initialProjectId) setProjectId(initialProjectId);
    }, [initialProjectId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!projectId) return showToast(t('masterForm.selectProjectError', lang) || 'Please select a project', 'error');
        if (amount <= 0) return showToast(t('masterForm.invalidAmount', lang) || 'Invalid amount', 'error');
        if (!linkedFund) return showToast(t('masterForm.noLinkedFund', lang) || 'Project has no linked ledger account', 'error');

        setLoading(true);
        try {
            const txData = {
                projectId,
                fundId: linkedFund.id,
                amount,
                description,
                category: category || (type === 'Earning' ? 'Revenue' : 'Operational'),
                date: `${date}T${time}:00.000Z`,
                type
            };

            if (type === 'Expense') {
                await financeService.addExpense(txData);
            } else {
                await financeService.addEarning(txData);
            }

            await refreshData();
            showToast(t('masterForm.success', lang) || 'Transaction recorded successfully');
            onSuccess();
            onClose();
            resetForm();
        } catch (error: any) {
            showToast(error.response?.data?.message || t('masterForm.error', lang) || 'Transaction failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setProjectId(initialProjectId || '');
        setAmount(0);
        setDescription('');
        setCategory('');
        setType('Earning');
        setDate(new Date().toISOString().split('T')[0]);
        setTime(new Date().toTimeString().slice(0, 5));
    };

    return (
        <ModalForm
            isOpen={isOpen}
            onClose={onClose}
            title={t('masterForm.title', lang) || 'Project Transaction Master'}
            subtitle={t('masterForm.subtitle', lang) || 'Comprehensive Operational Entry'}
            onSubmit={handleSubmit}
            loading={loading}
            submitLabel={t('common.save', lang)}
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
                {/* Left Column: Core Details */}
                <div className="space-y-8">
                    <FormSelect
                        label={t('masterForm.selectProject', lang) || 'Target Project'}
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        icon={<Briefcase size={18} />}
                        options={projects.map(p => ({
                            value: p.id,
                            label: p.title
                        }))}
                        placeholder={t('masterForm.selectProjectPlaceholder', lang) || "Select transaction project..."}
                        required
                    />

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            type="button"
                            onClick={() => setType('Earning')}
                            className={`p-6 rounded-3xl border-2 transition-all flex flex-col items-center gap-2 ${type === 'Earning'
                                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600'
                                : 'border-gray-100 dark:border-white/5 text-gray-400 hover:border-emerald-200'
                                }`}
                        >
                            <TrendingUp size={24} />
                            <span className="text-[10px] font-black uppercase tracking-widest">
                                {t('masterForm.income', lang) || 'Revenue / Earning'}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setType('Expense')}
                            className={`p-6 rounded-3xl border-2 transition-all flex flex-col items-center gap-2 ${type === 'Expense'
                                ? 'border-rose-500 bg-rose-500/10 text-rose-600'
                                : 'border-gray-100 dark:border-white/5 text-gray-400 hover:border-rose-200'
                                }`}
                        >
                            <TrendingDown size={24} />
                            <span className="text-[10px] font-black uppercase tracking-widest">
                                {t('masterForm.expense', lang) || 'Expenditure / Loss'}
                            </span>
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <FormInput
                            label={t('masterForm.date', lang) || "Transaction Date"}
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            icon={<Calendar size={18} />}
                            required
                        />
                        <FormInput
                            label={t('masterForm.time', lang) || "Execution Time"}
                            type="time"
                            value={time}
                            onChange={(e) => setTime(e.target.value)}
                            required
                        />
                    </div>

                    <FormInput
                        label={t('masterForm.amount', lang) || "Transaction Amount"}
                        type="number"
                        value={amount || ''}
                        onChange={(e) => setAmount(Number(e.target.value))}
                        icon={<DollarSign size={18} />}
                        placeholder="0.00"
                        required
                    />

                </div>

                {/* Right Column: Calculations & Audit */}
                <div className="space-y-8">
                    {/* Ledger Info */}
                    <div className="bg-gray-50 dark:bg-black/20 p-8 rounded-[2.5rem] border border-gray-100 dark:border-white/5">
                        <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                            <Database size={14} className="text-brand" />
                            {t('masterForm.auditLedger', lang) || 'Audit & Ledger Context'}
                        </h4>

                        <div className="space-y-6">
                            <div>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                                    {t('masterForm.ledgerAccount', lang) || 'Mapped Ledger Account'}
                                </p>
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-brand animate-pulse" />
                                    <p className="text-sm font-black dark:text-white uppercase truncate">
                                        {linkedFund ? linkedFund.name : t('masterForm.noFund', lang) || 'No linked fund detected'}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-white dark:bg-white/5 rounded-2xl">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-tight mb-1">
                                        {t('masterForm.preBalance', lang) || 'Pre-Balance'}
                                    </p>
                                    <p className="text-sm font-black dark:text-gray-300">
                                        {formatCurrency(preBalance)}
                                    </p>
                                </div>
                                <div className={`p-4 rounded-2xl ${type === 'Earning' ? 'bg-emerald-500/5 border border-emerald-500/10' : 'bg-rose-500/5 border border-rose-500/10'}`}>
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-tight mb-1">
                                        {t('masterForm.postBalance', lang) || 'Post-Balance'}
                                    </p>
                                    <p className={`text-sm font-black ${type === 'Earning' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {formatCurrency(postBalance)}
                                    </p>
                                </div>
                            </div>

                            {isOverBudget && (
                                <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                                    <AlertCircle size={16} className="text-amber-500 shrink-0" />
                                    <p className="text-[10px] font-black text-amber-500 uppercase leading-tight">
                                        {t('masterForm.overBudget', lang) || 'Warning: This expenditure exceeds the allocated project budget.'}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Impact Analysis */}
                    {selectedProject && (
                        <div className="bg-brand/5 p-8 rounded-[2.5rem] border border-brand/10">
                            <h4 className="text-[11px] font-black text-brand uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                                <Calculator size={14} />
                                {t('masterForm.impactAnalysis', lang) || 'Live Impact Analysis'}
                            </h4>

                            <div className="space-y-4">
                                <div className="flex justify-between items-end">
                                    <span className="text-[10px] font-black text-gray-500 uppercase">{t('masterForm.utilization', lang) || 'Capital Utilization'}</span>
                                    <span className="text-xs font-black dark:text-white">
                                        {Math.round(((selectedProject.totalExpenses + (type === 'Expense' ? amount : 0)) / selectedProject.budget) * 100)}%
                                    </span>
                                </div>
                                <div className="h-2 w-full bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all duration-1000 ${isOverBudget ? 'bg-rose-500' : 'bg-brand'}`}
                                        style={{ width: `${Math.min(100, (selectedProject.totalExpenses + (type === 'Expense' ? amount : 0)) / selectedProject.budget * 100)}%` }}
                                    />
                                </div>
                                <p className="text-[9px] font-bold text-gray-400 leading-relaxed italic">
                                    {t('masterForm.disclaimer', lang) || '* Entry will be recorded in the global transaction protocol and verified by automated audit sub-systems.'}
                                </p>
                            </div>
                        </div>
                    )}

                    <FormTextarea
                        label={t('masterForm.rationale', lang) || "Transaction Narrative / Memo"}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('masterForm.rationalePlaceholder', lang) || "Internal notes for this entry..."}
                        required
                    />
                </div>
            </div>
            <Toast
                isVisible={toast.isVisible}
                message={toast.message}
                type={toast.type}
                onClose={() => setToast({ ...toast, isVisible: false })}
            />
        </ModalForm>
    );
};

export default ProjectTransactionMaster;
