
import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
 History as HistoryIcon,
 ArrowRightLeft,
 PieChart,
 TrendingUp,
 Users,
 ShieldCheck,
 AlertCircle,
 Briefcase,
 Wallet,
 CheckCircle2,
 MinusCircle,
 PlusCircle,
 Info,
 RefreshCw,
 Eye
} from 'lucide-react';
import { useGlobalState } from '../context/GlobalStateContext';
import { Member, Project, Fund, AccessLevel, AppScreen } from '../types';
import Toast, { ToastType } from './Toast';
import { formatCurrency } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import { financeService } from '../services/api';
import Pagination from './Pagination';
import SearchBar from './SearchBar';
import { Table, TableColumn } from './ui/Table';

interface DividendManagementProps {
 lang: Language;
}

const DividendManagement: React.FC<DividendManagementProps> = ({ lang }) => {
 const { members, projects, funds, refreshData, distributeDividends, transferEquity, currentUser, currencyCode } = useGlobalState();
 const [searchParams] = useSearchParams();
 const [activeTab, setActiveTab] = useState<'distribution' | 'transfer'>('distribution');
 const [distributionType, setDistributionType] = useState<'Project' | 'Global'>('Project');
 const [selectedProjectId, setSelectedProjectId] = useState<string>('');
 const [selectedFundId, setSelectedFundId] = useState<string>('');
 const [payoutAmount, setPayoutAmount] = useState<number>(0);
 const [description, setDescription] = useState<string>('');
 const [showPreview, setShowPreview] = useState(false);

 // History Pagination State
 const [history, setHistory] = useState<any[]>([]);
 const [historyLoading, setHistoryLoading] = useState(false);
 const [currentPage, setCurrentPage] = useState(1);
 const [totalPages, setTotalPages] = useState(1);
 const [rowsPerPage, setRowsPerPage] = useState(10);
 const [historyMeta, setHistoryMeta] = useState<any>(null);

 const fetchHistory = async () => {
 setHistoryLoading(true);
 try {
 const response = await financeService.getTransactions({
 page: currentPage,
 limit: rowsPerPage,
 type: 'Dividend', // We can also include 'Equity-Transfer' if we want unified history
 sortBy: 'date',
 sortOrder: 'desc'
 });
 setHistory(response.data);
 setTotalPages(response.pages);
 setHistoryMeta(response.meta);
 } catch (err) {
 console.error('Failed to fetch dividend history', err);
 } finally {
 setHistoryLoading(false);
 }
 };

 useEffect(() => {
 fetchHistory();
 }, [currentPage, rowsPerPage]);

 // Handle Deep Linking
 useEffect(() => {
 const pid = searchParams.get('projectId');
 if (pid) {
 setSelectedProjectId(pid);
 setDistributionType('Project');
 }
 }, [searchParams]);

 // Toast State
 const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
 isVisible: false,
 message: '',
 type: 'success',
 });

 const showToast = (message: string, type: ToastType = 'success') => {
 setToast({ isVisible: true, message, type });
 };

 // Transfer State
 const [fromMemberId, setFromMemberId] = useState<string>('');
 const [transferDesc, setTransferDesc] = useState<string>(t('dividends.transferMemo', lang));
 const [transfers, setTransfers] = useState<{ toMemberId: string; amount: number; shares: number }[]>([
 { toMemberId: '', amount: 0, shares: 0 }
 ]);

 const activeMembers = useMemo(() => members.filter(m => m.status === 'active'), [members]);
 const totalShares = useMemo(() => activeMembers.reduce((sum, m) => sum + m.shares, 0), [activeMembers]);

 const selectedProject = useMemo(() =>
 projects.find(p => p.id === selectedProjectId),
 [projects, selectedProjectId]
 );

 const projectMetrics = useMemo(() => {
 if (!selectedProject) return { surplus: 0, balance: 0, earnings: 0, expenses: 0, investment: 0, isNegative: false };
 const earnings = selectedProject.totalEarnings || 0;
 const expenses = selectedProject.totalExpenses || 0;
 const investment = selectedProject.initialInvestment || 0;

 // Distributable Surplus: Profit above initial capital
 const calculatedSurplus = earnings - expenses - investment;
 const surplus = Math.max(0, calculatedSurplus);

 return {
 surplus,
 balance: selectedProject.currentFundBalance || 0,
 earnings,
 expenses,
 investment,
 isNegative: calculatedSurplus < 0
 };
 }, [selectedProject]);

 const fromMember = useMemo(() =>
 members.find(m => m.id === fromMemberId),
 [members, fromMemberId]
 );

 const handleDistribute = async () => {
 if (distributionType === 'Project' && !selectedProjectId) return showToast(t('dividends.selectProjectError', lang), 'error');
 if (distributionType === 'Global' && !selectedFundId) return showToast(t('dividends.selectFundError', lang), 'error');
 if (payoutAmount <= 0) return showToast(t('dividends.invalidAmount', lang), 'error');

 // Validate sufficient balance
 if (distributionType === 'Project' && selectedProject) {
 if (payoutAmount > selectedProject.currentFundBalance) {
 return showToast(t('dividends.payoutExceedsBalance', lang), 'error');
 }
 }

 try {
 await distributeDividends({
 type: distributionType,
 amount: payoutAmount,
 projectId: distributionType === 'Project' ? selectedProjectId : null,
 sourceFundId: distributionType === 'Global' ? selectedFundId : null,
 description
 });

 showToast(t('dividends.distSuccess', lang));
 await refreshData();
 await fetchHistory();
 setPayoutAmount(0);
 setDescription('');
 setShowPreview(false);
 } catch (error: any) {
 // Extract detailed error message
 let errorMessage = t('dividends.distError', lang);

 if (error.response?.data?.message) {
 errorMessage = error.response.data.message;
 } else if (error.response?.data?.error) {
 errorMessage = error.response.data.error;
 } else if (error.message) {
 errorMessage = error.message;
 }

 // User-friendly translations
 if (errorMessage.includes('Insufficient')) {
 errorMessage = t('dividends.insufficientBalance', lang);
 } else if (errorMessage.includes('No active shares')) {
 errorMessage = t('dividends.noActiveShares', lang);
 } else if (errorMessage.includes('not found')) {
 errorMessage = t('dividends.projectNotFound', lang);
 }

 showToast(errorMessage, 'error');
 }
 };

 const addTransferRow = () => {
 setTransfers([...transfers, { toMemberId: '', amount: 0, shares: 0 }]);
 };

 const removeTransferRow = (index: number) => {
 setTransfers(transfers.filter((_, i) => i !== index));
 };

 const updateTransfer = (index: number, field: string, value: any) => {
 const updated = [...transfers];
 updated[index] = { ...updated[index], [field]: value };
 setTransfers(updated);
 };

 const handleEquityTransfer = async () => {
 if (!fromMemberId) return showToast(t('dividends.selectSourceError', lang), 'error');
 if (transfers.some(t => !t.toMemberId || t.amount <= 0 || t.shares <= 0)) {
 return showToast(t('dividends.accuracyError', lang), 'error');
 }

 // Validate: can't transfer to self
 if (transfers.some(t => t.toMemberId === fromMemberId)) {
 return showToast(t('dividends.selfTransferError', lang), 'error');
 }

 // Validate: total doesn't exceed source
 const totalAmount = transfers.reduce((sum, t) => sum + t.amount, 0);
 const totalShares = transfers.reduce((sum, t) => sum + t.shares, 0);

 if (fromMember && totalAmount > fromMember.totalContributed) {
 return showToast(t('dividends.insufficientContribution', lang), 'error');
 }
 if (fromMember && totalShares > fromMember.shares) {
 return showToast(t('dividends.insufficientShares', lang), 'error');
 }

 try {
 await transferEquity({
 fromMemberId,
 transfers,
 reason: transferDesc
 });

 showToast(t('dividends.migrationSuccess', lang));
 await refreshData();
 setFromMemberId('');
 setTransfers([{ toMemberId: '', amount: 0, shares: 0 }]);
 } catch (error: any) {
 // Extract detailed error message from backend response
 let errorMessage = t('dividends.transferError', lang);

 if (error.response?.data?.message) {
 errorMessage = error.response.data.message;
 } else if (error.response?.data?.error) {
 errorMessage = error.response.data.error;
 } else if (error.message) {
 errorMessage = error.message;
 }

 // Common error translations
 if (errorMessage.includes('Insufficient contribution')) {
 errorMessage = t('dividends.insufficientContribution', lang);
 } else if (errorMessage.includes('Insufficient shares')) {
 errorMessage = t('dividends.insufficientShares', lang);
 } else if (errorMessage.includes('not found')) {
 errorMessage = t('dividends.memberNotFound', lang);
 } else if (errorMessage.includes('not active')) {
 errorMessage = t('dividends.targetNotActive', lang);
 } else if (errorMessage.includes('Self-transfer')) {
 errorMessage = t('dividends.selfTransferError', lang);
 }

 showToast(errorMessage, 'error');
 }
 };

 const dividendHistoryColumns: TableColumn<any>[] = [
 {
 key: 'date',
 header: t('transactions.date', lang),
 render: (tx) => <span className="text-xs font-bold text-gray-400">{new Date(tx.date).toLocaleDateString()}</span>
 },
 {
 key: 'description',
 header: t('transactions.description', lang),
 render: (tx) => (
 <div>
 <p className="text-sm font-black dark:text-white leading-tight">{tx.description}</p>
 {tx.projectId && (
 <p className="text-[9px] font-black text-brand uppercase mt-1 tracking-widest">Project Settlement</p>
 )}
 </div>
 )
 },
 {
 key: 'recipient',
 header: t('dividends.recipient', lang),
 render: (tx) => (
 <div className="flex flex-col">
 <span className="text-xs font-black dark:text-white uppercase">{tx.memberId?.name || 'N/A'}</span>
 <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tight">ID: {tx.memberId?.memberId || 'UNKNOWN'}</span>
 </div>
 )
 },
 {
 key: 'payout',
 header: t('dividends.payout', lang),
 align: 'right',
 render: (tx) => <span className="font-black text-brand text-sm">{formatCurrency(tx.amount)}</span>
 },
 {
 key: 'status',
 header: t('transactions.status', lang),
 align: 'right',
 render: () => (
 <span className="inline-block px-4 py-1.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase tracking-widest">
 Distributed
 </span>
 )
 }
 ];

 return (
 <div className="compact-screen space-y-6 animate-in fade-in duration-700">
 <Toast
 isVisible={toast.isVisible}
 message={toast.message}
 type={toast.type}
 onClose={() => setToast({ ...toast, isVisible: false })}
 />
 {/* Header */}
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2">
 <div>
 <h1 className="text-2xl font-black tracking-tight dark:text-white uppercase italic">
 {t('nav.dividends', lang)}
 </h1>
 <nav className="text-[11px] font-black text-gray-400 mt-2 flex items-center gap-2 uppercase tracking-widest">
 <span>{t('nav.operations', lang)}</span>
 <span className="opacity-30">/</span>
 <span className="text-brand">{t('nav.dividends', lang)}</span>
 </nav>
 </div>

 <div className="bg-white dark:bg-white/5 p-1.5 rounded-xl flex gap-1">
 <button
 onClick={() => setActiveTab('distribution')}
 className={`px-6 py-3 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all ${activeTab === 'distribution'
 ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-xl'
 : 'text-gray-400 hover:text-dark dark:hover:text-white'
 }`}
 >
 {t('dividends.payoutTab', lang)}
 </button>
 <button
 onClick={() => setActiveTab('transfer')}
 className={`px-6 py-3 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all ${activeTab === 'transfer'
 ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-xl'
 : 'text-gray-400 hover:text-dark dark:hover:text-white'
 }`}
 >
 {t('dividends.transferTab', lang)}
 </button>
 </div>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

 {activeTab === 'distribution' ? (
 <>
 {/* Distribution Setup */}
 <div className="lg:col-span-2 space-y-6">
 <div className="bg-white dark:bg-[#1A221D] p-6 rounded-xl card-shadow border border-gray-100 dark:border-white/5">
 <div className="flex items-center gap-3 mb-6">
 <div className="w-12 h-12 bg-brand/10 dark:bg-brand rounded-xl flex items-center justify-center text-brand dark:text-dark shadow-inner">
 <PieChart size={30} />
 </div>
 <div>
 <h3 className="text-xl font-black dark:text-white">{t('dividends.payoutConfig', lang)}</h3>
 <p className="text-gray-400 font-bold text-xs uppercase tracking-widest mt-1">{t('dividends.configSub', lang)}</p>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
 <div className="space-y-4">
 <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('dividends.distType', lang)}</label>
 <div className="grid grid-cols-2 gap-3">
 <button
 onClick={() => setDistributionType('Project')}
 className={`p-4 rounded-xl border-2 transition-all font-black text-[11px] uppercase tracking-wider ${distributionType === 'Project'
 ? 'border-brand bg-brand/5 text-dark dark:text-brand'
 : 'border-gray-100 dark:border-white/5 text-gray-400'
 }`}
 >
 <Briefcase className="mb-2 mx-auto" size={20} />
 {t('dividends.projectSurplus', lang)}
 </button>
 <button
 onClick={() => setDistributionType('Global')}
 className={`p-4 rounded-xl border-2 transition-all font-black text-[11px] uppercase tracking-wider ${distributionType === 'Global'
 ? 'border-brand bg-brand/5 text-dark dark:text-brand'
 : 'border-gray-100 dark:border-white/5 text-gray-400'
 }`}
 >
 <TrendingUp className="mb-2 mx-auto" size={20} />
 {t('dividends.globalSettlement', lang)}
 </button>
 </div>
 </div>

 <div className="space-y-4">
 <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">
 {distributionType === 'Project' ? t('dividends.selectProject', lang) : t('dividends.selectSourceFund', lang)}
 </label>
 {distributionType === 'Project' ? (
 <select
 value={selectedProjectId}
 onChange={(e) => setSelectedProjectId(e.target.value)}
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-6 rounded-xl font-black text-xs appearance-none focus:border-brand dark:text-white transition-all shadow-inner"
 >
 <option value="">{t('dividends.selectVenture', lang)}</option>
 {projects.map(p => (
 <option key={p.id} value={p.id}>{p.title} (Balance: {p.currentFundBalance})</option>
 ))}
 </select>
 ) : (
 <select
 value={selectedFundId}
 onChange={(e) => setSelectedFundId(e.target.value)}
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-6 rounded-xl font-black text-xs appearance-none focus:border-brand dark:text-white transition-all shadow-inner"
 >
 <option value="">{t('dividends.selectPrimaryFund', lang)}</option>
 {funds.map(f => (
 <option key={f.id} value={f.id}>{f.name} ({f.balance})</option>
 ))}
 </select>
 )}
 </div>
 </div>

 <div className="flex flex-col gap-3 mb-6">
 <div className="flex justify-between items-center px-1">
 <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">{t('dividends.payoutAmount', lang)}</label>
 {distributionType === 'Project' && selectedProject && (
 <div className="flex gap-3">
 <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${projectMetrics.isNegative ? 'text-amber-500 bg-amber-500/10' : 'text-emerald-400 bg-emerald-400/10'}`}>
 {t('dividends.surplus', lang)} {formatCurrency(projectMetrics.surplus)}
 </span>
 <span className="text-[10px] font-black text-brand uppercase tracking-widest bg-brand/10 px-3 py-1 rounded-full">
 {t('dividends.liquid', lang)} {formatCurrency(projectMetrics.balance)}
 </span>
 </div>
 )}
 </div>

 {distributionType === 'Project' && selectedProject && (
 <div className="grid grid-cols-3 gap-3 px-1">
 <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/5">
 <p className="text-[9px] font-black text-gray-400 uppercase mb-1">{t('dividends.totalRevenue', lang)}</p>
 <p className="text-xs font-black text-emerald-500">{formatCurrency(projectMetrics.earnings)}</p>
 </div>
 <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/5">
 <p className="text-[9px] font-black text-gray-400 uppercase mb-1">{t('dividends.opsCosts', lang)}</p>
 <p className="text-xs font-black text-rose-500">{formatCurrency(projectMetrics.expenses)}</p>
 </div>
 <div className="bg-gray-50 dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/5">
 <p className="text-[9px] font-black text-gray-400 uppercase mb-1">{t('dividends.capitalBase', lang)}</p>
 <p className="text-xs font-black text-gray-300">{formatCurrency(projectMetrics.investment)}</p>
 </div>
 </div>
 )}
 </div>
 <div className="relative group mb-6">
 <div className="absolute left-8 top-1/2 -translate-y-1/2 text-brand font-black text-xl italic group-focus-within:scale-125 transition-all">{currencyCode}</div>
 <input
 type="number"
 value={payoutAmount || ''}
 onChange={(e) => setPayoutAmount(Number(e.target.value))}
 placeholder="0.00"
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 py-6 pl-20 pr-10 rounded-xl text-2xl font-black focus:border-brand dark:text-white transition-all outline-none shadow-inner"
 />
 </div>
 </div>

 <div className="space-y-4 mb-12">
 <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('dividends.distMemo', lang)}</label>
 <textarea
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder={t('dividends.rationalePlaceholder', lang)}
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-6 rounded-xl font-bold text-sm focus:border-brand dark:text-white transition-all outline-none resize-none shadow-inner h-24"
 />
 </div>

 <div className="flex gap-3">
 {currentUser?.permissions[AppScreen.DIVIDENDS] === AccessLevel.WRITE ? (
 <>
 <button
 onClick={() => setShowPreview(!showPreview)}
 disabled={payoutAmount <= 0}
 className="flex-1 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 text-dark dark:text-white py-6 rounded-xl font-black uppercase tracking-[0.2em] text-sm hover:bg-gray-50 dark:hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
 >
 <Eye size={18} />
 {showPreview ? t('common.hidePreview', lang) || 'Hide Preview' : t('common.preview', lang) || 'Preview Payout'}
 </button>
 <button
 onClick={handleDistribute}
 disabled={payoutAmount <= 0}
 className="flex-[2] bg-dark dark:bg-brand text-white dark:text-dark py-6 rounded-xl font-black uppercase tracking-[0.2em] text-sm shadow-2xl shadow-brand/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:scale-100"
 >
 <ShieldCheck size={18} strokeWidth={3} />
 {t('dividends.authorize', lang)}
 </button>
 </>
 ) : (
 <div className="w-full p-6 rounded-xl bg-amber-500/5 border border-amber-500/20 text-center">
 <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">{t('dividends.readOnlyMode', lang)}</p>
 <p className="text-xs font-bold text-gray-400 mt-1">{t('dividends.restrictedOfficer', lang)}</p>
 </div>
 )}
 </div>

 {/* Preview Panel */}
 {showPreview && payoutAmount > 0 && (
 <div className="mt-6 bg-gray-50 dark:bg-black/20 p-6 rounded-xl border border-brand/20 animate-in slide-in-from-top-6">
 <h4 className="text-[11px] font-black text-brand uppercase tracking-widest mb-4 flex items-center gap-2">
 <HistoryIcon size={12} />
 {t('dividends.payoutPreview', lang) || 'Payout Distribution Preview'}
 </h4>
 <div className="space-y-3">
 {activeMembers.slice(0, 5).map(m => (
 <div key={m.id} className="flex justify-between items-center p-3 bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5">
 <div>
 <p className="text-xs font-black dark:text-white">{m.name}</p>
 <p className="text-[9px] font-bold text-gray-400 uppercase">{m.shares} Shares ({totalShares > 0 ? (m.shares / totalShares * 100).toFixed(2) : '0.00'}%)</p>
 </div>
 <p className="text-sm font-black text-brand">{formatCurrency(totalShares > 0 ? (m.shares / totalShares) * payoutAmount : 0)}</p>
 </div>
 ))}
 {activeMembers.length > 5 && (
 <p className="text-center text-[10px] font-black text-gray-400 uppercase tracking-widest mt-4">...and {activeMembers.length - 5} more members</p>
 )}
 </div>
 <div className="mt-6 pt-6 border-t border-gray-100 dark:border-white/10 flex justify-between items-center">
 <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Distribution</span>
 <span className="text-xl font-black dark:text-white">{formatCurrency(payoutAmount)}</span>
 </div>
 </div>
 )}
 </div>

 {/* Side Stats */}
 <div className="space-y-6">
 <div className="bg-white dark:bg-[#1A221D] p-6 rounded-xl card-shadow border border-gray-100 dark:border-white/5 overflow-hidden relative">
 <div className="absolute -right-4 -top-4 w-32 h-32 bg-brand/5 rounded-full blur-3xl"></div>
 <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
 <Users size={14} className="text-brand" />
 {t('dividends.stakeholderMatrix', lang)}
 </h4>
 <div className="space-y-6">
 <div className="flex justify-between items-end border-b border-gray-50 dark:border-white/5 pb-4">
 <span className="text-gray-400 font-bold text-xs uppercase">{t('dividends.totalRecipients', lang)}</span>
 <span className="text-xl font-black dark:text-white">{activeMembers.length}</span>
 </div>
 <div className="flex justify-between items-end border-b border-gray-50 dark:border-white/5 pb-4">
 <span className="text-gray-400 font-bold text-xs uppercase">{t('dividends.floatingShares', lang)}</span>
 <span className="text-xl font-black dark:text-white">{totalShares}</span>
 </div>
 <div className="flex justify-between items-end">
 <span className="text-gray-400 font-bold text-xs uppercase">{t('dividends.valuePerShare', lang)}</span>
 <span className="text-xl font-black text-brand">
 {payoutAmount > 0 && totalShares > 0 ? (payoutAmount / totalShares).toFixed(4) : '0.0000'}
 </span>
 </div>
 </div>
 </div>

 <div className="bg-[#1A221D] p-6 rounded-xl shadow-2xl relative overflow-hidden group">
 <div className="absolute top-0 right-0 p-6 text-white/5 group-hover:text-brand/20 transition-all">
 <Info size={80} strokeWidth={1} />
 </div>
 <h4 className="text-[11px] font-black text-brand uppercase tracking-[0.3em] mb-4">{t('dividends.execLogic', lang)}</h4>
 <p className="text-gray-400 text-xs font-bold leading-relaxed relative z-10">
 {t('dividends.logicDesc', lang)}
 </p>
 <div className="mt-6 flex gap-3 relative z-10">
 <div className="px-4 py-2 rounded-xl bg-white/5 text-[10px] font-black text-white uppercase tracking-wider">{t('dividends.automatedAudit', lang)}</div>
 <div className="px-4 py-2 rounded-xl bg-white/5 text-[10px] font-black text-white uppercase tracking-wider">{t('dividends.immutableHistory', lang)}</div>
 </div>
 </div>
 </div>
 </>
 ) : (
 /* Asset Transfer Interface */
 <div className="lg:col-span-3 space-y-6">
 <div className="bg-white dark:bg-[#1A221D] p-6 rounded-xl card-shadow border border-gray-100 dark:border-white/5">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
 <div className="flex items-center gap-3">
 <div className="w-12 h-12 bg-brand/10 dark:bg-brand rounded-xl flex items-center justify-center text-brand dark:text-dark">
 <ArrowRightLeft size={24} />
 </div>
 <div>
 <h3 className="text-xl font-black dark:text-white">{t('dividends.migrationEngine', lang)}</h3>
 <p className="text-gray-400 font-bold text-xs uppercase tracking-widest mt-1">{t('dividends.migrationSub', lang)}</p>
 </div>
 </div>

 <div className="flex-1 max-w-md">
 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-4 mb-2 block text-right">{t('dividends.sourceMember', lang)}</label>
 <select
 value={fromMemberId}
 onChange={(e) => setFromMemberId(e.target.value)}
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-4 rounded-xl font-black text-xs transition-all shadow-inner text-right"
 >
 <option value="">{t('dividends.selectDeparting', lang)}</option>
 {activeMembers.map(m => (
 <option key={m.id} value={m.id}>{m.name} (Shares: {m.shares}, Cap: {m.totalContributed})</option>
 ))}
 </select>
 </div>
 </div>

 {fromMember && (
 <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 animate-in slide-in-from-top-4">
 <div className="p-6 rounded-xl bg-brand text-dark shadow-xl">
 <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2">{t('dividends.totalContribution', lang)}</p>
 <p className="text-2xl font-black italic">{formatCurrency(fromMember.totalContributed)}</p>
 </div>
 <div className="p-6 rounded-xl bg-dark text-white shadow-xl dark:bg-white/5">
 <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">{t('dividends.portfolio', lang)}</p>
 <p className="text-2xl font-black italic">{fromMember.shares} {t('dividends.sh', lang)}</p>
 </div>
 <div className="p-6 rounded-xl border-2 border-dashed border-gray-100 dark:border-white/10 flex items-center justify-center gap-3 text-gray-400">
 <AlertCircle size={20} />
 <p className="text-[10px] font-black uppercase tracking-[0.2em] leading-tight">{t('dividends.transferBanner', lang)}</p>
 </div>
 </div>
 )}

 <div className="space-y-6 mb-6">
 <div className="flex items-center justify-between border-b border-gray-50 dark:border-white/5 pb-4">
 <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest">{t('dividends.reallocationPlan', lang)}</h4>
 {currentUser?.permissions[AppScreen.DIVIDENDS] === AccessLevel.WRITE && (
 <div className="flex items-center gap-3">
 <button
 onClick={() => {
 const totalContributed = fromMember?.totalContributed || 0;
 const totalShares = fromMember?.shares || 0;
 setTransfers([{ toMemberId: '', amount: totalContributed, shares: totalShares }]);
 }}
 className="text-[10px] font-black text-brand uppercase tracking-widest hover:underline flex items-center gap-2"
 >
 <TrendingUp size={12} />
 {t('dividends.distFullEquity', lang) || 'Distribute Full Equity'}
 </button>
 <button
 onClick={() => setTransfers([...transfers, { toMemberId: '', amount: 0, shares: 0 }])}
 className="flex items-center gap-2 text-brand font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all"
 >
 <PlusCircle size={16} />
 {t('dividends.addTarget', lang)}
 </button>
 </div>
 )}
 </div>

 <div className="space-y-4">
 {transfers.map((tr, index) => (
 <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end animate-in fade-in slide-in-from-right-4 duration-300">
 <div className="col-span-2 space-y-2">
 <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-2">{t('dividends.recipientMember', lang)}</label>
 <select
 value={tr.toMemberId}
 onChange={(e) => updateTransfer(index, 'toMemberId', e.target.value)}
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-5 rounded-xl font-black text-xs dark:text-white"
 >
 <option value="">{t('dividends.selectTarget', lang)}</option>
 {activeMembers.filter(m => m.id !== fromMemberId).map(m => (
 <option key={m.id} value={m.id}>{m.name}</option>
 ))}
 </select>
 </div>
 <div className="space-y-2">
 <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-2">{t('dividends.transferCapital', lang)}</label>
 <input
 type="number"
 value={tr.amount || ''}
 onChange={(e) => updateTransfer(index, 'amount', Number(e.target.value))}
 placeholder="Amount"
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-5 rounded-xl font-black text-xs dark:text-white"
 />
 </div>
 <div className="flex gap-2 items-center">
 <div className="flex-1 space-y-2">
 <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-2">{t('dividends.transferShares', lang)}</label>
 <input
 type="number"
 value={tr.shares || ''}
 onChange={(e) => updateTransfer(index, 'shares', Number(e.target.value))}
 placeholder="Shares"
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-5 rounded-xl font-black text-xs dark:text-white"
 />
 </div>
 {transfers.length > 1 && (
 <button
 onClick={() => removeTransferRow(index)}
 className="p-3 bg-red-50 text-red-400 rounded-xl hover:bg-red-400 hover:text-white transition-all mt-6"
 >
 <MinusCircle size={18} />
 </button>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>

 <div className="space-y-4 mb-12">
 <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('dividends.transferMemo', lang)}</label>
 <input
 type="text"
 value={transferDesc}
 onChange={(e) => setTransferDesc(e.target.value)}
 className="w-full bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-6 rounded-xl font-bold text-sm focus:border-brand dark:text-white transition-all outline-none shadow-inner"
 />
 </div>

 {currentUser?.permissions[AppScreen.DIVIDENDS] === AccessLevel.WRITE ? (
 <button
 onClick={handleEquityTransfer}
 className="w-full bg-dark dark:bg-brand text-white dark:text-dark py-6 rounded-xl font-black uppercase tracking-[0.2em] text-sm shadow-2xl hover:scale-[1.01] active:scale-95 transition-all flex items-center justify-center gap-3"
 >
 <ArrowRightLeft size={18} strokeWidth={3} />
 {t('dividends.executeMigration', lang)}
 </button>
 ) : (
 <div className="p-6 rounded-xl bg-amber-500/5 border border-amber-500/20 text-center">
 <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest">{t('dividends.migrationRestricted', lang)}</p>
 <p className="text-xs font-bold text-gray-400 mt-1">{t('dividends.treasuryAuth', lang)}</p>
 </div>
 )}
 </div>
 </div>
 )}
 </div>

 {/* Global Dividend History */}
 <div className="bg-white dark:bg-[#1A221D] rounded-xl card-shadow border border-gray-100 dark:border-white/5 overflow-hidden">
 <div className="px-6 py-6 border-b border-gray-50 dark:border-white/5 flex items-center justify-between">
 <div>
 <h4 className="text-xl font-black dark:text-white uppercase italic tracking-tight">{t('dividends.globalLedger', lang) || 'Dividend Ledger'}</h4>
 <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">Audit trail of all distributed rewards</p>
 </div>
 <button
 onClick={fetchHistory}
 className={`p-3 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-400 hover:text-brand transition-all ${historyLoading ? 'animate-spin' : ''}`}
 >
 <HistoryIcon size={18} />
 </button>
 </div>

 <Table
 data={history}
 columns={dividendHistoryColumns}
 loading={historyLoading}
 rowKey={(tx) => tx._id}
 emptyMessage={<div className="text-gray-400 font-black uppercase text-[10px] tracking-widest py-8 text-center">No historical distributions found</div>}
 />

 <div className="px-6 py-6 border-t border-gray-50 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-3">
 <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
 {historyMeta && (
 <>Showing {historyMeta.from} to {historyMeta.to} of {historyMeta.total} records</>
 )}
 </div>
 <Pagination
 currentPage={currentPage}
 totalPages={totalPages}
 onPageChange={setCurrentPage}
 rowsPerPage={rowsPerPage}
 onRowsPerPageChange={(newLimit) => {
 setRowsPerPage(newLimit);
 setCurrentPage(1);
 }}
 />
 </div>
 </div>
 </div>
 );
};

export default DividendManagement;
