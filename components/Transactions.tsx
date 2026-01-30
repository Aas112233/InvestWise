
import React, { useState, useMemo } from 'react';
import { Search, Filter, ArrowUpRight, ArrowDownLeft, Briefcase, CreditCard, ChevronUp, ChevronDown, Download, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Transaction } from '../types';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import Toast, { ToastType } from './Toast';
import ExportMenu from './ExportMenu';
import ActionDialog from './ActionDialog';
import { formatCurrency, formatDate } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import SearchBar from './SearchBar';
import Pagination from './Pagination';

type SortKey = keyof Transaction | 'member';
type SortOrder = 'asc' | 'desc';

interface TransactionsProps {
  lang: Language;
}

const Transactions: React.FC<TransactionsProps> = ({ lang }) => {
  const { transactions, refreshTransactions } = useGlobalState();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('All');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [paginatedTransactions, setPaginatedTransactions] = useState<{
    data: Transaction[];
    total: number;
    pages: number;
    totalInflow: number;
    totalOutflow: number;
  }>({ data: [], total: 0, pages: 0, totalInflow: 0, totalOutflow: 0 });
  const [loading, setLoading] = useState(true);

  const fetchPaginatedTransactions = async (page: number, search: string, limit: number) => {
    setLoading(true);
    try {
      const result = await financeService.getTransactions({ page, limit, search });
      setPaginatedTransactions({
        data: result.data.map((t: any) => ({ ...t, id: t._id || t.id })),
        total: result.total,
        pages: result.pages,
        totalInflow: result.totalInflow,
        totalOutflow: result.totalOutflow
      });
    } catch (err) {
      console.error('Failed to fetch paginated transactions:', err);
      showNotification(t('members.processError', lang), 'error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchPaginatedTransactions(currentPage, searchQuery, rowsPerPage);
  }, [currentPage, searchQuery, rowsPerPage]);
  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    transactionId: string;
    transactionDesc: string;
  }>({
    isOpen: false,
    transactionId: '',
    transactionDesc: ''
  });

  const txTypeKeyMap: Record<string, string> = {
    'Deposit': 'deposit',
    'Expense': 'expense',
    'Investment': 'investment',
    'Withdrawal': 'withdrawal',
    'Earning': 'earning',
    'Dividend': 'dividend',
    'Equity-Transfer': 'equityTransfer'
  };

  const txStatusKeyMap: Record<string, string> = {
    'Success': 'success',
    'Completed': 'completed',
    'Processing': 'processing',
    'Pending': 'pending',
    'Failed': 'failed'
  };

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPaginatedTransactions(currentPage, searchQuery, rowsPerPage);
    await refreshTransactions();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleDeleteClick = (id: string, description: string) => {
    setDeleteDialog({
      isOpen: true,
      transactionId: id,
      transactionDesc: description
    });
  };

  const handleDelete = async () => {
    if (processingId) return;
    const { transactionId } = deleteDialog;
    try {
      setProcessingId(transactionId);
      await financeService.deleteTransaction(transactionId);
      showNotification(t('transactions.archiveSuccess', lang));
      fetchPaginatedTransactions(currentPage, searchQuery, rowsPerPage);
      await refreshTransactions();
      setDeleteDialog({ isOpen: false, transactionId: '', transactionDesc: '' });
    } catch (error: any) {
      showNotification(error.message || 'Failed to delete transaction', 'error');
    } finally {
      setProcessingId(null);
    }
  };



  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const filteredAndSortedTransactions = useMemo(() => {
    return transactions
      .filter(tx => {
        const query = searchQuery.toLowerCase();
        const memberName = (tx as any).memberId?.name || tx.member || '';
        const matchesSearch =
          tx.id?.toLowerCase().includes(query) ||
          tx.description?.toLowerCase().includes(query) ||
          memberName.toLowerCase().includes(query) ||
          tx.type?.toLowerCase().includes(query);

        const matchesType = filterType === 'All' || tx.type === filterType;

        return matchesSearch && matchesType;
      })
      .sort((a, b) => {
        let aValue: any = a[sortKey as keyof Transaction];
        let bValue: any = b[sortKey as keyof Transaction];

        // Handle nested member name
        if (sortKey === 'member') {
          aValue = (a as any).memberId?.name || a.member || '';
          bValue = (b as any).memberId?.name || b.member || '';
        }

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortOrder === 'asc'
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }

        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
        }

        // Default date sort if date is string
        if (sortKey === 'date') {
          return sortOrder === 'asc'
            ? new Date(a.date).getTime() - new Date(b.date).getTime()
            : new Date(b.date).getTime() - new Date(a.date).getTime();
        }

        return 0;
      });
  }, [transactions, searchQuery, sortKey, sortOrder, filterType]);

  const totalInflow = transactions
    .filter(t => (t.type === 'Deposit' || t.type === 'Earning') && (t.status === 'Success' || t.status as any === 'Completed'))
    .reduce((acc, curr) => acc + curr.amount, 0);

  const totalOutflow = transactions
    .filter(t => (t.type === 'Investment' || t.type === 'Expense' || t.type === 'Withdrawal') && (t.status === 'Success' || t.status as any === 'Completed'))
    .reduce((acc, curr) => acc + curr.amount, 0);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return null;
    return sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const totals = useMemo(() => ({
    inflow: paginatedTransactions.totalInflow,
    outflow: paginatedTransactions.totalOutflow
  }), [paginatedTransactions]);

  const getTypeIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'Deposit': return <ArrowDownLeft className="text-emerald-500" size={16} />;
      case 'Earning': return <ArrowDownLeft className="text-emerald-500" size={16} />;
      case 'Withdrawal': return <ArrowUpRight className="text-amber-500" size={16} />;
      case 'Investment': return <Briefcase className="text-blue-500" size={16} />;
      case 'Expense': return <CreditCard className="text-rose-500" size={16} />;
      default: return <CreditCard className="text-gray-500" size={16} />;
    }
  };



  const exportColumns = [
    { header: 'ID', key: 'id' },
    { header: t('transactions.date', lang), key: 'date', format: (t: any) => formatDate(t.date) },
    { header: t('transactions.type', lang), key: 'type' },
    { header: t('transactions.description', lang), key: 'description' },
    { header: `${t('transactions.valuation', lang)} (BDT)`, key: 'amount', format: (t: any) => t.amount.toLocaleString() },
    { header: t('transactions.status', lang), key: 'status' },
    { header: t('analysis.partnerEntity', lang), key: 'member', format: (t: any) => (t as any).memberId?.name || t.member || 'N/A' }
  ];

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
        title={t('transactions.deleteTransaction', lang)}
        message={`${t('transactions.deleteConfirm', lang)} "${deleteDialog.transactionDesc}"?`}
        onConfirm={handleDelete}
        onClose={() => setDeleteDialog({ isOpen: false, transactionId: '', transactionDesc: '' })}
        confirmLabel={t('common.delete', lang)}
        cancelLabel={t('common.cancel', lang)}
      />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.operations', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.transactions', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.transactions', lang)}</h1>
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-all ${refreshing ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
        <ExportMenu
          data={paginatedTransactions.data}
          columns={exportColumns}
          fileName={`transactions_${new Date().toISOString().split('T')[0]}`}
          title={t('transactions.globalReport', lang)}
          lang={lang}
          targetId="ledger-snapshot-target"
        />
      </div>

      <div id="ledger-snapshot-target" className="space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5 transition-all">
            <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">{t('transactions.inflow', lang)}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-black text-dark dark:text-white tracking-tighter leading-none">BDT {totals.inflow.toLocaleString()}</span>
              <span className="text-xl font-black text-emerald-500 tracking-tight">{t('transactions.received', lang)}</span>
            </div>
          </div>
          <div className="bg-dark dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between transition-all">
            <p className="text-[11px] font-black text-gray-300 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">{t('transactions.deployed', lang)}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-black text-brand tracking-tighter leading-none uppercase">BDT {totals.outflow.toLocaleString()}</span>
              <span className="text-xl font-black text-white/40 tracking-tight">{t('transactions.investedSpent', lang)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5">
          <div className="px-10 py-8 border-b border-gray-50 dark:border-white/5 flex items-center justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-[300px]">
              <SearchBar
                onSearch={(q) => {
                  setSearchQuery(q);
                  setCurrentPage(1);
                }}
                placeholder={t('transactions.searchPlaceholder', lang)}
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="appearance-none bg-gray-50/50 dark:bg-[#111814] pl-6 pr-10 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-2 focus:ring-dark dark:focus:ring-brand text-xs font-black uppercase tracking-widest text-gray-600 dark:text-gray-400"
                >
                  <option value="All">{t('transactions.allTypes', lang)}</option>
                  <option value="Deposit">{t('common.deposit', lang)}</option>
                  <option value="Expense">{t('common.expense', lang)}</option>
                  <option value="Investment">{t('common.investment', lang)}</option>
                  <option value="Withdrawal">{t('common.withdrawal', lang)}</option>
                  <option value="Earning">{t('common.earning', lang)}</option>
                </select>
                <Filter size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50/30 dark:bg-white/5">
                  <th onClick={() => handleSort('id')} className="cursor-pointer group px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center gap-2">{t('transactions.txRef', lang)} <SortIcon column="id" /></div>
                  </th>
                  <th onClick={() => handleSort('date')} className="cursor-pointer group px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center gap-2">{t('transactions.date', lang)} <SortIcon column="date" /></div>
                  </th>
                  <th onClick={() => handleSort('type')} className="cursor-pointer group px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center gap-2">{t('transactions.type', lang)} <SortIcon column="type" /></div>
                  </th>
                  <th className="px-10 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">{t('transactions.description', lang)}</th>
                  <th onClick={() => handleSort('amount')} className="cursor-pointer group px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">{t('transactions.valuation', lang)} <SortIcon column="amount" /></div>
                  </th>
                  <th onClick={() => handleSort('status')} className="cursor-pointer group px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">{t('transactions.status', lang)} <SortIcon column="status" /></div>
                  </th>
                  <th className="px-10 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest whitespace-nowrap">
                    {t('transactions.actions', lang)}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-10 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <RefreshCw className="animate-spin text-brand" size={40} />
                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Scanning Ledger...</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedTransactions.data.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-10 py-20 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                      {t('transactions.noTransactions', lang)}
                    </td>
                  </tr>
                ) : (
                  paginatedTransactions.data.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                      <td className="px-10 py-6">
                        <span className="text-[10px] font-black text-brand uppercase tracking-tighter" title={tx.id}>#{tx.id.substring(0, 8)}...</span>
                      </td>
                      <td className="px-10 py-6">
                        <span className="text-xs font-bold text-gray-400 whitespace-nowrap">{formatDate(tx.date)}</span>
                      </td>
                      <td className="px-10 py-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-white/5">
                            {getTypeIcon(tx.type)}
                          </div>
                          <span className="text-xs font-black dark:text-white uppercase tracking-wider">{t(`common.${txTypeKeyMap[tx.type] || 'deposit'}`, lang)}</span>
                        </div>
                      </td>
                      <td className="px-10 py-6">
                        <div className="flex flex-col">
                          <p className="font-black text-dark dark:text-white text-sm leading-none mb-1">{tx.description}</p>
                          {((tx as any).memberId || tx.member) && (
                            <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
                              {t('transactions.partner', lang)} {(tx as any).memberId?.name || tx.member}
                              {((tx as any).memberId?.memberId) && (
                                <span className="ml-1 opacity-60">(#{(tx as any).memberId.memberId})</span>
                              )}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-10 py-6 text-right font-black text-dark dark:text-white text-lg tracking-tighter">
                        BDT {tx.amount.toLocaleString()}
                      </td>
                      <td className="px-10 py-6 text-right">
                        <span className={`inline-block px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${tx.status === 'Success' || tx.status as any === 'Completed' ? 'bg-emerald-500/10 text-emerald-500' :
                          tx.status === 'Processing' || tx.status as any === 'Pending' ? 'bg-amber-400/10 text-amber-500' :
                            'bg-rose-500/10 text-rose-500'
                          }`}>
                          {t(`common.${txStatusKeyMap[tx.status] || 'success'}`, lang)}
                        </span>
                      </td>
                      <td className="px-10 py-6 text-right">
                        <button
                          onClick={() => handleDeleteClick(tx.id, tx.description)}
                          disabled={!!processingId}
                          className={`p-2 rounded-xl border transition-all ${processingId === tx.id
                            ? 'bg-red-50 border-red-100 cursor-wait'
                            : 'bg-transparent border-transparent text-gray-300 hover:text-red-500 hover:bg-red-50 hover:border-red-100'
                            }`}
                          title="Archive Transaction"
                        >
                          {processingId === tx.id ? <Loader2 size={16} className="animate-spin text-red-500" /> : <Trash2 size={16} />}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-10 py-8 border-t border-gray-50 dark:border-white/5">
            <Pagination
              currentPage={currentPage}
              totalPages={paginatedTransactions.pages}
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
    </div>
  );
};

export default Transactions;
