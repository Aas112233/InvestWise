import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Archive, DollarSign, TrendingUp, TrendingDown, Wallet, RefreshCw, FolderOpen, ArrowRightLeft, ShieldCheck, AlertCircle, Database, UserCheck, History, ExternalLink, Activity, Clock, MoreVertical } from 'lucide-react';
import { Fund, Member, AccessLevel, AppScreen } from '../types';
import Toast, { ToastType } from './Toast';
import { useGlobalState } from '../context/GlobalStateContext';
import { fundService } from '../services/api';
import { Language, t } from '../i18n/translations';
import { formatCurrency } from '../utils/formatters';
import ExportMenu from './ExportMenu';
import { ModalForm, FormInput, FormSelect, FormTextarea, FormLabel } from './ui/FormElements';
import PermissionGuard from './PermissionGuard';

interface FundsManagementProps {
  lang: Language;
}

const FundsManagement: React.FC<FundsManagementProps> = ({ lang }) => {
  const { funds, addFund, updateFund, refreshFunds, currentUser, transferFunds, reconcileFund } = useGlobalState();
  const [refreshing, setRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingFundId, setEditingFundId] = useState<string | null>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const [transferData, setTransferData] = useState({
    sourceFundId: '',
    targetFundId: '',
    amount: '',
    description: ''
  });

  const totalLiquidity = funds.filter(f => f.status === 'ACTIVE').reduce((sum, f) => sum + f.balance, 0);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshFunds();
    setTimeout(() => setRefreshing(false), 500);
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false, message: '', type: 'success'
  });

  // Filter out funds based on type/status
  const activeFunds = funds.filter(f => f.status === 'ACTIVE');
  const archivedFunds = funds.filter(f => f.status === 'ARCHIVED');

  const [formData, setFormData] = useState({
    name: '',
    type: 'OTHER', // Default for manual creation
    description: '',
    initialBalance: '',
    handlingOfficer: '',
    accountNumber: ''
  });

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const handleOpenModal = () => {
    setFormData({ name: '', type: 'OTHER', description: '', initialBalance: '', handlingOfficer: '', accountNumber: '' });
    setEditingFundId(null);
    setIsModalOpen(true);
  };

  const handleEditFund = (fund: Fund) => {
    setFormData({
      name: fund.name,
      type: fund.type as any,
      description: fund.description || '',
      initialBalance: '', // Not editable
      handlingOfficer: fund.handlingOfficer || '',
      accountNumber: fund.accountNumber || ''
    });
    setEditingFundId(fund.id);
    setIsModalOpen(true);
    setOpenMenuId(null);
  };

  const handleCreateFund = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editingFundId) {
        // Handle Update
        const fundToUpdate = funds.find(f => f.id === editingFundId);
        if (fundToUpdate) {
          await updateFund({
            ...fundToUpdate,
            name: formData.name,
            type: fundToUpdate.type,
            description: formData.description,
            handlingOfficer: formData.handlingOfficer,
            accountNumber: formData.accountNumber
          });
          showNotification(`Fund "${formData.name}" updated successfully.`);
        }
      } else {
        // Handle Create
        const payload: any = {
          name: formData.name,
          type: formData.type,
          description: formData.description,
          status: 'ACTIVE',
          balance: 0,
          currency: 'BDT',
          handlingOfficer: formData.handlingOfficer,
          accountNumber: formData.accountNumber
        };

        if (formData.initialBalance && parseFloat(formData.initialBalance) > 0) {
          payload.initialBalance = parseFloat(formData.initialBalance);
        }

        await addFund(payload);
        showNotification(`Fund "${formData.name}" created successfully.`);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      showNotification(err.message || "Operation failed.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (fund: Fund) => {
    if (confirm(`Are you sure you want to archive "${fund.name}"? Transactions will remain, but new deposits will be blocked.`)) {
      try {
        await updateFund({ ...fund, status: 'ARCHIVED' });
        showNotification(`Fund "${fund.name}" archived.`);
      } catch (err: any) {
        showNotification("Failed to archive fund.", "error");
      }
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferData.sourceFundId || !transferData.targetFundId || !transferData.amount) {
      showNotification("Please fill all required fields", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      await transferFunds({
        sourceFundId: transferData.sourceFundId,
        targetFundId: transferData.targetFundId,
        amount: parseFloat(transferData.amount),
        description: transferData.description
      });
      showNotification("Funds transferred successfully");
      setIsTransferModalOpen(false);
      setTransferData({ sourceFundId: '', targetFundId: '', amount: '', description: '' });
    } catch (err: any) {
      showNotification(err.message || "Transfer failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReconcile = async (fundId: string) => {
    setReconcilingId(fundId);
    try {
      const result = await reconcileFund(fundId);
      if (result.isMatched) {
        showNotification(`${result.fund} reconciled successfully. No discrepancies found.`, 'success');
      } else {
        showNotification(`${result.fund} has a discrepancy of ${formatCurrency(result.discrepancy)}. Please audit internal records.`, 'error');
      }
    } catch (err: any) {
      showNotification("Reconciliation failed", "error");
    } finally {
      setReconcilingId(null);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isVisible: false })} />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.strategy', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.fundsMgmt', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.fundsMgmt', lang)}</h1>
            <div className="h-10 w-[1px] bg-gray-200 dark:bg-white/10 hidden md:block" />
            <div className="hidden md:flex items-baseline gap-2">
              <span className="text-sm font-black text-gray-400 uppercase tracking-widest leading-none">Total Liquidity:</span>
              <span className="text-2xl font-black text-brand tracking-tighter leading-none">{formatCurrency(totalLiquidity)}</span>
            </div>
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
            data={activeFunds}
            columns={[
              { header: 'ID', key: 'id' },
              { header: t('funds.fundName', lang) || 'Funding Name', key: 'name' },
              { header: t('funds.fundType', lang) || 'Type', key: 'type' },
              { header: t('funds.handlingOfficer', lang) || 'Officer', key: 'handlingOfficer' },
              { header: `${t('funds.currentBalance', lang) || 'Balance'} (BDT)`, key: 'balance', format: (f: any) => f.balance.toLocaleString() },
              { header: t('funds.description', lang) || 'Description', key: 'description' }
            ]}
            fileName={`funds_${new Date().toISOString().split('T')[0]}`}
            title="Liquidity Funds Report"
            lang={lang}
            targetId="funds-snapshot-target"
          />
          <PermissionGuard screen={AppScreen.FUNDS_MANAGEMENT} requiredLevel={AccessLevel.WRITE}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsTransferModalOpen(true)}
                className="bg-brand/10 text-brand px-8 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:bg-brand hover:text-dark transition-all shadow-xl shadow-brand/5 border border-brand/20 active:scale-95"
              >
                <ArrowRightLeft size={20} strokeWidth={3} /> {t('funds.transfer', lang) || 'Transfer Funds'}
              </button>
              <button onClick={handleOpenModal} className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20 active:scale-95">
                <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
              </button>
            </div>
          </PermissionGuard>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {activeFunds.map(fund => (
          <div key={fund.id} className="group relative bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] border border-gray-100 dark:border-white/5 hover:border-brand/30 transition-all card-shadow overflow-hidden flex flex-col min-h-[480px]">
            {/* Header: Fund Icon & Status */}
            <div className="flex items-start justify-between mb-8">
              <div className="flex items-center gap-5">
                <div className={`p-5 rounded-3xl ${fund.type === 'PROJECT' ? 'bg-purple-500/10 text-purple-500' : fund.type === 'Primary' ? 'bg-brand/10 text-brand' : fund.type === 'Reserve' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500 shadow-inner'}`}>
                  {fund.type === 'PROJECT' ? <FolderOpen size={28} strokeWidth={2.5} /> : <Database size={28} strokeWidth={2.5} />}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-3 py-1 bg-gray-50 dark:bg-white/5 rounded-lg text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                      {fund.type === 'Primary' ? 'COLLECTION' : fund.type}
                    </span>
                    {fund.isSystemAsset && (
                      <span className="flex items-center gap-1.5 px-3 py-1 bg-brand text-dark rounded-lg text-[9px] font-black uppercase tracking-widest">
                        <DollarSign size={10} strokeWidth={4} /> Core Asset
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">
                    AC: <span className="text-dark dark:text-white">{fund.accountNumber || 'UNASSIGNED'}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                {fund.reconciliationStatus === 'VERIFIED' ? (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full text-[9px] font-black tracking-widest shadow-sm">
                    <ShieldCheck size={12} strokeWidth={3} /> VERIFIED
                  </div>
                ) : fund.reconciliationStatus === 'DISCREPANCY' ? (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-full text-[9px] font-black tracking-widest shadow-sm">
                    <AlertCircle size={12} strokeWidth={3} /> AUDIT REQ
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-500/10 text-gray-500 border border-gray-500/20 rounded-full text-[9px] font-black tracking-widest shadow-sm">
                    <Clock size={12} strokeWidth={3} /> PENDING
                  </div>
                )}
              </div>
            </div>

            {/* Content: Title & Description */}
            <div className="mb-8 flex-1">
              <h3 className="text-3xl font-black text-dark dark:text-white leading-none mb-4 tracking-tighter uppercase whitespace-normal break-words underline decoration-brand/30 decoration-4 underline-offset-8 decoration-dashed">
                {fund.name}
              </h3>
              <p className="text-sm font-bold text-gray-400 leading-relaxed italic line-clamp-3">
                {fund.description || "System established capital pool with no dedicated memorandum."}
              </p>
            </div>

            {/* Officer & Metadata */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="p-5 bg-gray-50 dark:bg-white/5 rounded-3xl border border-gray-100 dark:border-white/5 group-hover:bg-brand/5 transition-colors">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <UserCheck size={10} /> Custodian
                </p>
                <p className="text-xs font-black text-dark dark:text-white uppercase truncate">{fund.handlingOfficer || 'Global System'}</p>
              </div>
              <div className="p-5 bg-gray-50 dark:bg-white/5 rounded-3xl border border-gray-100 dark:border-white/5 group-hover:bg-brand/5 transition-colors">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Clock size={10} /> Last Audit
                </p>
                <p className="text-xs font-black text-dark dark:text-white uppercase truncate">
                  {fund.lastReconciledAt ? new Date(fund.lastReconciledAt).toLocaleDateString() : 'NEVER'}
                </p>
              </div>
            </div>

            {/* Footer: Balance & Actions */}
            <div className="pt-8 border-t border-gray-50 dark:border-white/5 mt-auto">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 leading-none">Net Reserve Value</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-dark dark:text-white tracking-tighter leading-none">
                      {formatCurrency(fund.balance)}
                    </span>
                    <span className="text-[10px] font-black text-brand uppercase tracking-widest">BDT</span>
                  </div>
                </div>

                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === fund.id ? null : fund.id);
                    }}
                    className={`p-3 rounded-2xl transition-all shadow-sm ${openMenuId === fund.id ? 'bg-brand text-dark' : 'bg-gray-100 dark:bg-white/5 text-dark dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'}`}
                  >
                    <MoreVertical size={20} strokeWidth={3} />
                  </button>

                  {openMenuId === fund.id && (
                    <div
                      className="absolute bottom-full right-0 mb-4 w-56 bg-white dark:bg-[#1A221D] rounded-3xl border border-gray-100 dark:border-white/10 shadow-2xl overflow-hidden z-[100] animate-in slide-in-from-bottom-2 duration-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-3 space-y-2">
                        <button
                          onClick={() => handleEditFund(fund)}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-brand/10 text-xs font-black uppercase tracking-widest text-dark dark:text-brand transition-all"
                        >
                          <Edit2 size={14} strokeWidth={3} />
                          Edit Fund Basics
                        </button>
                        <button
                          onClick={() => {
                            handleReconcile(fund.id);
                            setOpenMenuId(null);
                          }}
                          disabled={reconcilingId === fund.id}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-brand/10 text-xs font-black uppercase tracking-widest text-dark dark:text-brand transition-all disabled:opacity-50"
                        >
                          {reconcilingId === fund.id ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} strokeWidth={3} />}
                          Audit Reconciliation
                        </button>
                        <button
                          onClick={() => setOpenMenuId(null)}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 text-xs font-black uppercase tracking-widest text-dark dark:text-gray-400 transition-all"
                        >
                          <History size={14} strokeWidth={3} />
                          Transaction History
                        </button>
                        {currentUser?.permissions[AppScreen.FUNDS_MANAGEMENT] === AccessLevel.WRITE && !fund.isSystemAsset && (
                          <>
                            <div className="h-px bg-gray-100 dark:bg-white/5 my-1" />
                            <button
                              onClick={() => {
                                handleArchive(fund);
                                setOpenMenuId(null);
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-rose-500/10 text-xs font-black uppercase tracking-widest text-rose-500 transition-all"
                            >
                              <Archive size={14} strokeWidth={3} />
                              Archive Facility
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Empty State / Placeholder */}
        {activeFunds.length === 0 && (
          <div className="col-span-full py-20 text-center">
            <div className="inline-flex p-6 bg-gray-50 dark:bg-white/5 rounded-full text-gray-300 mb-4">
              <Wallet size={48} />
            </div>
            <h3 className="text-xl font-black text-dark dark:text-white">No Active Funds</h3>
            <p className="text-gray-400 mt-2">Create a new fund to start tracking assets.</p>
          </div>
        )}
      </div>

      {/* Archived Section */}
      {archivedFunds.length > 0 && (
        <div className="mt-10 opacity-60">
          <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4">Archived Funds</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {archivedFunds.map(fund => (
              <div key={fund.id} className="bg-gray-50 dark:bg-white/5 p-6 rounded-[2rem] border border-transparent">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-500 line-through">{fund.name}</span>
                  <span className="text-xs text-gray-400">{fund.balance.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Modal */}
      <ModalForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingFundId ? "Modify Fund Basics" : t('funds.newFund', lang)}
        subtitle={editingFundId ? "Update account identifiers and custodian details" : t('funds.liquidityProv', lang)}
        onSubmit={handleCreateFund}
        submitLabel={editingFundId ? "Save Changes" : t('funds.createFund', lang)}
        maxWidth="max-w-5xl"
        loading={isSubmitting}
      >
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <FormInput
              label={t('funds.fundName', lang)}
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('funds.fundNamePlaceholder', lang)}
              required
            />

            <FormSelect
              label={t('funds.fundType', lang)}
              value={formData.type}
              onChange={e => setFormData({ ...formData, type: e.target.value })}
              options={[
                { value: "DEPOSIT", label: t('funds.typeDeposit', lang) },
                { value: "OTHER", label: t('funds.typeOther', lang) },
                { value: "Reserve", label: "Reserve Account" }
              ]}
              disabled={!!editingFundId}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {!editingFundId ? (
              <div className="space-y-2">
                <FormInput
                  label={t('funds.initialBalance', lang)}
                  type="number"
                  min="0"
                  value={formData.initialBalance}
                  onChange={e => setFormData({ ...formData, initialBalance: e.target.value })}
                  placeholder="0.00"
                />
                <p className="text-[10px] text-gray-400 pl-1 font-bold">{t('funds.openingBalanceNote', lang)}</p>
              </div>
            ) : (
              <div className="p-6 bg-gray-50 dark:bg-white/5 rounded-3xl border border-gray-100 dark:border-white/5 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Current Balance (Locked)</p>
                  <p className="text-xl font-black text-brand tracking-tighter">
                    {formatCurrency(funds.find(f => f.id === editingFundId)?.balance || 0)}
                  </p>
                </div>
                <ShieldCheck size={24} className="text-emerald-500 opacity-50" />
              </div>
            )}

            <FormInput
              label="Account Number"
              value={formData.accountNumber}
              onChange={e => setFormData({ ...formData, accountNumber: e.target.value })}
              placeholder="e.g. IB-RESERVE-001"
              required
            />
          </div>

          <FormInput
            label={t('funds.handlingOfficer', lang)}
            value={formData.handlingOfficer}
            onChange={e => setFormData({ ...formData, handlingOfficer: e.target.value })}
            placeholder={t('funds.officerPlaceholder', lang)}
            required
          />

          <FormTextarea
            label={t('funds.description', lang)}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            placeholder={t('funds.descPlaceholder', lang)}
            className="h-32 resize-none"
          />
        </div>
      </ModalForm>

      {/* Transfer Funds Modal */}
      <ModalForm
        isOpen={isTransferModalOpen}
        onClose={() => {
          setIsTransferModalOpen(false);
          setTransferData({ sourceFundId: '', targetFundId: '', amount: '', description: '' });
        }}
        title="Internal Capital Relocation"
        subtitle="Move liquidity between enterprise asset vaults"
        onSubmit={handleTransfer}
        submitLabel="Authorize Transfer"
        loading={isSubmitting}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormSelect
              label="Source Vault (Debit)"
              value={transferData.sourceFundId}
              onChange={e => setTransferData({ ...transferData, sourceFundId: e.target.value })}
              options={[
                { value: '', label: 'Select source...' },
                ...activeFunds.map(f => ({ value: f.id, label: `${f.name} (${formatCurrency(f.balance)})` }))
              ]}
              required
            />
            <FormSelect
              label="Target Vault (Credit)"
              value={transferData.targetFundId}
              onChange={e => setTransferData({ ...transferData, targetFundId: e.target.value })}
              options={[
                { value: '', label: 'Select target...' },
                ...activeFunds.map(f => ({ value: f.id, label: f.name }))
              ]}
              required
            />
          </div>

          <FormInput
            label="Magnitude (BDT)"
            type="number"
            value={transferData.amount}
            onChange={e => setTransferData({ ...transferData, amount: e.target.value })}
            placeholder="0.00"
            required
            icon={<DollarSign size={18} />}
          />

          <FormTextarea
            label="Strategic Narrative / Reason"
            value={transferData.description}
            onChange={e => setTransferData({ ...transferData, description: e.target.value })}
            placeholder="Document the reason for this internal settlement..."
            required
          />

          <div className="p-6 bg-brand/5 border border-brand/20 rounded-3xl flex gap-4">
            <AlertCircle className="text-brand shrink-0" size={20} />
            <p className="text-[10px] font-black text-brand uppercase tracking-widest leading-relaxed">
              * This operation will generate two offset ledger entries for mutual audit reconciliation and real-time liquidity adjustment.
            </p>
          </div>
        </div>
      </ModalForm>
    </div>
  );
};

export default FundsManagement;
