
import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Search, Filter, X, Calendar, User, Briefcase, CreditCard, ChevronUp, ChevronDown, Download, Layers, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Expense, Member, Project } from '../types';
import Toast, { ToastType } from './Toast';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import ExportMenu from './ExportMenu';
import { formatCurrency } from '../utils/formatters';

type SortKey = keyof Expense;

const Expenses: React.FC = () => {
  const { expenses: globalExpenses, members: globalMembers, projects: globalProjects, funds: globalFunds, addExpense, refreshTransactions } = useGlobalState();
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

  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
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



  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (processingId) return;

    try {
      setProcessingId(id);
      await financeService.deleteTransaction(id);
      showNotification('Expense record archived successfully.');
      await refreshTransactions();
    } catch (err: any) {
      showNotification(err.message || 'Failed to archive expense', 'error');
    } finally {
      setProcessingId(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const member = activeMembers.find(m => m.id === formData.memberId || m.memberId === formData.memberId);
    const project = activeProjects.find(p => p.id === formData.projectId);
    const amountVal = parseFloat(formData.amount);

    if (!amountVal || amountVal <= 0) {
      showNotification("Please enter a valid amount.", "error");
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

    try {
      await addExpense(newExpensePayload);
      showNotification(`Expense of BDT ${amountVal.toLocaleString()} recorded successfully.`);
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

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>FINANCIALS</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">EXPENSES</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">Operational Burn</h1>
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
              { header: 'Date', key: 'date', format: (e: any) => new Date(e.date).toLocaleDateString() },
              { header: 'Category', key: 'category' },
              { header: 'Reason', key: 'reason' },
              { header: 'Member', key: 'memberName' },
              { header: 'Project', key: 'projectName', format: (e: any) => e.projectName || 'N/A' },
              { header: 'Amount', key: 'amount', format: (e: any) => formatCurrency(e.amount) },
              { header: 'Source Fund', key: 'sourceFund' }
            ]}
            fileName={`expenses_${new Date().toISOString().split('T')[0]}`}
            title="Operational Expenses Report"
          />
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
          >
            <Plus size={20} strokeWidth={3} /> Record Expense
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5">
          <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">Cumulative Outflow</p>
          <div className="flex items-baseline gap-2">
            <span className="text-6xl font-black text-dark dark:text-white tracking-tighter leading-none">{formatCurrency(totalExpenses)}</span>
            <span className="text-xl font-black text-rose-500 tracking-tight">Debited</span>
          </div>
        </div>
        <div className="bg-dark dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between">
          <p className="text-[11px] font-black text-gray-300 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">Expense Count</p>
          <div className="flex items-baseline gap-2">
            <span className="text-7xl font-black text-brand tracking-tighter leading-none uppercase">{expenses.length}</span>
            <span className="text-xl font-black text-white/40 tracking-tight">Records</span>
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
              placeholder="Search by ID, Category, Member or Reason..."
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
                  <div className="flex items-center gap-2">EXP REF <SortIcon column="id" /></div>
                </th>
                <th onClick={() => handleSort('date')} className="cursor-pointer group px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                  <div className="flex items-center gap-2">DATE <SortIcon column="date" /></div>
                </th>
                <th onClick={() => handleSort('category')} className="cursor-pointer group px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                  <div className="flex items-center gap-2">CATEGORY <SortIcon column="category" /></div>
                </th>
                <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">REASON & ENTITY</th>
                <th onClick={() => handleSort('amount')} className="cursor-pointer group px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">AMOUNT <SortIcon column="amount" /></div>
                </th>
                <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                  ACTIONS
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
                      {exp.category}
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
                    <button
                      onClick={(e) => handleDelete(e, exp.id)}
                      disabled={!!processingId}
                      className={`p-2 rounded-xl border transition-all ${processingId === exp.id
                        ? 'bg-red-50 border-red-100 cursor-wait'
                        : 'bg-transparent border-transparent text-gray-300 hover:text-red-500 hover:bg-red-50 hover:border-red-100'
                        }`}
                      title="Archive Expense"
                    >
                      {processingId === exp.id ? <Loader2 size={16} className="animate-spin text-red-500" /> : <Trash2 size={16} />}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredAndSortedExpenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-10 py-20 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                    No expense records found in this category
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-dark/90 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white dark:bg-[#1A221D] w-full max-w-2xl rounded-[4rem] card-shadow overflow-hidden relative animate-in zoom-in-95 duration-300 border border-gray-100 dark:border-white/10">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-10 right-10 p-4 text-gray-500 hover:text-dark dark:hover:text-white rounded-2xl transition-all">
              <X size={28} strokeWidth={3} />
            </button>
            <div className="p-14">
              <div className="mb-10">
                <h3 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-3">Record Outflow</h3>
                <p className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.4em]">Strategic Expense Allocation</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Expense By</label>
                    <select required value={formData.memberId} onChange={e => setFormData({ ...formData, memberId: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-6 py-4 rounded-3xl border-none ring-1 ring-gray-100 dark:ring-white/10 outline-none text-sm font-bold text-dark dark:text-white cursor-pointer">
                      <option value="">Select Member</option>
                      {activeMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Project (Optional)</label>
                    <select value={formData.projectId} onChange={e => setFormData({ ...formData, projectId: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-6 py-4 rounded-3xl border-none ring-1 ring-gray-100 dark:ring-white/10 outline-none text-sm font-bold text-dark dark:text-white cursor-pointer">
                      <option value="">N/A (General)</option>
                      {activeProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Amount (BDT)</label>
                    <input required type="number" value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} placeholder="0.00" className="w-full bg-gray-50 dark:bg-[#111814] px-6 py-4 rounded-3xl border-none ring-1 ring-gray-100 dark:ring-white/10 outline-none text-sm font-bold text-dark dark:text-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Category</label>
                    <select required value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-6 py-4 rounded-3xl border-none ring-1 ring-gray-100 dark:ring-white/10 outline-none text-sm font-bold text-dark dark:text-white cursor-pointer">
                      {['Operational', 'Marketing', 'Legal', 'Travel', 'Technology', 'Maintenance'].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Reason / Description</label>
                  <textarea required value={formData.reason} onChange={e => setFormData({ ...formData, reason: e.target.value })} placeholder="Provide detailed justification for the expense..." className="w-full bg-gray-50 dark:bg-[#111814] px-6 py-4 rounded-3xl border-none ring-1 ring-gray-100 dark:ring-white/10 outline-none text-sm font-bold text-dark dark:text-white h-24 resize-none" />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Expense Date</label>
                    <div className="relative">
                      <input required type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-6 py-4 rounded-3xl border-none ring-1 ring-gray-100 dark:ring-white/10 outline-none text-sm font-bold text-dark dark:text-white" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest px-1">Deduct From Fund</label>
                    <select required value={formData.sourceFundId} onChange={e => setFormData({ ...formData, sourceFundId: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-6 py-4 rounded-3xl border-none ring-1 ring-gray-100 dark:ring-white/10 outline-none text-sm font-bold text-dark dark:text-white cursor-pointer">
                      {globalFunds.map(fund => <option key={fund.id} value={fund.id}>{fund.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="pt-8 flex items-center justify-between gap-10 border-t border-gray-100 dark:border-white/10">
                  <div className="flex-1">
                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Fund Impact</p>
                    <p className="text-3xl font-black text-rose-500 tracking-tighter leading-none">
                      - {(parseFloat(formData.amount || '0')).toLocaleString()} <span className="text-sm opacity-40">BDT</span>
                    </p>
                  </div>
                  <button type="submit" className="bg-dark dark:bg-brand text-white dark:text-dark px-14 py-6 rounded-[2.5rem] font-black text-sm uppercase hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-brand/20">
                    Post Expense
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

export default Expenses;
