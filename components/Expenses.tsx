
import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Search, Filter, X, Calendar, User, Briefcase, CreditCard, ChevronUp, ChevronDown, Download, Layers, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Expense, Member, Project, AccessLevel, AppScreen } from '../types';
import Toast, { ToastType } from './Toast';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import ExportMenu from './ExportMenu';
import { formatCurrency } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import ActionDialog from './ActionDialog';
import { ModalForm, FormInput, FormSelect, FormTextarea } from './ui/FormElements';

type SortKey = keyof Expense;

interface ExpensesProps {
  lang: Language;
}

const Expenses: React.FC<ExpensesProps> = ({ lang }) => {
  const { expenses: globalExpenses, members: globalMembers, projects: globalProjects, funds: globalFunds, addExpense, refreshTransactions, currentUser } = useGlobalState();
  const [expenses, setExpenses] = useState<Expense[]>([]);

  useEffect(() => {
    setExpenses(globalExpenses);
  }, [globalExpenses]);

  const activeMembers = globalMembers.filter(m => m.status === 'active');
  const activeProjects = globalProjects; // Show all projects including completed for history

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    expenseId: string;
    reason: string;
  }>({
    isOpen: false,
    expenseId: '',
    reason: ''
  });

  const [formData, setFormData] = useState({
    memberId: '',
    projectId: '',
    amount: '',
    category: 'Operational',
    reason: '',
    date: new Date().toISOString().split('T')[0],
    sourceFundId: '', // Store ID here
  });

  // Set default fund when funds load
  useEffect(() => {
    if (globalFunds.length > 0 && !formData.sourceFundId) {
      const primary = globalFunds.find(f => f.type === 'Primary') || globalFunds[0];
      setFormData(prev => ({ ...prev, sourceFundId: primary.id }));
    }
  }, [globalFunds]);

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshTransactions();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };



  const handleDeleteClick = (id: string, reason: string) => {
    setDeleteDialog({
      isOpen: true,
      expenseId: id,
      reason
    });
  };

  const handleDelete = async () => {
    if (processingId) return;
    const { expenseId } = deleteDialog;

    try {
      setProcessingId(expenseId);
      setIsSubmitting(true);
      await financeService.deleteTransaction(expenseId);
      showNotification(t('expenses.archived', lang));
      await refreshTransactions();
      setDeleteDialog({ isOpen: false, expenseId: '', reason: '' });
    } catch (err: any) {
      showNotification(err.message || t('expenses.archiveError', lang), 'error');
    } finally {
      setProcessingId(null);
      setIsSubmitting(false);
    }
  };

  const filteredAndSortedExpenses = useMemo(() => {
    return expenses
      .filter(exp => {
        const query = searchQuery.toLowerCase();
        return (
          exp.id?.toLowerCase().includes(query) ||
          exp.memberName?.toLowerCase().includes(query) ||
          exp.reason?.toLowerCase().includes(query) ||
          exp.category?.toLowerCase().includes(query) ||
          (exp.projectName && exp.projectName.toLowerCase().includes(query))
        );
      })
      .sort((a, b) => {
        const aVal = a[sortKey] || '';
        const bVal = b[sortKey] || '';
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return 0;
      });
  }, [expenses, searchQuery, sortKey, sortOrder]);

  // Auto-set and lock fund when project is selected
  useEffect(() => {
    if (formData.projectId) {
      const selectedProject = globalProjects.find(p => p.id === formData.projectId);
      if (selectedProject?.linkedFundId) {
        setFormData(prev => ({ ...prev, sourceFundId: selectedProject.linkedFundId }));
      }
    } else {
      // Revert to primary fund if no project is selected
      const primary = globalFunds.find(f => f.type === 'Primary') || globalFunds[0];
      if (primary && !formData.projectId) {
        setFormData(prev => ({ ...prev, sourceFundId: primary.id }));
      }
    }
  }, [formData.projectId, globalProjects, globalFunds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const member = activeMembers.find(m => m.id === formData.memberId || m.memberId === formData.memberId);
    const project = activeProjects.find(p => p.id === formData.projectId);
    const amountVal = parseFloat(formData.amount);

    if (!amountVal || amountVal <= 0) {
      showNotification(t('expenses.validAmount', lang), "error");
      return;
    }

    // Current State uses addExpense which calls backend
    // We construct the object expected by Context, but context mostly needs data to send to backend
    // sourceFund should be the ID
    const newExpensePayload: Expense = {
      id: '', // Backend generates
      memberId: formData.memberId,
      memberName: member?.name || 'Unknown',
      projectId: formData.projectId || undefined,
      projectName: project?.title || undefined,
      amount: amountVal,
      category: formData.category,
      reason: formData.reason,
      date: formData.date,
      sourceFund: formData.sourceFundId,
    };

    setIsSubmitting(true);
    try {
      await addExpense(newExpensePayload);
      showNotification(t('expenses.confirmSuccess', lang).replace('{amount}', amountVal.toLocaleString()));
      setIsModalOpen(false);
      // Reset form
      const primary = globalFunds.find(f => f.type === 'Primary') || globalFunds[0];
      setFormData({
        memberId: '',
        projectId: '',
        amount: '',
        category: 'Operational',
        reason: '',
        date: new Date().toISOString().split('T')[0],
        sourceFundId: primary?.id || '',
      });
    } catch (err: any) {
      // Error handled in context usually, but we ensure UI feedback
      // Notification already shown by context if error? Context sets lastError.
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalExpenses = expenses.reduce((acc, curr) => acc + curr.amount, 0);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isVisible: false })} />

      <ActionDialog
        isOpen={deleteDialog.isOpen}
        type="delete"
        title={t('expenses.deleteExpense', lang)}
        message={`${t('expenses.deleteConfirm', lang)} "${deleteDialog.reason}"?`}
        onConfirm={handleDelete}
        onClose={() => setDeleteDialog({ isOpen: false, expenseId: '', reason: '' })}
        confirmLabel={t('common.delete', lang)}
        cancelLabel={t('common.cancel', lang)}
        loading={isSubmitting}
      />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.operations', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.expenses', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.expenses', lang)}</h1>
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
            data={filteredAndSortedExpenses}
            columns={[
              { header: 'ID', key: 'id' },
              { header: t('transactions.date', lang), key: 'date', format: (e: any) => new Date(e.date).toLocaleDateString() },
              { header: t('expenses.category', lang), key: 'category' },
              { header: t('transactions.description', lang), key: 'reason' },
              { header: t('nav.members', lang), key: 'memberName' },
              { header: t('projects.project', lang), key: 'projectName', format: (e: any) => e.projectName || 'N/A' },
              { header: `${t('transactions.valuation', lang)} (BDT)`, key: 'amount', format: (e: any) => e.amount.toLocaleString() },
              { header: t('deposits.targetFund', lang), key: 'sourceFund' }
            ]}
            fileName={`expenses_${new Date().toISOString().split('T')[0]}`}
            title={t('expenses.reportTitle', lang)}
            lang={lang}
            targetId="expenses-snapshot-target"
          />
          {currentUser?.permissions[AppScreen.EXPENSES] === AccessLevel.WRITE && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
            >
              <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
            </button>
          )}
        </div>
      </div>

      <div id="expenses-snapshot-target" className="space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-[#1A221D] p-8 lg:p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5">
            <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">{t('expenses.cumulativeOutflow', lang)}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`font-black text-dark dark:text-white tracking-tighter leading-none ${formatCurrency(totalExpenses).length > 12 ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'}`}>{formatCurrency(totalExpenses)}</span>
              <span className="text-xl font-black text-rose-500 tracking-tight">{t('expenses.debited', lang)}</span>
            </div>
          </div>
          <div className="bg-dark dark:bg-[#1A221D] p-8 lg:p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between">
            <p className="text-[11px] font-black text-gray-300 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">{t('expenses.expenseCount', lang)}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-4xl sm:text-5xl font-black text-brand tracking-tighter leading-none uppercase">{expenses.length}</span>
              <span className="text-xl font-black text-white/40 tracking-tight">{t('deposits.records', lang)}</span>
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
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('expenses.searchPlaceholder', lang)}
                className="w-full bg-gray-50/50 dark:bg-[#111814] pl-14 pr-6 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-2 focus:ring-dark dark:focus:ring-brand text-sm font-bold transition-all text-dark dark:text-white"
              />
            </div>
            <button className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white transition-colors">
              <Filter size={20} />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50/30 dark:bg-white/5">
                  <th onClick={() => handleSort('id')} className="cursor-pointer group px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center gap-2">{t('expenses.expRef', lang)} <SortIcon column="id" /></div>
                  </th>
                  <th onClick={() => handleSort('date')} className="cursor-pointer group px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center gap-2">{t('transactions.date', lang)} <SortIcon column="date" /></div>
                  </th>
                  <th onClick={() => handleSort('category')} className="cursor-pointer group px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center gap-2">{t('expenses.category', lang)} <SortIcon column="category" /></div>
                  </th>
                  <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">{t('expenses.reasonEntity', lang)}</th>
                  <th onClick={() => handleSort('amount')} className="cursor-pointer group px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">{t('transactions.valuation', lang)} <SortIcon column="amount" /></div>
                  </th>
                  <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    {t('transactions.actions', lang)}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {filteredAndSortedExpenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                    <td className="px-10 py-6">
                      <span className="text-[10px] font-black text-brand uppercase tracking-tighter">#{exp.id.substring(0, 8)}...</span>
                    </td>
                    <td className="px-10 py-6">
                      <span className="text-xs font-bold text-gray-400">{new Date(exp.date).toLocaleDateString()}</span>
                    </td>
                    <td className="px-10 py-6">
                      <span className="inline-block px-3 py-1 rounded-lg bg-gray-50 dark:bg-white/5 text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 border border-gray-100 dark:border-white/5">
                        {t(`expenses.categories.${(exp.category || 'operational').toLowerCase()}`, lang)}
                      </span>
                    </td>
                    <td className="px-10 py-6">
                      <div className="flex flex-col">
                        <p className="font-black text-dark dark:text-white text-sm leading-none mb-1">{exp.reason}</p>
                        <div className="flex items-center gap-2">
                          {exp.memberName && (
                            <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-1">
                              <User size={10} className="text-brand" /> {exp.memberName}
                            </p>
                          )}
                          {exp.projectName && (
                            <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                              <Briefcase size={10} /> {exp.projectName}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-10 py-6 text-right font-black text-dark dark:text-white text-lg tracking-tighter">
                      BDT {exp.amount.toLocaleString()}
                    </td>
                    <td className="px-10 py-6 text-right">
                      {currentUser?.permissions[AppScreen.EXPENSES] === AccessLevel.WRITE && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteClick(exp.id, exp.reason);
                          }}
                          disabled={!!processingId}
                          className={`p-2 rounded-xl border transition-all ${processingId === exp.id
                            ? 'bg-red-50 border-red-100 cursor-wait'
                            : 'bg-transparent border-transparent text-gray-300 hover:text-red-500 hover:bg-red-50 hover:border-red-100'
                            }`}
                          title="Archive Expense"
                        >
                          {processingId === exp.id ? <Loader2 size={16} className="animate-spin text-red-500" /> : <Trash2 size={16} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredAndSortedExpenses.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-10 py-20 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                      {t('expenses.noExpenses', lang)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ModalForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('expenses.recordOutflow', lang)}
        subtitle={t('expenses.strategicAllocation', lang)}
        onSubmit={handleSubmit}
        submitLabel={t('expenses.postExpense', lang)}
        maxWidth="max-w-5xl"
        loading={isSubmitting}
      >
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <FormSelect
              label={t('expenses.expenseBy', lang)}
              value={formData.memberId}
              onChange={e => setFormData({ ...formData, memberId: e.target.value })}
              options={activeMembers.map(m => ({ value: m.id, label: m.name }))}
              placeholder={t('expenses.selectMember', lang)}
              required
            />
            <FormSelect
              label={t('expenses.projectOptional', lang)}
              value={formData.projectId}
              onChange={e => setFormData({ ...formData, projectId: e.target.value })}
              options={activeProjects.map(p => ({ value: p.id, label: p.title }))}
              placeholder={t('expenses.general', lang)}
            />
            <FormSelect
              label={t('expenses.category', lang)}
              value={formData.category}
              onChange={e => setFormData({ ...formData, category: e.target.value })}
              options={['Operational', 'Marketing', 'Legal', 'Travel', 'Technology', 'Maintenance'].map(cat => ({
                value: cat,
                label: t(`expenses.categories.${cat.toLowerCase()}`, lang)
              }))}
              required
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <FormInput
              label={t('deposits.amountBDT', lang)}
              type="number"
              value={formData.amount}
              onChange={e => setFormData({ ...formData, amount: e.target.value })}
              placeholder="0.00"
              required
            />
            <FormInput
              label={t('expenses.expenseDate', lang)}
              type="date"
              value={formData.date}
              onChange={e => setFormData({ ...formData, date: e.target.value })}
              required
            />
            <FormSelect
              label={t('expenses.deductFromFund', lang)}
              value={formData.sourceFundId}
              onChange={e => setFormData({ ...formData, sourceFundId: e.target.value })}
              options={globalFunds
                .filter(fund => formData.projectId ? true : fund.type !== 'PROJECT')
                .map(fund => ({ value: fund.id, label: fund.name }))}
              required
              disabled={!!formData.projectId}
            />
          </div>

          <FormTextarea
            label={t('expenses.reasonDescription', lang)}
            value={formData.reason}
            onChange={e => setFormData({ ...formData, reason: e.target.value })}
            placeholder={t('expenses.justification', lang)}
            required
            className="h-24 resize-none"
          />

          <div className="pt-6 flex items-center justify-between border-t border-gray-100 dark:border-white/10 mt-2">
            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">{t('expenses.fundImpact', lang)}</p>
              <p className="text-3xl font-black text-rose-500 tracking-tighter leading-none">
                - {(parseFloat(formData.amount || '0')).toLocaleString()} <span className="text-sm opacity-40">BDT</span>
              </p>
            </div>
          </div>
        </div>
      </ModalForm>
    </div>
  );
};

export default Expenses;
