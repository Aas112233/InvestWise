import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Filter, X, Calendar, User, CheckSquare, Square, ChevronLeft, ChevronRight, Edit2, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Deposit, AccessLevel, AppScreen } from '../types';
import Toast, { ToastType } from './Toast';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import ExportMenu from './ExportMenu';
import { formatCurrency } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import ActionDialog from './ActionDialog';
import { ModalForm, FormInput, FormSelect } from './ui/FormElements';
import PermissionGuard from './PermissionGuard';

const SHARE_WORTH = 1000;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const monthKeys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface DepositsProps {
  lang: Language;
}

const Deposits: React.FC<DepositsProps> = ({ lang }) => {
  const { deposits: globalDeposits, members: globalMembers, funds, refreshTransactions, currentUser } = useGlobalState();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const activeMembers = globalMembers.filter(m => m.status === 'active');
  const [refreshing, setRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshTransactions();
    setTimeout(() => setRefreshing(false), 500);
  };

  useEffect(() => {
    // Only show approved/completed deposits in the history table
    setDeposits(globalDeposits.filter(d => d.status === 'Completed'));
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

  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    depositId: string;
    memberName: string;
  }>({
    isOpen: false,
    depositId: '',
    memberName: ''
  });

  const getCurrentMonthYear = () => {
    const date = new Date();
    return `${t(`common.months.${monthKeys[date.getMonth()]}`, lang)} ${date.getFullYear()}`;
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
        memberId: defaultPartner?.id || '', // ✅ Use id (database ID) not memberId (display ID)
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

  const selectMonth = (monthName: string, index: number) => {
    const translatedMonth = t(`common.months.${monthKeys[index]}`, lang);
    setFormData({ ...formData, depositMonth: `${translatedMonth} ${pickerYear}` });
    setIsMonthPickerOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (!formData.fundId) {
        throw new Error(t('deposits.selectFundError', lang));
      }

      const selectedMember = activeMembers.find(m => m.id === formData.memberId); // ✅ Compare id with id
      if (!selectedMember) {
        throw new Error(t('deposits.invalidMember', lang));
      }

      const payload = {
        memberId: selectedMember.id, // Use ObjectId for backend relation
        amount: parseInt(formData.amount),
        fundId: formData.fundId,
        description: t('deposits.descForMonth', lang).replace('{month}', formData.depositMonth),
        date: new Date().toISOString(),
        shareNumber: parseInt(formData.shareNumber),
        status: 'Completed',
        cashierName: formData.cashierName
      };

      await financeService.addDeposit(payload);
      showNotification(t('deposits.confirmSuccess', lang).replace('{amount}', parseInt(formData.amount).toLocaleString()).replace('{member}', formData.memberName));
      handleCloseModal();
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: any) {
      showNotification(err.message || t('deposits.recordError', lang), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (id: string, memberName: string) => {
    setDeleteDialog({
      isOpen: true,
      depositId: id,
      memberName
    });
  };

  const handleDelete = async () => {
    if (processingId) return;
    const { depositId } = deleteDialog;

    try {
      setProcessingId(depositId);
      setIsSubmitting(true);
      await financeService.deleteTransaction(depositId);
      setDeposits(prev => prev.filter(d => d.id !== depositId));
      showNotification(t('deposits.archived', lang));
      setDeleteDialog({ isOpen: false, depositId: '', memberName: '' });
    } catch (err: any) {
      console.error("Delete failed", err);
      showNotification(err.message || t('deposits.deleteError', lang), "error");
    } finally {
      setProcessingId(null);
      setIsSubmitting(false);
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

      <ActionDialog
        isOpen={deleteDialog.isOpen}
        type="delete"
        title={t('deposits.deleteDeposit', lang)}
        message={`${t('deposits.deleteConfirm', lang)} ${deleteDialog.memberName}?`}
        onConfirm={handleDelete}
        onClose={() => setDeleteDialog({ isOpen: false, depositId: '', memberName: '' })}
        confirmLabel={t('common.delete', lang)}
        cancelLabel={t('common.cancel', lang)}
        loading={isSubmitting}
      />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.operations', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.deposits', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.deposits', lang)}</h1>
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
              { header: t('transactions.date', lang), key: 'date', format: (d: any) => new Date(d.date).toLocaleDateString() },
              { header: t('nav.members', lang), key: 'memberName' },
              { header: t('deposits.monthPeriod', lang), key: 'depositMonth' },
              { header: t('deposits.shares', lang), key: 'shareNumber' },
              { header: `${t('deposits.amountBDT', lang)} (BDT)`, key: 'amount', format: (d: any) => d.amount.toLocaleString() },
              { header: t('transactions.status', lang), key: 'status' }
            ]}
            fileName={`deposits_${new Date().toISOString().split('T')[0]}`}
            title={t('deposits.capitalInflowReport', lang)}
            lang={lang}
            targetId="deposits-snapshot-target"
          />
          <PermissionGuard screen={AppScreen.DEPOSITS} requiredLevel={AccessLevel.WRITE}>
            <button
              onClick={() => handleOpenModal()}
              className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
            >
              <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
            </button>
          </PermissionGuard>
        </div>
      </div>

      <div id="deposits-snapshot-target" className="space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white dark:bg-[#1A221D] p-8 lg:p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5 transition-all hover:-translate-y-2 duration-500">
            <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">{t('deposits.currentMonth', lang)}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`font-black text-dark dark:text-white tracking-tighter leading-none ${formatCurrency(totalMonthly).length > 12 ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'}`}>{formatCurrency(totalMonthly)}</span>
              <span className="text-sm font-black text-brand tracking-tight">{t(`common.months.${monthKeys[new Date().getMonth()]}`, lang)}</span>
            </div>
          </div>
          <div className="bg-dark dark:bg-[#1A221D] p-8 lg:p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between transition-all hover:-translate-y-2 duration-500">
            <p className="text-[11px] font-black text-gray-300 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">{t('deposits.totalCapital', lang)}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`font-black text-brand tracking-tighter leading-none uppercase ${formatCurrency(totalAmount).length > 12 ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'}`}>{formatCurrency(totalAmount)}</span>
              <span className="text-sm font-black text-white/40 tracking-tight">{t('deposits.lifetime', lang)}</span>
            </div>
          </div>
          <div className="bg-white dark:bg-[#1A221D] p-8 lg:p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5 transition-all hover:-translate-y-2 duration-500">
            <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">{t('transactions.allTypes', lang)}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-4xl sm:text-5xl font-black text-dark dark:text-white tracking-tighter leading-none">{totalCount}</span>
              <span className="text-sm font-black text-gray-400 tracking-tight">{t('deposits.records', lang)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5 transition-colors duration-300">
          <div className="px-10 py-8 border-b border-gray-50 dark:border-white/5 flex items-center justify-between gap-6">
            <div className="relative flex-1 max-w-lg">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder={t('deposits.filterPlaceholder', lang)}
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
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.depositTx', lang)}</th>
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.partnerEntity', lang)}</th>
                  <th className="px-6 py-6 text-center text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.shares', lang)}</th>
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.monthPeriod', lang)}</th>
                  <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.amountBDT', lang)}</th>
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.handledBy', lang)}</th>
                  <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('transactions.status', lang)}</th>
                  <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('transactions.actions', lang)}</th>
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
                        {t('common.completed', lang)}
                      </span>
                    </td>
                    <td className="px-6 py-6 text-right">
                      <PermissionGuard screen={AppScreen.DEPOSITS} requiredLevel={AccessLevel.WRITE}>
                        <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteClick(dep.id, dep.memberName);
                            }}
                            disabled={!!processingId}
                            className={`p-3 rounded-2xl shadow-xl border transition-all ${processingId === dep.id ? 'bg-red-50 border-red-100 cursor-wait' : 'bg-white dark:bg-[#111814] border-gray-100 dark:border-white/5 text-gray-500 hover:text-red-500 hover:border-red-500/30'}`}
                          >
                            {processingId === dep.id ? <Loader2 size={16} className="animate-spin text-red-500" /> : <Trash2 size={16} />}
                          </button>
                        </div>
                      </PermissionGuard>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <ModalForm
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          title={t('deposits.initializeDeposit', lang)}
          subtitle={t('deposits.moduleTitle', lang)}
          onSubmit={handleSubmit}
          submitLabel={t('deposits.commitTx', lang)}
          maxWidth="max-w-7xl"
          loading={isSubmitting}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
            {/* Field 1: Partner */}
            <FormSelect
              label={t('deposits.strategicPartner', lang)}
              name="memberId"
              value={formData.memberId}
              onChange={handleMemberChange}
              placeholder={t('deposits.selectMember', lang)}
              options={activeMembers.map(p => ({
                value: p.memberId,
                label: p.name,
                className: "bg-white dark:bg-dark text-dark dark:text-white"
              }))}
              icon={<User size={18} />}
              required
            />

            {/* Field 2: Shares */}
            <FormInput
              label={t('deposits.sharesCount', lang)}
              name="shareNumber"
              value={formData.shareNumber}
              readOnly
              required
              className="opacity-70 cursor-not-allowed"
            />

            {/* Field 3: Target Fund */}
            <FormSelect
              label={t('deposits.targetFund', lang)}
              name="fundId"
              value={formData.fundId}
              onChange={e => {
                const selectedFundId = e.target.value;
                // Only find if we have a valid ID (filter out placeholder calls if any, though native select event sends value)
                if (!selectedFundId) {
                  setFormData({ ...formData, fundId: '' });
                  return;
                }
                const selectedFund = funds.find(f => f.id === selectedFundId);
                setFormData({
                  ...formData,
                  fundId: selectedFundId,
                  cashierName: selectedFund?.handlingOfficer || 'System'
                });
              }}
              placeholder={t('deposits.selectFund', lang)}
              options={funds.filter(f => (f.type === 'DEPOSIT' || f.type === 'Primary' || f.type === 'OTHER') && f.status !== 'ARCHIVED').map(f => ({
                value: f.id,
                label: `${f.name} (${f.balance.toLocaleString()} ${f.currency || 'BDT'})`
              }))}
              icon={<CheckSquare size={18} />}
              required
            />

            {/* Field 4: Amount */}
            <div className="space-y-2 relative">
              <div className="flex items-center justify-between px-1">
                <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.totalAmountBDT', lang)}</label>
                <button
                  type="button"
                  onClick={handleToggleAutoCalc}
                  className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-brand hover:opacity-80 transition-all"
                >
                  {autoCalculate ? <CheckSquare size={12} strokeWidth={3} /> : <Square size={12} strokeWidth={3} />}
                  {t('deposits.autoCalc', lang)}
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
              <label className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">{t('deposits.depositMonth', lang)}</label>
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
                              onClick={() => selectMonth(m, idx)}
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
              label={t('deposits.handlingOfficer', lang)}
              value={formData.cashierName}
              readOnly
              required
              className="opacity-70 cursor-not-allowed"
            />
          </div>

          <div className="mt-auto">
            <div className="flex items-center justify-between p-6 bg-gray-50 dark:bg-white/5 rounded-3xl">
              <p className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">{t('deposits.savingsImpact', lang)}</p>
              <p className="text-3xl font-black text-dark dark:text-brand tracking-tighter leading-none">
                + {formatCurrency(parseInt(formData.amount || '0'))}
              </p>
            </div>
          </div>
        </ModalForm>
      )}
    </div>
  );
};

export default Deposits;
