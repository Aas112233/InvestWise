import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Filter, X, Calendar, User, CheckSquare, Square, ChevronLeft, ChevronRight, Edit2, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Deposit } from '../types';
import Toast, { ToastType } from './Toast';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import ExportMenu from './ExportMenu';
import { formatCurrency } from '../utils/formatters';

const SHARE_WORTH = 1000;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const Deposits: React.FC = () => {
  const { deposits: globalDeposits, members: globalMembers, funds, refreshTransactions } = useGlobalState();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const activeMembers = globalMembers.filter(m => m.status === 'active');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshTransactions();
    setTimeout(() => setRefreshing(false), 500);
  };

  useEffect(() => {
    setDeposits(globalDeposits);
  }, [globalDeposits]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDeposit, setEditingDeposit] = useState<Deposit | null>(null);
  const [autoCalculate, setAutoCalculate] = useState(true);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  const getCurrentMonthYear = () => {
    const date = new Date();
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

  // ...

  const handleOpenModal = (deposit?: Deposit) => {
    if (deposit) {
      setEditingDeposit(deposit);
      // If editing existing, we might not have fundId easily available on Deposit object unless we populate it 
      // or if Deposit type has it. Deposit type didn't have it in previous types.ts shown.
      // Assuming we default or if Deposit has it. Checking types.ts... Deposit interface does NOT have fundId visible.
      // But we are creating new deposits mainly. 
      // For now, if editing, we might need to fetch it or default.
      setFormData({
        memberId: deposit.memberId,
        memberName: deposit.memberName,
        shareNumber: deposit.shareNumber.toString(),
        amount: deposit.amount.toString(),
        depositMonth: deposit.depositMonth,
        cashierName: deposit.cashierName,
        fundId: '' // We don't have it on the frontend object yet. 
        // Ideally we should update Deposit interface too, but for now let user select again or keep empty?
        // User said "Deposit screens... show a Fund dropdown".
        // If editing is allowed, we should probably know the fund.
      });
      setAutoCalculate(false);
    } else {
      setEditingDeposit(null);
      const defaultPartner = activeMembers[0];
      // Default to first valid fund
      const defaultFund = funds.find(f => (f.type === 'DEPOSIT' || f.type === 'Primary') && f.status !== 'ARCHIVED');

      setFormData({
        memberId: defaultPartner?.memberId || '',
        memberName: defaultPartner?.name || '',
        shareNumber: defaultPartner?.shares.toString() || '0',
        amount: (defaultPartner?.shares * SHARE_WORTH).toString() || '0',
        depositMonth: getCurrentMonthYear(),
        cashierName: defaultFund?.handlingOfficer || 'System',
        fundId: defaultFund ? defaultFund.id : ''
      });
      setAutoCalculate(true);
    }
    setPickerYear(new Date().getFullYear());
    setIsModalOpen(true);
  };

  // ...

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

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setIsMonthPickerOpen(false);
    setEditingDeposit(null);
  };

  const handleMemberChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    const partner = activeMembers.find(p => p.memberId === selectedId);
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
      setFormData({
        ...formData,
        amount: (sharesNum * SHARE_WORTH).toString()
      });
    }
  };

  const selectMonth = (monthName: string) => {
    setFormData({ ...formData, depositMonth: `${monthName} ${pickerYear}` });
    setIsMonthPickerOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!formData.fundId) {
        throw new Error("Please select a Target Fund.");
      }

      const selectedMember = activeMembers.find(m => m.memberId === formData.memberId);
      if (!selectedMember) {
        throw new Error("Invalid member selected");
      }

      const payload = {
        memberId: selectedMember.id, // Use ObjectId for backend relation
        amount: parseInt(formData.amount),
        fundId: formData.fundId,
        description: `Deposit for ${formData.depositMonth}`,
        date: new Date().toISOString(),
        shareNumber: parseInt(formData.shareNumber),
        status: 'Completed',
        cashierName: formData.cashierName
      };

      await financeService.addDeposit(payload);
      showNotification(`Deposit of BDT ${parseInt(formData.amount).toLocaleString()} confirmed for ${formData.memberName}.`);
      handleCloseModal();
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: any) {
      console.error(err);
      showNotification(err.message || "Failed to record deposit.", "error");
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (processingId) return;

    console.log("Delete (Archive) requested for:", id);

    try {
      setProcessingId(id);
      await financeService.deleteTransaction(id);
      setDeposits(prev => prev.filter(d => d.id !== id));
      showNotification(`Deposit record archived.`);
    } catch (err: any) {
      console.error("Delete failed", err);
      showNotification(err.message || "Failed to delete deposit.", "error");
      setProcessingId(null);
    }
  };

  const totalMonthly = deposits.reduce((acc, d) => {
    const current = getCurrentMonthYear();
    return acc + (d.depositMonth === current ? d.amount : 0);
  }, 0);

  const totalAmount = deposits.reduce((acc, d) => acc + d.amount, 0);
  const totalCount = deposits.length;

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <Toast
        isVisible={toast.isVisible}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ ...toast, isVisible: false })}
      />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>OPERATIONS</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">DEPOSITS</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">Capital Inflow</h1>
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
            data={deposits}
            columns={[
              { header: 'ID', key: 'id' },
              { header: 'Date', key: 'date', format: (d: any) => new Date(d.date).toLocaleDateString() },
              { header: 'Member', key: 'memberName' },
              { header: 'Deposit Month', key: 'depositMonth' },
              { header: 'Shares', key: 'shareNumber' },
              { header: 'Amount', key: 'amount', format: (d: any) => formatCurrency(d.amount) },
              { header: 'Status', key: 'status' }
            ]}
            fileName={`deposits_${new Date().toISOString().split('T')[0]}`}
            title="Capital Inflow Report"
          />
          <button
            onClick={() => handleOpenModal()}
            className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
          >
            <Plus size={20} strokeWidth={3} /> New Deposit
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5 transition-all hover:-translate-y-2 duration-500">
          <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">Current Month</p>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-black text-dark dark:text-white tracking-tighter leading-none">{formatCurrency(totalMonthly)}</span>
            <span className="text-sm font-black text-brand tracking-tight">{getCurrentMonthYear().split(' ')[0]}</span>
          </div>
        </div>
        <div className="bg-dark dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between transition-all hover:-translate-y-2 duration-500">
          <p className="text-[11px] font-black text-gray-300 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">Total Capital</p>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-black text-brand tracking-tighter leading-none uppercase">{formatCurrency(totalAmount)}</span>
            <span className="text-sm font-black text-white/40 tracking-tight">Lifetime</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5 transition-all hover:-translate-y-2 duration-500">
          <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">Total Deposits</p>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-black text-dark dark:text-white tracking-tighter leading-none">{totalCount}</span>
            <span className="text-sm font-black text-gray-400 tracking-tight">Records</span>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5 transition-colors duration-300">
        <div className="px-10 py-8 border-b border-gray-50 dark:border-white/5 flex items-center justify-between gap-6">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Filter by Member ID, Name or Deposit ID..."
              className="w-full bg-gray-50/50 dark:bg-[#111814] pl-14 pr-6 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-2 focus:ring-dark dark:focus:ring-brand text-sm font-bold transition-all dark:text-white placeholder:text-gray-400"
            />
          </div>
          <button className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white transition-colors">
            <Filter size={20} />
          </button>
        </div>

        <div className="overflow-x-auto px-2">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50/30 dark:bg-white/5">
                <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Deposit Transaction</th>
                <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Partner Entity</th>
                <th className="px-6 py-6 text-center text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Shares</th>
                <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Month Period</th>
                <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Amount (BDT)</th>
                <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Handled By</th>
                <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {deposits.map((dep) => (
                <tr key={dep.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                  <td className="px-6 py-6">
                    <div className="flex flex-col">
                      <p className="text-[10px] font-black text-brand uppercase tracking-tighter">#{dep.id}</p>
                      <p className="text-xs font-bold text-gray-400">{dep.date}</p>
                    </div>
                  </td>
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center text-dark dark:text-brand font-black text-xs">
                        {dep.memberName.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="font-black text-dark dark:text-white text-base leading-none mb-1 group-hover:text-brand transition-colors">{dep.memberName}</p>
                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">ID: #{dep.memberId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-6 text-center">
                    <span className="font-black text-dark dark:text-brand text-lg">{dep.shareNumber}</span>
                  </td>
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-2 text-xs font-black text-gray-600 dark:text-gray-300">
                      <Calendar size={14} className="text-brand" />
                      {dep.depositMonth}
                    </div>
                  </td>
                  <td className="px-6 py-6 text-right">
                    <p className="font-black text-dark dark:text-white text-xl tracking-tighter leading-none">
                      {formatCurrency(dep.amount)}
                    </p>
                  </td>
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-tighter">
                      <User size={12} />
                      {dep.cashierName}
                    </div>
                  </td>
                  <td className="px-6 py-6 text-right">
                    <span className={`inline-block px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${dep.status === 'Completed' ? 'bg-brand/10 text-brand' : 'bg-amber-400/10 text-amber-500'
                      }`}>
                      {dep.status}
                    </span>
                  </td>
                  <td className="px-6 py-6 text-right">
                    <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all">
                      <button
                        onClick={(e) => handleDelete(e, dep.id)}
                        disabled={!!processingId}
                        className={`p-3 rounded-2xl shadow-xl border transition-all ${processingId === dep.id ? 'bg-red-50 border-red-100 cursor-wait' : 'bg-white dark:bg-[#111814] border-gray-100 dark:border-white/5 text-gray-500 hover:text-red-500 hover:border-red-500/30'}`}
                      >
                        {processingId === dep.id ? <Loader2 size={16} className="animate-spin text-red-500" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
                  Initialize Deposit
                </h3>
                <p className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.4em]">
                  Module: Capital Injection & Savings
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  {/* Field 1: Partner */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Strategic Partner</label>
                    <div className="relative group">
                      <select
                        value={formData.memberId}
                        onChange={handleMemberChange}
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold appearance-none cursor-pointer dark:text-white text-dark transition-all"
                      >
                        <option value="">Select a member...</option>
                        {activeMembers.map(p => (
                          <option key={p.memberId} value={p.memberId} className="bg-white dark:bg-dark text-dark dark:text-white">
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
                    <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Shares Count</label>
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
                          <option key={f.id} value={f.id}>{f.name} ({f.balance.toLocaleString()} {f.currency || 'BDT'})</option>
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
                      <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Total Amount (BDT)</label>
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
                    <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Deposit Month</label>
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
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white transition-all opacity-70 cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-6 flex items-center justify-between gap-10 border-t border-gray-100 dark:border-white/10">
                  <div>
                    <p className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">Savings Impact</p>
                    <p className="text-3xl font-black text-dark dark:text-brand tracking-tighter leading-none">
                      + {formatCurrency(parseInt(formData.amount || '0'))}
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-xs uppercase hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-brand/20"
                  >
                    Commit Transaction
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

export default Deposits;
