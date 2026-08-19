import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Edit2, Archive, DollarSign, TrendingUp, TrendingDown, Wallet, RefreshCw, FolderOpen, ArrowRightLeft, ShieldCheck, AlertCircle, Database, UserCheck, History, ExternalLink, Activity, Clock, MoreVertical, Search, Filter } from 'lucide-react';
import { Fund, Member, AccessLevel, AppScreen } from '../types';
import Toast, { ToastType } from './Toast';
import { useGlobalState } from '../context/GlobalStateContext';
import { Language, t } from '../i18n/translations';
import { formatCurrency } from '../utils/formatters';
import ExportMenu from './ExportMenu';
import { FormInput, FormSelect, FormTextarea, FormLabel } from './ui/FormElements';
import { InlineTopForm } from './ui/InlineTopForm';
import PermissionGuard from './PermissionGuard';
import { usePermission } from '../hooks/usePermission';
import { FundCardSkeleton } from './ui/Skeleton';
import SummaryMetricCard from './SummaryMetricCard';
import SearchBar from './SearchBar';

interface FundsManagementProps {
  lang: Language;
}

const FundsManagement: React.FC<FundsManagementProps> = ({ lang }) => {
  const { funds, addFund, updateFund, refreshFunds, currentUser, transferFunds, reconcileFund, currencyCode } = useGlobalState();
  const canWrite = usePermission(AppScreen.FUNDS_MANAGEMENT, AccessLevel.WRITE);
  const [refreshing, setRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');

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

  const activeFunds = useMemo(() => funds.filter(f => f.status === 'ACTIVE'), [funds]);
  const archivedFunds = useMemo(() => funds.filter(f => f.status === 'ARCHIVED'), [funds]);

  const totalLiquidity = useMemo(() => {
    return activeFunds.reduce((sum, f) => sum + (parseFloat(String(f.balance || 0)) || 0), 0);
  }, [activeFunds]);

  const collectionBalance = useMemo(() => {
    return activeFunds
      .filter(f => f.type === 'Primary' || f.type === 'DEPOSIT')
      .reduce((sum, f) => sum + (parseFloat(String(f.balance || 0)) || 0), 0);
  }, [activeFunds]);

  const reserveBalance = useMemo(() => {
    return activeFunds
      .filter(f => f.type === 'Reserve')
      .reduce((sum, f) => sum + (parseFloat(String(f.balance || 0)) || 0), 0);
  }, [activeFunds]);

  // Filtered funds list based on search and type filter
  const filteredFunds = useMemo(() => {
    return activeFunds.filter(f => {
      const matchesSearch = !searchQuery ||
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (f.accountNumber && f.accountNumber.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (f.handlingOfficer && f.handlingOfficer.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (f.description && f.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesType = typeFilter === 'ALL' ||
        (typeFilter === 'COLLECTION' && (f.type === 'Primary' || f.type === 'DEPOSIT')) ||
        (typeFilter === 'PROJECT' && f.type === 'PROJECT') ||
        (typeFilter === 'RESERVE' && f.type === 'Reserve') ||
        (typeFilter === 'OTHER' && f.type === 'OTHER');

      return matchesSearch && matchesType;
    });
  }, [activeFunds, searchQuery, typeFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshFunds();
    setTimeout(() => setRefreshing(false), 500);
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false, message: '', type: 'success'
  });

  const [formData, setFormData] = useState({
    name: '',
    type: 'OTHER',
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
      initialBalance: '',
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
        const payload: any = {
          name: formData.name,
          type: formData.type,
          description: formData.description,
          status: 'ACTIVE',
          balance: 0,
          currency: currencyCode,
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
        showNotification(`Discrepancy detected in ${result.fund}: Expected ${result.calculatedBalance}, Found ${result.actualBalance}`, 'error');
      }
    } catch (err: any) {
      showNotification("Reconciliation failed", 'error');
    } finally {
      setReconcilingId(null);
    }
  };

  return (
    <div className="compact-screen space-y-8 animate-in fade-in duration-500">
      <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isVisible: false })} />

      {/* HEADER SECTION */}
      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.strategy', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.fundsMgmt', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.fundsMgmt', lang)}</h1>
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
              { header: t('funds.fundName', lang) || 'Fund Name', key: 'name', format: (f: any) => f.name || 'N/A' },
              { header: t('funds.fundType', lang) || 'Fund Type', key: 'type', format: (f: any) => f.type || 'General' },
              { header: t('funds.handlingOfficer', lang) || 'Handling Officer', key: 'handlingOfficer', format: (f: any) => f.handlingOfficer || 'System' },
              { header: `${t('funds.currentBalance', lang) || 'Current Balance'} (${currencyCode})`, key: 'balance', format: (f: any) => Number(f.balance || 0).toLocaleString() },
              { header: 'Account Number', key: 'accountNumber', format: (f: any) => f.accountNumber || 'N/A' },
              { header: t('funds.description', lang) || 'Description', key: 'description', format: (f: any) => f.description || 'N/A' }
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
                className="bg-white dark:bg-white/5 text-dark dark:text-white border border-gray-100 dark:border-white/10 px-8 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/10 transition-all shadow-xl active:scale-95"
              >
                <ArrowRightLeft size={20} strokeWidth={3} /> {t('funds.transfer', lang) || 'Transfer Funds'}
              </button>
              <button
                onClick={handleOpenModal}
                className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20 active:scale-95"
              >
                <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
              </button>
            </div>
          </PermissionGuard>
        </div>
      </div>

      {/* TOP SUMMARY METRICS ROW */}
      <div id="funds-snapshot-target" className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <SummaryMetricCard
            label="Total Available Liquidity"
            value={formatCurrency(totalLiquidity, true, currencyCode)}
            note={`${activeFunds.length} Accounts`}
            variant="dark"
          />
          <SummaryMetricCard
            label="Active Capital Accounts"
            value={activeFunds.length}
            note="Operational Facilities"
          />
          <SummaryMetricCard
            label="Collection Reserve Pool"
            value={formatCurrency(collectionBalance, true, currencyCode)}
            note="Member Capital"
          />
          <SummaryMetricCard
            label="Dedicated Reserve Vault"
            value={formatCurrency(reserveBalance, true, currencyCode)}
            note="Emergency Reserves"
          />
        </div>

        {/* SEARCH & FILTER BAR + CARD GRID CONTAINER */}
        <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5 transition-colors duration-300">
          <div className="px-8 py-6 border-b border-gray-50 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 max-w-xl w-full">
              <SearchBar
                onSearch={(q) => setSearchQuery(q)}
                placeholder="Search funds by name, account number, or custodian..."
              />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="flex items-center gap-2 p-1 bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/5 text-xs font-bold">
                {[
                  { key: 'ALL', label: 'All Funds' },
                  { key: 'COLLECTION', label: 'Collection' },
                  { key: 'RESERVE', label: 'Reserve' },
                  { key: 'PROJECT', label: 'Projects' }
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setTypeFilter(tab.key)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                      typeFilter === tab.key
                        ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-md'
                        : 'text-gray-500 hover:text-dark dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {refreshing || (funds.length === 0 && activeFunds.length === 0) ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <FundCardSkeleton key={`fund-skel-${i}`} />
                ))
              ) : filteredFunds.length === 0 ? (
                <div className="col-span-full h-64 flex flex-col items-center justify-center text-center p-8 bg-gray-50/50 dark:bg-white/5 border border-dashed border-gray-200 dark:border-white/10 rounded-2xl">
                  <Database size={36} className="text-gray-400 mb-2 opacity-50" />
                  <h3 className="text-sm font-bold text-gray-500">No matching funds found</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Try adjusting your search criteria or filter tags</p>
                </div>
              ) : (
                filteredFunds.map(fund => (
                  <div key={fund.id} className="group relative bg-gray-50/70 dark:bg-[#141B16] p-5 rounded-2xl border border-gray-200/80 dark:border-white/5 hover:border-brand/40 transition-all shadow-sm hover:shadow-md flex flex-col justify-between">
                    {/* Top Row: Icon, Category Badge & Status */}
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${fund.type === 'PROJECT' ? 'bg-purple-500/10 text-purple-500' : fund.type === 'Primary' || fund.type === 'DEPOSIT' ? 'bg-brand/10 text-brand' : fund.type === 'Reserve' ? 'bg-amber-500/10 text-amber-500' : 'bg-blue-500/10 text-blue-500'}`}>
                            {fund.type === 'PROJECT' ? <FolderOpen size={16} strokeWidth={2.5} /> : <Database size={16} strokeWidth={2.5} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="inline-block px-2 py-0.5 bg-white dark:bg-white/5 rounded text-[8px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 border border-gray-100 dark:border-white/5">
                              {fund.type === 'Primary' ? 'COLLECTION' : fund.type}
                            </span>
                            {fund.isSystemAsset && (
                              <span className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 bg-brand text-dark rounded text-[8px] font-black uppercase tracking-wider">
                                <DollarSign size={8} strokeWidth={4} /> Core
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0">
                          {fund.reconciliationStatus === 'VERIFIED' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full text-[8px] font-bold tracking-wider">
                              <ShieldCheck size={9} strokeWidth={3} /> VERIFIED
                            </span>
                          ) : fund.reconciliationStatus === 'DISCREPANCY' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-full text-[8px] font-bold tracking-wider">
                              <AlertCircle size={9} strokeWidth={3} /> AUDIT REQ
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-500/10 text-gray-500 dark:text-gray-400 border border-gray-500/20 rounded-full text-[8px] font-bold tracking-wider">
                              <Clock size={9} strokeWidth={3} /> PENDING
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Title & Description */}
                      <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug truncate" title={fund.name}>
                        {fund.name}
                      </h3>
                      <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                        AC: {fund.accountNumber || 'UNASSIGNED'}
                      </p>

                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug line-clamp-2 my-2.5 min-h-[32px]">
                        {fund.description || "Capital pool established for institutional liquidity."}
                      </p>

                      {/* Custodian & Audit Badges */}
                      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 py-1.5 px-2.5 bg-white/60 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5 mb-3">
                        <span className="flex items-center gap-1 truncate max-w-[55%]">
                          <UserCheck size={11} className="text-slate-400 shrink-0" />
                          <span className="truncate">{fund.handlingOfficer || 'System'}</span>
                        </span>
                        <span className="flex items-center gap-1 shrink-0 text-[9px] text-slate-400">
                          <Clock size={10} className="shrink-0" />
                          <span>{fund.lastReconciledAt ? new Date(fund.lastReconciledAt).toLocaleDateString() : 'Unchecked'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Footer: Balance & 3-Dot Action Menu */}
                    <div className="pt-3 border-t border-gray-200/60 dark:border-white/5 flex items-end justify-between">
                      <div>
                        <p className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider leading-none mb-1">Current Balance</p>
                        <p className="text-lg font-black text-slate-900 dark:text-white font-mono tracking-tight leading-none">
                          {formatCurrency(parseFloat(String(fund.balance || 0)) || 0, true, currencyCode)}
                        </p>
                      </div>

                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(openMenuId === fund.id ? null : fund.id);
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${openMenuId === fund.id ? 'bg-brand text-dark' : 'text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'}`}
                          aria-label="Fund options"
                        >
                          <MoreVertical size={16} />
                        </button>

                        {openMenuId === fund.id && (
                          <div
                            className="absolute bottom-full right-0 mb-2 w-48 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-xl overflow-hidden z-[100] animate-in fade-in duration-150"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="p-1.5 space-y-0.5 text-xs">
                              {canWrite ? (
                                <>
                                  <button
                                    onClick={() => handleEditFund(fund)}
                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition-colors text-left"
                                  >
                                    <Edit2 size={13} />
                                    <span>Edit Fund</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      handleReconcile(fund.id);
                                      setOpenMenuId(null);
                                    }}
                                    disabled={reconcilingId === fund.id}
                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition-colors text-left disabled:opacity-50"
                                  >
                                    {reconcilingId === fund.id ? <RefreshCw className="animate-spin" size={13} /> : <RefreshCw size={13} />}
                                    <span>Reconcile</span>
                                  </button>
                                  {!fund.isSystemAsset && (
                                    <>
                                      <div className="h-px bg-gray-100 dark:bg-slate-700 my-1" />
                                      <button
                                        onClick={() => {
                                          handleArchive(fund);
                                          setOpenMenuId(null);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 font-medium transition-colors text-left"
                                      >
                                        <Archive size={13} />
                                        <span>Archive</span>
                                      </button>
                                    </>
                                  )}
                                </>
                              ) : (
                                <div className="px-3 py-2 text-[10px] font-bold text-gray-400">Read-only</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Archived Section */}
        {archivedFunds.length > 0 && (
          <div className="mt-8 opacity-70">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Archived Accounts & Facilities</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {archivedFunds.map(fund => (
                <div key={fund.id} className="bg-gray-50 dark:bg-white/5 p-5 rounded-2xl border border-transparent">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-500 line-through text-sm">{fund.name}</span>
                    <span className="text-xs text-gray-400 font-mono">{(parseFloat(String(fund.balance || 0)) || 0).toLocaleString()} {currencyCode}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create Fund Top Overlay Form */}
      <InlineTopForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingFundId ? "Modify Fund Basics" : t('funds.newFund', lang)}
        subtitle={editingFundId ? "Update account identifiers and custodian details" : t('funds.liquidityProv', lang)}
        onSubmit={handleCreateFund}
        submitLabel={editingFundId ? "Save Changes" : t('funds.createFund', lang)}
        loading={isSubmitting}
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {!editingFundId ? (
              <FormInput
                label={t('funds.initialBalance', lang)}
                type="number"
                value={formData.initialBalance}
                onChange={e => setFormData({ ...formData, initialBalance: e.target.value })}
                placeholder="0.00"
              />
            ) : null}

            <FormInput
              label={t('funds.handlingOfficer', lang)}
              value={formData.handlingOfficer}
              onChange={e => setFormData({ ...formData, handlingOfficer: e.target.value })}
              placeholder="e.g. Treasury Manager"
            />
          </div>

          <FormInput
            label="Internal Account Number / Identifier"
            value={formData.accountNumber}
            onChange={e => setFormData({ ...formData, accountNumber: e.target.value })}
            placeholder="e.g. AC-POOL-990"
          />

          <FormTextarea
            label={t('funds.description', lang)}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            placeholder="Outline mandate, usage restrictions, and custodian guidelines..."
          />
        </div>
      </InlineTopForm>

      {/* Transfer Funds Top Overlay Form */}
      <InlineTopForm
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title={t('funds.transfer', lang) || "Transfer Funds"}
        subtitle="Move liquidity between approved internal accounts"
        onSubmit={handleTransfer}
        submitLabel="Execute Transfer"
        loading={isSubmitting}
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FormSelect
              label="Source Fund *"
              value={transferData.sourceFundId}
              onChange={e => setTransferData({ ...transferData, sourceFundId: e.target.value })}
              options={activeFunds.map(f => ({
                value: f.id,
                label: `${f.name} (Balance: ${(parseFloat(String(f.balance || 0)) || 0).toLocaleString()} ${currencyCode})`
              }))}
              required
            />

            <FormSelect
              label="Destination Fund *"
              value={transferData.targetFundId}
              onChange={e => setTransferData({ ...transferData, targetFundId: e.target.value })}
              options={activeFunds
                .filter(f => f.id !== transferData.sourceFundId)
                .map(f => ({
                  value: f.id,
                  label: `${f.name} (Balance: ${(parseFloat(String(f.balance || 0)) || 0).toLocaleString()} ${currencyCode})`
                }))}
              required
            />
          </div>

          <FormInput
            label={`Transfer Amount (${currencyCode}) *`}
            type="number"
            value={transferData.amount}
            onChange={e => setTransferData({ ...transferData, amount: e.target.value })}
            placeholder="0.00"
            required
            min="0.01"
            step="any"
          />

          <FormTextarea
            label="Transfer Memorandum & Authorization Reason"
            value={transferData.description}
            onChange={e => setTransferData({ ...transferData, description: e.target.value })}
            placeholder="State transfer purpose, approved ledger reference, or board resolution..."
          />
        </div>
      </InlineTopForm>
    </div>
  );
};

export default FundsManagement;
