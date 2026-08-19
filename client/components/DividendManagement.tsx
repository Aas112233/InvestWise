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
  Eye,
  Loader2,
  Printer,
  Search,
  Filter,
  X,
  RotateCcw,
  SlidersHorizontal,
  ArrowUpDown,
  Calendar,
  Building2
} from 'lucide-react';
import { useGlobalState } from '../context/GlobalStateContext';
import { usePermission } from '../hooks/usePermission';
import { Member, Project, Fund, AccessLevel, AppScreen } from '../types';
import Toast, { ToastType } from './Toast';
import { formatCurrency, formatDate } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import { financeService } from '../services/api';
import Pagination from './Pagination';
import SearchBar from './SearchBar';
import ExportMenu from './ExportMenu';
import { Table, TableColumn } from './ui/Table';
import { FormInput, FormSelect, FormTextarea } from './ui/FormElements';
import { Button } from './ui/Button';
import { generateDividendVoucher, generateDividendBatchStatement, VoucherDocument } from '../utils/voucherGenerator';
import PrintableReceiptModal from './ui/PrintableReceiptModal';

interface DividendManagementProps {
  lang: Language;
}

const DividendManagement: React.FC<DividendManagementProps> = ({ lang }) => {
  const { members, projects, funds, refreshData, distributeDividends, transferEquity, currentUser, currencyCode } = useGlobalState();
  const canWrite = usePermission(AppScreen.DIVIDENDS, AccessLevel.WRITE);
  const [selectedVoucher, setSelectedVoucher] = useState<VoucherDocument | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'distribution' | 'transfer'>('distribution');
  const [distributionType, setDistributionType] = useState<'Project' | 'Global'>('Project');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedFundId, setSelectedFundId] = useState<string>('');
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [description, setDescription] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isDistributing, setIsDistributing] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

  // History Search & Filter State
  const [history, setHistory] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [historyMeta, setHistoryMeta] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedHistoryMember, setSelectedHistoryMember] = useState('');
  const [selectedHistorySource, setSelectedHistorySource] = useState<'ALL' | 'PROJECT' | 'GLOBAL'>('ALL');
  const [selectedHistoryProject, setSelectedHistoryProject] = useState('');
  const [selectedHistoryFund, setSelectedHistoryFund] = useState('');
  const [historyMonth, setHistoryMonth] = useState('');
  const [historyYear, setHistoryYear] = useState('');
  const [historySortBy, setHistorySortBy] = useState('date');
  const [historySortOrder, setHistorySortOrder] = useState<'asc' | 'desc'>('desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const params: any = {
        page: currentPage,
        limit: rowsPerPage,
        type: 'Dividend',
        sortBy: historySortBy === 'payout' ? 'amount' : historySortBy,
        sortOrder: historySortOrder
      };
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (selectedHistoryMember) {
        params.memberId = selectedHistoryMember;
      }
      if (selectedHistorySource === 'PROJECT') {
        if (selectedHistoryProject) {
          params.projectId = selectedHistoryProject;
        }
      } else if (selectedHistorySource === 'GLOBAL') {
        if (selectedHistoryFund) {
          params.fundId = selectedHistoryFund;
        }
      }
      if (historyMonth && historyYear) {
        params.month = historyMonth;
        params.year = historyYear;
      }

      const response = await financeService.getTransactions(params);
      let data = response.data || [];

      // Local source filtering fallback if backend returned mixed
      if (selectedHistorySource === 'PROJECT' && !selectedHistoryProject) {
        data = data.filter((tx: any) => Boolean(tx.projectId));
      } else if (selectedHistorySource === 'GLOBAL' && !selectedHistoryFund) {
        data = data.filter((tx: any) => !tx.projectId);
      }

      setHistory(data);
      setTotalPages(response.pages || 1);
      setHistoryMeta(response.meta);
    } catch (err) {
      console.error('Failed to fetch dividend history', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [
    currentPage,
    rowsPerPage,
    searchQuery,
    selectedHistoryMember,
    selectedHistorySource,
    selectedHistoryProject,
    selectedHistoryFund,
    historyMonth,
    historyYear,
    historySortBy,
    historySortOrder
  ]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedHistoryMember('');
    setSelectedHistorySource('ALL');
    setSelectedHistoryProject('');
    setSelectedHistoryFund('');
    setHistoryMonth('');
    setHistoryYear('');
    setHistorySortBy('date');
    setHistorySortOrder('desc');
    setCurrentPage(1);
  };

  const handleSort = (field: string) => {
    const targetField = field === 'payout' ? 'amount' : field;
    if (historySortBy === targetField) {
      setHistorySortOrder(historySortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setHistorySortBy(targetField);
      setHistorySortOrder(targetField === 'amount' ? 'desc' : 'asc');
    }
    setCurrentPage(1);
  };

  const activeFilterCount = [
    Boolean(searchQuery.trim()),
    Boolean(selectedHistoryMember),
    selectedHistorySource !== 'ALL',
    Boolean(selectedHistoryProject),
    Boolean(selectedHistoryFund),
    Boolean(historyMonth && historyYear),
    historySortBy !== 'date' || historySortOrder !== 'desc'
  ].filter(Boolean).length;

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
 if (isDistributing) return;
 if (distributionType === 'Project' && !selectedProjectId) return showToast(t('dividends.selectProjectError', lang), 'error');
 if (distributionType === 'Global' && !selectedFundId) return showToast(t('dividends.selectFundError', lang), 'error');
 if (payoutAmount <= 0) return showToast(t('dividends.invalidAmount', lang), 'error');

 // Validate sufficient balance
 if (distributionType === 'Project' && selectedProject) {
 if (payoutAmount > selectedProject.currentFundBalance) {
 return showToast(t('dividends.payoutExceedsBalance', lang), 'error');
 }
 }

 setIsDistributing(true);
    try {
      const payload: any = {
        type: distributionType,
        amount: Number(payoutAmount),
        description: description || undefined,
      };

      if (distributionType === 'Project') {
        payload.projectId = selectedProjectId;
      } else {
        payload.sourceFundId = selectedFundId;
      }

      await distributeDividends(payload);

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
 } finally {
 setIsDistributing(false);
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
 if (isTransferring) return;
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

 setIsTransferring(true);
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
} finally {
 setIsTransferring(false);
 }
 };

 const exportColumns = [
   { key: 'date', header: t('transactions.date', lang) || 'Date', getValue: (tx: any) => formatDate(tx.date) },
   { key: 'referenceNumber', header: 'Reference', getValue: (tx: any) => tx.referenceNumber || 'N/A' },
   { key: 'recipient', header: t('dividends.recipient', lang) || 'Recipient', getValue: (tx: any) => typeof tx.memberId === 'object' && tx.memberId ? tx.memberId.name : (members.find(m => m.id === tx.memberId)?.name || 'N/A') },
   { key: 'memberId', header: 'Member ID', getValue: (tx: any) => typeof tx.memberId === 'object' && tx.memberId ? tx.memberId.memberId : (members.find(m => m.id === tx.memberId)?.memberId || 'N/A') },
   { key: 'description', header: t('transactions.description', lang) || 'Description', getValue: (tx: any) => tx.description || 'N/A' },
   { key: 'amount', header: t('dividends.payout', lang) || 'Payout Amount', getValue: (tx: any) => tx.amount },
   { key: 'source', header: 'Source', getValue: (tx: any) => tx.projectId ? 'Project Settlement' : 'Fund Distribution' },
   { key: 'status', header: t('transactions.status', lang) || 'Status', getValue: (tx: any) => tx.status || 'Completed' }
 ];

 const dividendHistoryColumns: TableColumn<any>[] = [
   {
     key: 'date',
     header: t('transactions.date', lang) || 'Date',
     sortable: true,
     render: (tx) => (
       <div>
         <span className="text-xs font-bold text-slate-700 dark:text-gray-300">{formatDate(tx.date)}</span>
         {tx.referenceNumber && (
           <p className="text-[9px] font-mono text-gray-400 uppercase mt-0.5">#{tx.referenceNumber}</p>
         )}
       </div>
     )
   },
   {
     key: 'description',
     header: t('transactions.description', lang) || 'Description',
     render: (tx) => {
       const proj = tx.projectId ? projects.find(p => p.id === tx.projectId) : null;
       const fund = tx.fundId ? funds.find(f => f.id === tx.fundId) : null;
       return (
         <div>
           <p className="text-sm font-black dark:text-white leading-tight">{tx.description || 'Dividend Distribution'}</p>
           <div className="flex items-center gap-2 mt-1 flex-wrap">
             {proj ? (
               <span className="inline-flex items-center gap-1 text-[9px] font-black text-brand uppercase tracking-wider bg-brand/10 dark:bg-brand/15 text-brand px-2 py-0.5 rounded-md">
                 <Briefcase size={10} />
                 {proj.name}
               </span>
             ) : fund ? (
               <span className="inline-flex items-center gap-1 text-[9px] font-black text-blue-500 uppercase tracking-wider bg-blue-500/10 px-2 py-0.5 rounded-md">
                 <Wallet size={10} />
                 {fund.name}
               </span>
             ) : (
               <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider">
                 Global Pool
               </span>
             )}
           </div>
         </div>
       );
     }
   },
   {
     key: 'recipient',
     header: t('dividends.recipient', lang) || 'Recipient',
     render: (tx) => {
       const mem = tx.memberId;
       const memberName = typeof mem === 'object' && mem ? mem.name : (members.find(m => m.id === mem)?.name || 'N/A');
       const memberCode = typeof mem === 'object' && mem ? mem.memberId : (members.find(m => m.id === mem)?.memberId || '');
       return (
         <div className="flex flex-col">
            {memberCode && (
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tight">ID: {memberCode}</span>
            )}
          </div>
        );
      }
    },
    {
      key: 'payout',
      header: t('dividends.payout', lang) || 'Payout',
      align: 'right',
      sortable: true,
      render: (tx) => <span className="font-black text-brand text-sm">{formatCurrency(tx.amount)}</span>
    },
    {
      key: 'status',
     header: t('transactions.status', lang) || 'Status',
     align: 'right',
     render: () => (
       <span className="inline-block px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase tracking-widest border border-emerald-500/20">
         Distributed
       </span>
     )
   },
   {
     key: 'actions',
     header: 'Actions',
     align: 'right',
     render: (tx) => (
       <button
         onClick={(e) => {
           e.preventDefault();
           e.stopPropagation();
           const voucher = generateDividendVoucher(tx, members, projects, funds, currencyCode);
           setSelectedVoucher(voucher);
           setIsReceiptModalOpen(true);
         }}
         title="Print Dividend Slip"
         className="p-2.5 bg-white dark:bg-[#111814] rounded-xl border border-gray-100 dark:border-white/5 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-500/30 transition-all shadow-sm cursor-pointer"
        >
          <Printer size={15} />
        </button>
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
                    {distributionType === 'Project' ? (
                      <FormSelect
                        label={t('dividends.selectProject', lang)}
                        value={selectedProjectId}
                        onChange={(e) => setSelectedProjectId(e.target.value)}
                        placeholder={t('dividends.selectVenture', lang)}
                        options={projects.map(p => ({
                          value: p.id,
                          label: `${p.title} (Balance: ${p.currentFundBalance})`
                        }))}
                      />
                    ) : (
                      <FormSelect
                        label={t('dividends.selectSourceFund', lang)}
                        value={selectedFundId}
                        onChange={(e) => setSelectedFundId(e.target.value)}
                        placeholder={t('dividends.selectPrimaryFund', lang)}
                        options={funds.map(f => ({
                          value: f.id,
                          label: `${f.name} (${(parseFloat(String(f.balance || 0)) || 0).toLocaleString()} ${f.currency || currencyCode})`
                        }))}
                      />
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
                  {canWrite ? (
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
                        disabled={payoutAmount <= 0 || isDistributing}
                        className="flex-[2] bg-dark dark:bg-brand text-white dark:text-dark py-6 rounded-xl font-black uppercase tracking-[0.2em] text-sm shadow-2xl shadow-brand/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {isDistributing ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} strokeWidth={3} />}
                        {isDistributing ? 'Authorizing...' : t('dividends.authorize', lang)}
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
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-[11px] font-black text-brand uppercase tracking-widest flex items-center gap-2">
                        <HistoryIcon size={12} />
                        {t('dividends.payoutPreview', lang) || 'Payout Distribution Preview'}
                      </h4>
                      <button
                        onClick={() => {
                          const batchVoucher = generateDividendBatchStatement(
                            {
                              type: distributionType,
                              amount: payoutAmount,
                              projectId: distributionType === 'Project' ? selectedProjectId : undefined,
                              sourceFundId: distributionType === 'Global' ? selectedFundId : undefined,
                              description: description || undefined,
                            },
                            members,
                            projects,
                            funds,
                            currencyCode
                          );
                          setSelectedVoucher(batchVoucher);
                          setIsReceiptModalOpen(true);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 text-[10px] font-black uppercase tracking-wider hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-all cursor-pointer shadow-xs"
                      >
                        <Printer size={13} />
                        Print Full Schedule (All Members)
                      </button>
                    </div>
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
                  {canWrite && (
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

        {canWrite ? (
          <button
            onClick={handleEquityTransfer}
            disabled={isTransferring}
            className="w-full bg-dark dark:bg-brand text-white dark:text-dark py-6 rounded-xl font-black uppercase tracking-[0.2em] text-sm shadow-2xl hover:scale-[1.01] active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isTransferring ? <Loader2 size={18} className="animate-spin" /> : <ArrowRightLeft size={18} strokeWidth={3} />}
            {isTransferring ? 'Processing Migration...' : t('dividends.executeMigration', lang)}
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
    {/* Header */}
    <div className="px-6 py-6 border-b border-gray-50 dark:border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h4 className="text-xl font-black dark:text-white uppercase italic tracking-tight">{t('dividends.globalLedger', lang) || 'Dividend Ledger'}</h4>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">Audit trail of all distributed rewards</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {history && history.length > 0 && (
          <>
            <button
              onClick={() => {
                const totalBatchAmount = history.reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);
                const sampleTx = history[0];
                const batchVoucher = generateDividendBatchStatement(
                  {
                    type: sampleTx?.projectId ? 'Project' : 'Global',
                    amount: totalBatchAmount,
                    projectId: sampleTx?.projectId,
                    sourceFundId: sampleTx?.fundId,
                    description: sampleTx?.description || 'Dividend Distribution Roll',
                    date: sampleTx?.date,
                    referenceNumber: sampleTx?.referenceNumber,
                  },
                  members,
                  projects,
                  funds,
                  currencyCode
                );
                setSelectedVoucher(batchVoucher);
                setIsReceiptModalOpen(true);
              }}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-[11px] font-black uppercase tracking-wider transition-all shadow-xs cursor-pointer"
              title="Print Consolidated Dividend Roll"
            >
              <Printer size={14} />
              <span>Print Statement</span>
            </button>
            <ExportMenu
              data={history}
              columns={exportColumns}
              fileName={`dividend_ledger_${new Date().toISOString().split('T')[0]}`}
              title="Dividend Distribution Ledger"
              lang={lang}
            />
          </>
        )}
        <button
          onClick={fetchHistory}
          className={`p-2.5 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-400 hover:text-brand transition-all ${historyLoading ? 'animate-spin' : ''}`}
          title="Refresh Ledger"
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </div>

    {/* Search & Filter Controls Toolbar */}
    <div className="p-6 bg-gray-50/50 dark:bg-black/10 border-b border-gray-100 dark:border-white/5 space-y-4">
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Search Box */}
        <div className="flex-1 min-w-[240px]">
          <div className="relative group">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by member, ID, reference, or note..."
              className="w-full bg-white dark:bg-[#121814] border border-gray-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-9 text-xs font-bold text-slate-800 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand transition-all shadow-xs"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Quick Filter Selectors */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Source Type Filter */}
          <div className="relative">
            <select
              value={selectedHistorySource}
              onChange={(e) => {
                setSelectedHistorySource(e.target.value as any);
                setSelectedHistoryProject('');
                setSelectedHistoryFund('');
                setCurrentPage(1);
              }}
              className="appearance-none bg-white dark:bg-[#121814] pl-3 pr-8 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-brand outline-none transition-all shadow-xs cursor-pointer"
            >
              <option value="ALL">All Sources</option>
              <option value="PROJECT">Project Distributions</option>
              <option value="GLOBAL">Fund Distributions</option>
            </select>
            <Building2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Recipient Member Filter */}
          <div className="relative">
            <select
              value={selectedHistoryMember}
              onChange={(e) => {
                setSelectedHistoryMember(e.target.value);
                setCurrentPage(1);
              }}
              className="appearance-none bg-white dark:bg-[#121814] pl-3 pr-8 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-brand outline-none transition-all shadow-xs cursor-pointer max-w-[180px] truncate"
            >
              <option value="">All Partners</option>
              {activeMembers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <Users size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Advanced Filters Toggle */}
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all shadow-xs cursor-pointer ${
              showAdvancedFilters || activeFilterCount > 0
                ? 'bg-brand/10 border-brand/40 text-brand'
                : 'bg-white dark:bg-[#121814] border-gray-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-brand/40'
            }`}
          >
            <SlidersHorizontal size={14} />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-brand text-dark text-[10px] font-black flex items-center justify-center ml-0.5">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Reset Filters Button */}
          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-all cursor-pointer shadow-xs"
              title="Reset All Filters"
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Expandable Filter Drawer */}
      {showAdvancedFilters && (
        <div className="pt-4 border-t border-gray-200/60 dark:border-white/5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Specific Project Filter */}
          {selectedHistorySource !== 'GLOBAL' && (
            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Specific Project</label>
              <select
                value={selectedHistoryProject}
                onChange={(e) => {
                  setSelectedHistoryProject(e.target.value);
                  if (e.target.value) setSelectedHistorySource('PROJECT');
                  setCurrentPage(1);
                }}
                className="w-full bg-white dark:bg-[#121814] p-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-brand outline-none cursor-pointer"
              >
                <option value="">All Projects</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Specific Fund Filter */}
          {selectedHistorySource !== 'PROJECT' && (
            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Source Fund</label>
              <select
                value={selectedHistoryFund}
                onChange={(e) => {
                  setSelectedHistoryFund(e.target.value);
                  if (e.target.value) setSelectedHistorySource('GLOBAL');
                  setCurrentPage(1);
                }}
                className="w-full bg-white dark:bg-[#121814] p-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-brand outline-none cursor-pointer"
              >
                <option value="">All Funds</option>
                {funds.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Month & Year Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Period (Month / Year)</label>
            <div className="flex gap-2">
              <select
                value={historyMonth}
                onChange={(e) => {
                  setHistoryMonth(e.target.value);
                  if (!historyYear && e.target.value) setHistoryYear(String(new Date().getFullYear()));
                  setCurrentPage(1);
                }}
                className="w-1/2 bg-white dark:bg-[#121814] p-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-brand outline-none cursor-pointer"
              >
                <option value="">Month</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('default', { month: 'short' })}</option>
                ))}
              </select>
              <select
                value={historyYear}
                onChange={(e) => {
                  setHistoryYear(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-1/2 bg-white dark:bg-[#121814] p-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-brand outline-none cursor-pointer"
              >
                <option value="">Year</option>
                {[2024, 2025, 2026, 2027, 2028].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Sort Order Selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Sort By</label>
            <select
              value={`${historySortBy}_${historySortOrder}`}
              onChange={(e) => {
                const [sb, so] = e.target.value.split('_');
                setHistorySortBy(sb);
                setHistorySortOrder(so as any);
                setCurrentPage(1);
              }}
              className="w-full bg-white dark:bg-[#121814] p-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-slate-700 dark:text-slate-200 focus:border-brand outline-none cursor-pointer"
            >
              <option value="date_desc">Date (Newest First)</option>
              <option value="date_asc">Date (Oldest First)</option>
              <option value="amount_desc">Amount (Highest First)</option>
              <option value="amount_asc">Amount (Lowest First)</option>
            </select>
          </div>
        </div>
      )}

      {/* Live Filter Indicator Bar */}
      {activeFilterCount > 0 && (
        <div className="flex items-center justify-between text-[11px] font-bold text-gray-500 dark:text-gray-400 pt-1 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black uppercase tracking-wider text-brand">Active Filters:</span>
            {searchQuery && (
              <span className="px-2 py-0.5 rounded-md bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-slate-200">
                Search: "{searchQuery}"
              </span>
            )}
            {selectedHistorySource !== 'ALL' && (
              <span className="px-2 py-0.5 rounded-md bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-slate-200">
                Source: {selectedHistorySource === 'PROJECT' ? 'Projects' : 'Global Funds'}
              </span>
            )}
            {selectedHistoryMember && (
              <span className="px-2 py-0.5 rounded-md bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-slate-200">
                Partner: {members.find(m => m.id === selectedHistoryMember)?.name || selectedHistoryMember}
              </span>
            )}
            {historyMonth && historyYear && (
              <span className="px-2 py-0.5 rounded-md bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-slate-200">
                Period: {new Date(2000, Number(historyMonth) - 1, 1).toLocaleString('default', { month: 'short' })} {historyYear}
              </span>
            )}
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
            {historyMeta?.total ?? history.length} matching {(historyMeta?.total ?? history.length) === 1 ? 'record' : 'records'}
          </span>
        </div>
      )}
    </div>

    <Table
      data={history}
      columns={dividendHistoryColumns}
      loading={historyLoading}
      sortBy={historySortBy}
      sortOrder={historySortOrder}
      onSort={handleSort}
      rowKey={(tx) => tx._id || tx.id}
      emptyMessage={
        <div className="text-gray-400 font-black uppercase text-[10px] tracking-widest py-12 text-center flex flex-col items-center gap-3">
          <HistoryIcon size={32} className="opacity-30" />
          <span>{activeFilterCount > 0 ? 'No dividend transactions match your search/filter criteria' : 'No historical distributions found'}</span>
          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/5 text-brand text-xs font-bold hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      }
    />

    <div className="px-6 py-6 border-t border-gray-50 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-3">
      <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
        {historyMeta ? (
          <>Showing {historyMeta.from || 1} to {historyMeta.to || history.length} of {historyMeta.total} records</>
        ) : (
          <>Showing {history.length} records</>
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

  <PrintableReceiptModal
    isOpen={isReceiptModalOpen}
    onClose={() => setIsReceiptModalOpen(false)}
    voucher={selectedVoucher}
  />
</div>
  );
};

export default DividendManagement;
