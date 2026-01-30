
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Filter, X, Calendar, User, CheckSquare, Square, ChevronLeft, ChevronRight, Edit2, Trash2, CheckCircle, RefreshCw, Loader2 } from 'lucide-react';
import { Deposit, AccessLevel, AppScreen } from '../types';
import Toast, { ToastType } from './Toast';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import ActionDialog from './ActionDialog';

const SHARE_WORTH = 1000;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

interface RequestDepositProps {
  lang: Language;
}

const RequestDeposit: React.FC<RequestDepositProps> = ({ lang }) => {
  const { members: globalMembers, deposits: globalDeposits, funds, refreshTransactions, currentUser } = useGlobalState();
  const [requests, setRequests] = useState<Deposit[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshTransactions();
    setTimeout(() => setRefreshing(false), 500);
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
  useEffect(() => {
    const pending = globalDeposits.filter(d => d.status === 'Pending' || d.status === 'Processing');
    setRequests(pending);
  }, [globalDeposits]);

  const getCurrentMonthYear = () => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  };

  const [formData, setFormData] = useState({
    memberId: '',
    memberName: '',
    shareNumber: '0',
    amount: '0',
    depositMonth: getCurrentMonthYear(),
    cashierName: 'System',
    fundId: ''
  });

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
        memberName: request.memberName,
        shareNumber: request.shareNumber.toString(),
        amount: request.amount.toString(),
        depositMonth: request.depositMonth,
        cashierName: request.cashierName,
        fundId: '' // We might not have this easily, let user select or default
      });
      setAutoCalculate(false);
    } else {
      setEditingRequest(null);
      const defaultPartner = activeMembers[0];
      const defaultFund = funds.find(f => (f.type === 'DEPOSIT' || f.type === 'Primary') && f.status !== 'ARCHIVED');

      setFormData({
        memberId: defaultPartner?.id || '',
        memberName: defaultPartner?.name || '',
        shareNumber: defaultPartner?.shares.toString() || '0',
        amount: (defaultPartner?.shares * SHARE_WORTH).toString() || '0',
        depositMonth: getCurrentMonthYear(),
        cashierName: defaultFund?.handlingOfficer || 'System',
        fundId: defaultFund ? defaultFund.id : ''
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

  const selectMonth = (monthName: string) => {
    setFormData({ ...formData, depositMonth: `${monthName} ${pickerYear}` });
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
        description: `Deposit Request for ${formData.depositMonth}`,
        date: new Date().toISOString(),
        shareNumber: parseInt(formData.shareNumber),
        status: 'Pending',
        cashierName: formData.cashierName
      };

      const newDeposit = await financeService.addDeposit(payload);
      const mappedDeposit: Deposit = {
        id: newDeposit._id || newDeposit.id,
        memberId: formData.memberId,
        memberName: formData.memberName,
        shareNumber: parseInt(formData.shareNumber),
        amount: parseInt(formData.amount),
        depositMonth: formData.depositMonth,
        cashierName: formData.cashierName,
        status: 'Pending',
        date: newDeposit.date?.split('T')[0] || new Date().toISOString().split('T')[0]
      };

      setRequests(prev => [mappedDeposit, ...prev]);
      showNotification(`Deposit request for ${formData.memberName} submitted successfully.`);
      handleCloseModal();

      // Ideally trigger global reload here
      setTimeout(() => window.location.reload(), 1000);

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
      console.log("Calling API approve...");
      await financeService.approveDeposit(id);
      console.log("API Success");

      showNotification(`Request approved for ${request.memberName}`);

      // Optimistic updatish
      setRequests(prev => prev.filter(r => r.id !== id));

      // Reload to accept changes globally
      setTimeout(() => window.location.reload(), 1000);
    } catch (error: any) {
      console.error("Approval API Error:", error);
      showNotification(error.message || "Approval failed", "error");
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
            <input type="text" placeholder="Search by Partner, ID or Month..." className="w-full bg-gray-50/50 dark:bg-[#111814] pl-14 pr-6 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-2 focus:ring-dark dark:focus:ring-brand text-sm font-bold transition-all text-dark dark:text-white" />
          </div>
          <button className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white transition-colors">
            <Filter size={20} />
          </button>
        </div>

        <div className="overflow-x-auto px-2">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50/30 dark:bg-white/5">
                <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Request Ref</th>
                <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Partner</th>
                <th className="px-10 py-6 text-center text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Shares</th>
                <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Period</th>
                <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Amount (BDT)</th>
                <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Status</th>
                <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {requests.map((req) => (
                <tr key={req.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                  <td className="px-10 py-6">
                    <div className="flex flex-col">
                      <p className="text-[10px] font-black text-brand uppercase tracking-tighter">#{req.id}</p>
                      <p className="text-xs font-bold text-gray-400">{req.date}</p>
                    </div>
                  </td>
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center text-dark dark:text-brand font-black text-xs">
                        {req.memberName.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="font-black text-dark dark:text-white text-base leading-none mb-1 group-hover:text-brand transition-colors">{req.memberName}</p>
                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">ID: #{req.memberId}</p>
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
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-10 py-20 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                    No pending vesting requests found in pipeline
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-dark/90 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white dark:bg-[#1A221D] w-full max-w-5xl rounded-[3rem] card-shadow overflow-hidden relative animate-in zoom-in-95 duration-300 border border-gray-100 dark:border-white/10">
            <button
              onClick={handleCloseModal}
              className="absolute top-8 right-8 p-3 text-gray-500 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-2xl transition-all"
            >
              <X size={24} strokeWidth={3} />
            </button>
            <div className="p-10">
              <div className="mb-6">
                <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-2">
                  {editingRequest ? 'Modify Request' : 'Deposit Request'}
                </h3>
                <p className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.4em]">
                  Module: External Vesting Initiation
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-3 gap-6 mb-8">
                  {/* Field 1: Partner */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Source Partner</label>
                    <div className="relative group">
                      <select
                        value={formData.memberId}
                        onChange={handleMemberChange}
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold appearance-none cursor-pointer dark:text-white text-dark transition-all"
                      >
                        <option value="">Select a member...</option>
                        {activeMembers.map(p => (
                          <option key={p.id} value={p.id} className="bg-white dark:bg-dark text-dark dark:text-white">
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 group-hover:text-dark dark:group-hover:text-brand transition-colors">
                        <User size={18} />
                      </div>
                    </div>
                  </div>

                  {/* Field 2: Shares */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Shares Holding</label>
                    <div className="relative">
                      <input
                        required
                        readOnly
                        type="number"
                        value={formData.shareNumber}
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-none outline-none text-sm font-bold text-dark dark:text-white transition-all opacity-50 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {/* Field 3: Target Fund */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Target Fund</label>
                    <div className="relative group">
                      <select
                        required
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
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold appearance-none cursor-pointer dark:text-white text-dark transition-all"
                      >
                        <option value="">Select Fund...</option>
                        {funds.filter(f => (f.type === 'DEPOSIT' || f.type === 'Primary' || f.type === 'OTHER') && f.status !== 'ARCHIVED').map(f => (
                          <option key={f.id} value={f.id}>{f.name} (BDT {f.balance.toLocaleString()})</option>
                        ))}
                      </select>
                      <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 group-hover:text-dark dark:group-hover:text-brand transition-colors">
                        <CheckSquare size={18} />
                      </div>
                    </div>
                  </div>

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
                    <div className="relative">
                      <input
                        required
                        disabled={autoCalculate}
                        type="number"
                        value={formData.amount}
                        onChange={e => setFormData({ ...formData, amount: e.target.value })}
                        className={`w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white transition-all ${autoCalculate ? 'opacity-50 cursor-not-allowed' : ''}`}
                      />
                    </div>
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
                          {/* Backdrop */}
                          <div className="fixed inset-0 bg-transparent z-[55]" onClick={() => setIsMonthPickerOpen(false)} />
                          {/* Centered Modal */}
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
                              {MONTHS.map((m) => {
                                const isSelected = formData.depositMonth === `${m} ${pickerYear}`;
                                return (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => selectMonth(m)}
                                    className={`py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${isSelected
                                      ? 'bg-brand text-dark shadow-xl shadow-brand/20'
                                      : 'bg-gray-50 dark:bg-[#111814] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
                                      }`}
                                  >
                                    {m.substring(0, 3)}
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
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Handling Officer</label>
                    <div className="relative">
                      <input
                        required
                        readOnly
                        type="text"
                        value={formData.cashierName}
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 outline-none text-sm font-bold text-dark dark:text-white transition-all opacity-70 cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-6 flex items-center justify-between gap-10 border-t border-gray-100 dark:border-white/10">
                  <div>
                    <p className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">Impact Analysis</p>
                    <p className="text-3xl font-black text-dark dark:text-brand tracking-tighter leading-none">
                      + {(parseInt(formData.amount || '0')).toLocaleString()} <span className="text-lg opacity-40">BDT</span>
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-xs uppercase shadow-2xl shadow-brand/20 flex items-center gap-2 ${isSubmitting ? 'opacity-70 cursor-wait' : 'hover:scale-105 active:scale-95 transition-all'}`}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
                    {editingRequest ? 'Update Request' : 'Submit for Approval'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestDeposit;
