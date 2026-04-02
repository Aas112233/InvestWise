
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Filter, X, Calendar, User, CheckSquare, Square, ChevronLeft, ChevronRight, Edit2, Trash2, CheckCircle, RefreshCw, Loader2, CreditCard, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import Pagination from './Pagination';
import { Deposit, AccessLevel, AppScreen } from '../types';
import Toast, { ToastType } from './Toast';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import { formatCurrency, formatDate } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import ActionDialog from './ActionDialog';
import { ModalForm, FormInput, FormSelect } from './ui/FormElements';
import ExportMenu from './ExportMenu';
import { Download, Upload } from 'lucide-react';

const SHARE_WORTH = 1000;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const monthKeys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface RequestDepositProps {
  lang: Language;
}

const RequestDeposit: React.FC<RequestDepositProps> = ({ lang }) => {
  const { members: globalMembers, deposits: globalDeposits, funds, refreshTransactions, currentUser } = useGlobalState();
  const [requests, setRequests] = useState<Deposit[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [paginatedData, setPaginatedData] = useState<{
    total: number;
    pages: number;
    meta?: any;
  }>({ total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPaginatedRequests = async (page: number, limit: number, search: string, sort: string, order: 'asc' | 'desc') => {
    setLoading(true);
    try {
      const response = await financeService.getTransactions({
        page,
        limit,
        search,
        sortBy: sort,
        sortOrder: order,
        type: 'Deposit',
        status: 'Pending' // Explicitly fetch only pending/processing
      });

      const mapped = response.data.map((t: any) => ({
        id: t._id || t.id,
        memberId: t.memberId?.memberId || 'N/A',
        memberMongoId: t.memberId?._id || t.memberId,
        memberName: t.memberId?.name || 'Unknown',
        memberDisplayId: t.memberId?.memberId || '',
        amount: t.amount,
        date: new Date(t.date).toLocaleDateString(),
        status: t.status,
        shareNumber: Math.floor(t.amount / SHARE_WORTH),
        depositMonth: (t.description?.match(/\[(.*?)\]/) || [])[1] || t.description || 'N/A',
        cashierName: t.handlingOfficer || 'System',
        depositMethod: t.depositMethod || 'Bank',
        createdAt: t.createdAt ? new Date(t.createdAt).toLocaleDateString() : new Date(t.date).toLocaleDateString(),
        updatedAt: t.updatedAt && t.updatedAt !== t.createdAt ? new Date(t.updatedAt).toLocaleDateString() : undefined
      }));

      setRequests(mapped);
      setPaginatedData({
        total: response.meta.total,
        pages: response.meta.pages,
        meta: response.meta
      });
    } catch (err) {
      console.error('Failed to fetch requests:', err);
      showNotification(t('deposits.recordError', lang), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshTransactions();
    fetchPaginatedRequests(currentPage, rowsPerPage, searchQuery, sortBy, sortOrder);
    setTimeout(() => setRefreshing(false), 500);
  };

  useEffect(() => {
    fetchPaginatedRequests(currentPage, rowsPerPage, searchQuery, sortBy, sortOrder);
  }, [currentPage, rowsPerPage, searchQuery, sortBy, sortOrder, globalDeposits]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<Deposit | null>(null);
  const [autoCalculate, setAutoCalculate] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const activeMembers = globalMembers.filter(m => m.status === 'active');

  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    requestId: string;
    memberName: string;
  }>({
    isOpen: false,
    requestId: '',
    memberName: ''
  });

  // Sync with global state
  // Sync disabled as we use server-side pagination now
  // useEffect(() => { ... }, [globalDeposits]);

  const getCurrentMonthYear = () => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return `${t(`common.months.${monthKeys[date.getMonth()]}`, lang)} ${date.getFullYear()}`;
  };

  const convertToInputDate = (dateStr: string) => {
    try {
      if (!dateStr) return new Date().toISOString().split('T')[0];
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
      return d.toISOString().split('T')[0];
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  };

  const getDateFromMonthStr = (monthStr: string) => {
    try {
      if (!monthStr) return '';
      const parts = monthStr.split(' ');
      const year = parseInt(parts[parts.length - 1]);
      const monthPart = parts.slice(0, parts.length - 1).join(' ');
      const monthIdx = monthKeys.findIndex(k => t(`common.months.${k}`, lang) === monthPart);

      if (monthIdx !== -1 && !isNaN(year)) {
        return `${year}-${(monthIdx + 1).toString().padStart(2, '0')}-01`;
      }
      return '';
    } catch {
      return '';
    }
  };

  const [formData, setFormData] = useState({
    memberId: '',
    memberDisplayId: '',
    memberName: '',
    shareNumber: '0',
    amount: '0',
    depositMonth: getCurrentMonthYear(),
    cashierName: 'System',
    fundId: '',
    depositMethod: 'Bank',
    txnDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (isModalOpen) {
      const currentVal = formData.depositMonth;
      const isCurrent = currentVal === getCurrentMonthYear();

      if (!isCurrent) {
        const lockedDate = getDateFromMonthStr(currentVal);
        if (lockedDate && formData.txnDate !== lockedDate) {
          setFormData(prev => ({ ...prev, txnDate: lockedDate }));
        }
      }
    }
  }, [formData.depositMonth, isModalOpen, lang]);

  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(event.target as Node)) {
        setIsMonthPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const handleOpenModal = (request?: Deposit) => {
    if (request) {
      setEditingRequest(request);
      // Try to match the fund if possible, or leave empty if unknown/hidden
      // For now, requests might default to Primary if not specified
      setFormData({
        memberId: request.memberId,
        memberDisplayId: request.memberDisplayId || '',
        memberName: request.memberName,
        shareNumber: request.shareNumber.toString(),
        amount: request.amount.toString(),
        depositMonth: request.depositMonth,
        cashierName: request.cashierName,
        fundId: '', // We might not have this easily, let user select or default
        depositMethod: request.depositMethod || 'Bank',
        txnDate: convertToInputDate(request.date)
      });
      setAutoCalculate(false);
    } else {
      setEditingRequest(null);
      const defaultPartner = activeMembers[0];
      const defaultFund = funds.find(f => (f.type === 'DEPOSIT' || f.type === 'Primary') && f.status !== 'ARCHIVED');

      setFormData({
        memberId: defaultPartner?.id || '',
        memberDisplayId: defaultPartner?.memberId || '',
        memberName: defaultPartner?.name || '',
        shareNumber: defaultPartner?.shares.toString() || '0',
        amount: (defaultPartner?.shares * SHARE_WORTH).toString() || '0',
        depositMonth: getCurrentMonthYear(),
        cashierName: defaultFund?.handlingOfficer || 'System',
        fundId: defaultFund ? defaultFund.id : '',
        depositMethod: 'Bank',
        txnDate: new Date().toISOString().split('T')[0]
      });
      setAutoCalculate(true);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingRequest(null);
  };

  const handleMemberChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    const partner = activeMembers.find(p => p.id === selectedId);
    if (partner) {
      const newShares = partner.shares.toString();
      const newAmount = autoCalculate ? (partner.shares * SHARE_WORTH).toString() : formData.amount;
      setFormData({
        ...formData,
        memberId: selectedId,
        memberDisplayId: partner.memberId,
        memberName: partner.name,
        shareNumber: newShares,
        amount: newAmount
      });
    }
  };

  const handleToggleAutoCalc = () => {
    const nextVal = !autoCalculate;
    setAutoCalculate(nextVal);
    if (nextVal) {
      const sharesNum = parseInt(formData.shareNumber) || 0;
      setFormData({ ...formData, amount: (sharesNum * SHARE_WORTH).toString() });
    }
  };

  const selectMonth = (monthName: string, index: number) => {
    const translatedMonth = t(`common.months.${monthKeys[index]}`, lang);
    const newMonthStr = `${translatedMonth} ${pickerYear}`;

    // Auto-calculate Transaction Date Lock
    let newTxnDate = new Date().toISOString().split('T')[0]; // Default to today

    // If not current month, lock to 1st of that month
    const now = new Date();
    const isCurrentMonth = index === now.getMonth() && pickerYear === now.getFullYear();

    if (!isCurrentMonth) {
      // Create date for 1st of selected month
      const d = new Date(pickerYear, index, 1);
      // Adjust for timezone offset to ensure YYYY-MM-DD matches local intent or UTC+6
      const year = d.getFullYear();
      const month = String(index + 1).padStart(2, '0');
      const day = '01';
      newTxnDate = `${year}-${month}-${day}`;
    }

    setFormData({
      ...formData,
      depositMonth: newMonthStr,
      txnDate: newTxnDate
    });
    setIsMonthPickerOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editingRequest) {
        showNotification("Modification of pending requests is temporarily disabled. Please delete and recreate.", "warning");
        handleCloseModal();
        return;
      }

      if (!formData.fundId) {
        throw new Error("Please select a Target Fund.");
      }

      const payload = {
        memberId: formData.memberId,
        amount: parseInt(formData.amount),
        fundId: formData.fundId,
        description: formData.depositMonth,
        date: new Date(formData.txnDate).toISOString(),
        shareNumber: parseInt(formData.shareNumber),
        status: 'Pending',
        cashierName: formData.cashierName,
        depositMethod: formData.depositMethod
      };

      const newDeposit = await financeService.addDeposit(payload);
      const mappedDeposit: Deposit = {
        id: newDeposit._id || newDeposit.id,
        memberId: formData.memberId,
        memberDisplayId: formData.memberDisplayId,
        memberName: formData.memberName,
        shareNumber: parseInt(formData.shareNumber),
        amount: parseInt(formData.amount),
        depositMonth: formData.depositMonth,
        cashierName: formData.cashierName,
        status: 'Pending',
        date: newDeposit.date?.split('T')[0] || new Date().toISOString().split('T')[0],
        depositMethod: formData.depositMethod as any
      };

      setRequests(prev => [mappedDeposit, ...prev]);
      showNotification(`Deposit request for ${formData.memberName} submitted successfully.`);
      handleCloseModal();
      fetchPaginatedRequests(currentPage, rowsPerPage, searchQuery, sortBy, sortOrder);
      await refreshTransactions();
    } catch (error: any) {
      console.error(error);
      showNotification(error.message || "Failed to submit request", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (processingId) return; // Prevent double clicks

    console.log("Approve initiated for:", id);
    const request = requests.find(r => r.id === id);
    if (!request) {
      console.error("Request not found:", id);
      return;
    }

    // Removed window.confirm to avoid blocking/cancellation issues during debugging
    // Ideally use a custom modal, but simple click to approve is often acceptable for admin dashboards

    try {
      setProcessingId(id);
      await financeService.approveDeposit(id);
      showNotification(`Request approved for ${request.memberName}`);
      fetchPaginatedRequests(currentPage, rowsPerPage, searchQuery, sortBy, sortOrder);
      await refreshTransactions();
    } catch (error: any) {
      console.error("Approval API Error:", error);
      showNotification(error.message || "Approval failed", "error");
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeleteClick = (id: string, memberName: string) => {
    setDeleteDialog({
      isOpen: true,
      requestId: id,
      memberName
    });
  };

  const handleDelete = async () => {
    const { requestId } = deleteDialog;
    setIsSubmitting(true);
    try {
      await financeService.deleteTransaction(requestId);
      setRequests(requests.filter(r => r.id !== requestId));
      showNotification(`Request has been rejected/deleted.`);
      setDeleteDialog({ isOpen: false, requestId: '', memberName: '' });
    } catch (error: any) {
      showNotification(error.message || "Delete failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalRequested = requests.reduce((acc, r) => acc + r.amount, 0);


  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isVisible: false })} />

      <ActionDialog
        isOpen={deleteDialog.isOpen}
        type="delete"
        title="Reject Deposit Request"
        message={`Are you sure you want to reject and delete the deposit request from ${deleteDialog.memberName}?`}
        onConfirm={handleDelete}
        onClose={() => setDeleteDialog({ isOpen: false, requestId: '', memberName: '' })}
        confirmLabel="Reject & Delete"
        cancelLabel="Cancel"
        loading={isSubmitting}
      />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.operations', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.requestDeposit', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.requestDeposit', lang)}</h1>
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-all ${refreshing ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
        {currentUser?.permissions[AppScreen.REQUEST_DEPOSIT] === AccessLevel.WRITE && (
          <button onClick={() => handleOpenModal()} className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20">
            <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5">
          <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">Pending Requests</p>
          <div className="flex items-baseline gap-2">
            <span className="text-7xl font-black text-dark dark:text-white tracking-tighter leading-none">{requests.length}</span>
            <span className="text-xl font-black text-brand tracking-tight">Active</span>
          </div>
        </div>
        <div className="bg-dark dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between">
          <p className="text-[11px] font-black text-gray-300 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">Requested Volume</p>
          <div className="flex flex-col">
            <span className="text-5xl font-black text-brand tracking-tighter leading-tight uppercase">BDT {totalRequested.toLocaleString()}</span>
            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest mt-1">Projected Inflow</span>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5">
        <div className="px-10 py-8 border-b border-gray-50 dark:border-white/5 flex items-center justify-between gap-6">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by Partner, ID or Month..."
              className="w-full bg-gray-50/50 dark:bg-[#111814] pl-14 pr-6 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-2 focus:ring-dark dark:focus:ring-brand text-sm font-bold transition-all text-dark dark:text-white"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportMenu
            data={requests}
            columns={[
              { header: 'ID', key: 'id' },
              { header: 'Date', key: 'date' },
              { header: 'Partner', key: 'memberName' },
              { header: 'Shares', key: 'shareNumber' },
              { header: 'Month', key: 'depositMonth' },
              { header: 'Method', key: 'depositMethod' },
              { header: 'Amount (BDT)', key: 'amount', format: (d: any) => d.amount.toLocaleString() },
              { header: 'Status', key: 'status' },
              { header: 'Created At', key: 'createdAt' },
              { header: 'Updated At', key: 'updatedAt' }
            ]}
            fileName={`deposit_requests_${new Date().toISOString().split('T')[0]}`}
          />
          <button className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white transition-colors">
            <Filter size={20} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto px-2">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50/30 dark:bg-white/5">
              <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest cursor-pointer hover:text-brand transition-colors group" onClick={() => handleSort('date')}>
                <div className="flex items-center gap-2">
                  Request Ref
                  {sortBy === 'date' ? (sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />) : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                </div>
              </th>
              <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest cursor-pointer hover:text-brand transition-colors group" onClick={() => handleSort('memberId')}>
                <div className="flex items-center gap-2">
                  Partner
                  {sortBy === 'memberId' ? (sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />) : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                </div>
              </th>
              <th className="px-10 py-6 text-center text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest cursor-pointer hover:text-brand transition-colors group" onClick={() => handleSort('shares')}>
                <div className="flex items-center justify-center gap-2">
                  Shares
                  {sortBy === 'shares' ? (sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />) : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                </div>
              </th>
              <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Period</th>
              <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.depositMethod', lang)}</th>
              <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Audit</th>
              <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest cursor-pointer hover:text-brand transition-colors group" onClick={() => handleSort('amount')}>
                <div className="flex items-center justify-end gap-2">
                  Amount (BDT)
                  {sortBy === 'amount' ? (sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />) : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                </div>
              </th>
              <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Status</th>
              <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-white/5">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-10 py-20 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <RefreshCw className="animate-spin text-brand" size={40} />
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Scanning Requests...</p>
                  </div>
                </td>
              </tr>
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-10 py-20 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                  No pending vesting requests found in pipeline
                </td>
              </tr>
            ) : (
              requests.map((req) => (
                <tr key={req.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                  <td className="px-10 py-6">
                    <div className="flex flex-col">
                      <p className="text-[10px] font-black text-brand uppercase tracking-tighter">#{req.id.slice(-6)}</p>
                      <span className="text-xs font-bold text-gray-400 whitespace-nowrap">{req.date}</span>
                    </div>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center text-dark dark:text-brand font-black text-xs uppercase">
                        {req.memberName.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="font-black text-dark dark:text-white text-base leading-none mb-1 group-hover:text-brand transition-colors">{req.memberName}</p>
                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">ID: {req.memberDisplayId || req.memberId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-6 text-center">
                    <span className="font-black text-dark dark:text-brand text-lg">{req.shareNumber}</span>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-2 text-xs font-black text-gray-600 dark:text-gray-300">
                      <Calendar size={14} className="text-brand" />
                      {req.depositMonth}
                    </div>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-tighter">
                      <CreditCard size={12} />
                      {t(`deposits.methods.${(req.depositMethod?.toLowerCase().replace(' ', '') === 'mobilebanking' ? 'mobile' : req.depositMethod?.toLowerCase()) || 'bank'}`, lang)}
                    </div>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-[9px] font-black text-gray-400 uppercase tracking-wider">
                        <span className="text-gray-300 dark:text-gray-600">IN:</span> {req.createdAt}
                      </div>
                      {req.updatedAt && (
                        <div className="flex items-center gap-1.5 text-[9px] font-black text-brand uppercase tracking-wider">
                          <span className="text-gray-300 dark:text-gray-600">UP:</span> {req.updatedAt}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-10 py-6 text-right font-black text-dark dark:text-white text-xl tracking-tighter">
                    {formatCurrency(req.amount)}
                  </td>
                  <td className="px-10 py-6 text-right">
                    <span className="inline-block px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-400/10 text-amber-500">
                      {req.status}
                    </span>
                  </td>
                  <td className="px-10 py-6 text-right">
                    <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all">
                      {currentUser?.permissions[AppScreen.DEPOSITS] === AccessLevel.WRITE && (
                        <button
                          onClick={(e) => handleApprove(e, req.id)}
                          disabled={!!processingId}
                          title="Approve Request"
                          className={`p-3 rounded-2xl border transition-all ${processingId === req.id ? 'bg-gray-100 border-gray-200 cursor-wait' : 'bg-brand/10 text-brand border-brand/20 hover:bg-brand hover:text-dark'}`}
                        >
                          {processingId === req.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} strokeWidth={3} />}
                        </button>
                      )}
                      {currentUser?.permissions[AppScreen.REQUEST_DEPOSIT] === AccessLevel.WRITE && (
                        <>
                          <button onClick={() => handleOpenModal(req)} className="p-3 bg-white dark:bg-[#111814] rounded-2xl shadow-xl border border-gray-100 dark:border-white/5 text-gray-500 hover:text-dark dark:hover:text-brand hover:border-brand transition-all">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => handleDeleteClick(req.id, req.memberName)} className="p-3 bg-white dark:bg-[#111814] rounded-2xl shadow-xl border border-gray-100 dark:border-white/5 text-gray-500 hover:text-red-500 hover:border-red-500/30 transition-all">
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-10 py-8 border-t border-gray-50 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
          {paginatedData.meta && (
            <>Showing {paginatedData.meta.from} to {paginatedData.meta.to} of {paginatedData.meta.total} requests</>
          )}
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={paginatedData.pages}
          onPageChange={setCurrentPage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(newLimit) => {
            setRowsPerPage(newLimit);
            setCurrentPage(1);
          }}
        />
      </div>

      {isModalOpen && (
        <ModalForm
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          title={editingRequest ? 'Modify Request' : 'Deposit Request'}
          subtitle="Module: External Vesting Initiation"
          onSubmit={handleSubmit}
          submitLabel={editingRequest ? 'Update Request' : 'Submit for Approval'}
          loading={isSubmitting}
          maxWidth="max-w-5xl"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Field: Deposit Method */}
            <FormSelect
              label={t('deposits.depositMethod', lang)}
              name="depositMethod"
              value={formData.depositMethod}
              onChange={e => setFormData({ ...formData, depositMethod: e.target.value })}
              options={['Cash', 'Bank', 'Mobile Banking', 'Check', 'Other'].map(m => ({
                value: m,
                label: t(`deposits.methods.${m.toLowerCase().replace(' ', '') === 'mobilebanking' ? 'mobile' : m.toLowerCase()}`, lang) || m
              }))}
              icon={<CreditCard size={18} />}
              required
            />

            {/* Field 1: Partner */}
            <FormSelect
              label="Source Partner"
              name="memberId"
              value={formData.memberId}
              onChange={handleMemberChange}
              options={activeMembers.map(p => ({
                value: p.id,
                label: `${p.name} (#${p.memberId}) - ${p.shares} ${t('deposits.shares', lang)}`
              }))}
              icon={<User size={18} />}
              required
            />

            {/* Field 2: Shares */}
            <FormInput
              label="Shares Holding"
              value={formData.shareNumber}
              readOnly
              required
              className="opacity-50 cursor-not-allowed"
            />

            {/* Field 3: Target Fund */}
            <FormSelect
              label="Target Fund"
              name="fundId"
              value={formData.fundId}
              onChange={e => {
                const selectedFundId = e.target.value;
                const selectedFund = funds.find(f => f.id === selectedFundId);
                setFormData({
                  ...formData,
                  fundId: selectedFundId,
                  cashierName: selectedFund?.handlingOfficer || 'System'
                });
              }}
              options={funds.filter(f => (f.type === 'DEPOSIT' || f.type === 'Primary' || f.type === 'OTHER') && f.status !== 'ARCHIVED').map(f => ({
                value: f.id,
                label: `${f.name} (BDT ${f.balance.toLocaleString()})`
              }))}
              icon={<CheckSquare size={18} />}
              required
            />

            {/* Field 4: Amount */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Amount (BDT)</label>
                <button
                  type="button"
                  onClick={handleToggleAutoCalc}
                  className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-brand hover:opacity-80 transition-all"
                >
                  {autoCalculate ? <CheckSquare size={12} strokeWidth={3} /> : <Square size={12} strokeWidth={3} />}
                  Auto-Calc
                </button>
              </div>
              <input
                required
                disabled={autoCalculate}
                type="number"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                className={`w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white transition-all ${autoCalculate ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>

            {/* Field 5: Month */}
            <div className="space-y-2 relative">
              <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Requested Month</label>
              <div className="relative">
                <input
                  required
                  readOnly
                  onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
                  type="text"
                  value={formData.depositMonth}
                  className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white transition-all cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand transition-colors"
                >
                  <Calendar size={18} />
                </button>

                {isMonthPickerOpen && (
                  <>
                    <div className="fixed inset-0 bg-transparent z-[55]" onClick={() => setIsMonthPickerOpen(false)} />
                    <div
                      ref={monthPickerRef}
                      className="fixed z-[60] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-white dark:bg-[#1A221D] rounded-3xl border border-gray-100 dark:border-white/10 card-shadow p-6 animate-in zoom-in-95 duration-300"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <button
                          type="button"
                          onClick={() => setPickerYear(pickerYear - 1)}
                          className="p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl text-gray-400 hover:text-dark dark:hover:text-white transition-all"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <span className="text-xl font-black text-dark dark:text-white">{pickerYear}</span>
                        <button
                          type="button"
                          onClick={() => setPickerYear(pickerYear + 1)}
                          className="p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl text-gray-400 hover:text-dark dark:hover:text-white transition-all"
                        >
                          <ChevronRight size={20} />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {MONTHS.map((m, idx) => {
                          const isSelected = formData.depositMonth === `${t(`common.months.${monthKeys[idx]}`, lang)} ${pickerYear}`;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => selectMonth(t(`common.months.${monthKeys[idx]}`, lang), idx)}
                              className={`py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${isSelected
                                ? 'bg-brand text-dark shadow-xl shadow-brand/20'
                                : 'bg-gray-50 dark:bg-[#111814] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
                                }`}
                            >
                              {t(`common.months.${monthKeys[idx]}`, lang).substring(0, 3)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Field 6: Officer */}
            <FormInput
              label="Handling Officer"
              value={formData.cashierName}
              readOnly
              required
              className="opacity-70 cursor-not-allowed"
            />

            {/* Field New: Transaction Date */}
            <FormInput
              label="Intended Date"
              name="txnDate"
              type="date"
              value={formData.txnDate}
              onChange={e => setFormData({ ...formData, txnDate: e.target.value })}
              required
              className={formData.depositMonth !== getCurrentMonthYear() ? "opacity-60 cursor-not-allowed" : ""}
              disabled={formData.depositMonth !== getCurrentMonthYear()}
            />
          </div>

          <div className="mt-auto">
            <div className="flex items-center justify-between p-6 bg-gray-50 dark:bg-white/5 rounded-3xl">
              <p className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">Impact Analysis</p>
              <p className="text-3xl font-black text-dark dark:text-brand tracking-tighter leading-none">
                + {(parseInt(formData.amount || '0')).toLocaleString()} <span className="text-lg opacity-40">BDT</span>
              </p>
            </div>
          </div>
        </ModalForm>
      )
      }
    </div >
  );
};

export default RequestDeposit;
