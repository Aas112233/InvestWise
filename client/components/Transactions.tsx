import React, { useState, useMemo, useEffect } from 'react';
import { Search, Filter, ArrowUpRight, ArrowDownLeft, Briefcase, CreditCard, Download, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Transaction } from '../types';
import { Table, TableColumn } from './ui/Table';
import { useGlobalState } from '../context/GlobalStateContext';
import { financeService } from '../services/api';
import Toast, { ToastType } from './Toast';
import ExportMenu from './ExportMenu';
import ActionDialog from './ActionDialog';
import { formatCurrency, formatDate } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import SearchBar from './SearchBar';
import Pagination from './Pagination';
import SummaryMetricCard from './SummaryMetricCard';

interface TransactionsProps {
  lang: Language;
}

const Transactions: React.FC<TransactionsProps> = ({ lang }) => {
  const { transactions, refreshTransactions, currencyCode } = useGlobalState();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('All');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [paginatedData, setPaginatedData] = useState<{
    data: Transaction[];
    total: number;
    pages: number;
    totalInflow: number;
    totalOutflow: number;
    meta?: any;
  }>({ data: [], total: 0, pages: 0, totalInflow: 0, totalOutflow: 0 });
  const [loading, setLoading] = useState(true);

  const fetchPaginatedTransactions = async (page: number, limit: number, search: string, sort: string, order: 'asc' | 'desc', type: string) => {
    setLoading(true);
    try {
      const params: any = {
        page,
        limit,
        search,
        sortBy: sort,
        sortOrder: order
      };

      if (type !== 'All') {
        params.type = type;
      }

      const result = await financeService.getTransactions(params);
      setPaginatedData({
        data: result.data.map((t: any) => ({ ...t, id: t._id || t.id })),
        total: result.total,
        pages: result.pages,
        totalInflow: result.totalInflow,
        totalOutflow: result.totalOutflow,
        meta: result.meta
      });
    } catch (err) {
      console.error('Failed to fetch paginated transactions:', err);
      showNotification(t('members.processError', lang), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPaginatedTransactions(currentPage, rowsPerPage, searchQuery, sortBy, sortOrder, filterType);
  }, [currentPage, rowsPerPage, searchQuery, sortBy, sortOrder, filterType, transactions]);

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
    await refreshTransactions();
    await fetchPaginatedTransactions(currentPage, rowsPerPage, searchQuery, sortBy, sortOrder, filterType);
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
      fetchPaginatedTransactions(currentPage, rowsPerPage, searchQuery, sortBy, sortOrder, filterType);
      await refreshTransactions();
      setDeleteDialog({ isOpen: false, transactionId: '', transactionDesc: '' });
    } catch (error: any) {
      showNotification(error.message || 'Failed to delete transaction', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder(field === 'amount' ? 'desc' : 'asc');
    }
    setCurrentPage(1);
  };

  const totals = useMemo(() => ({
    inflow: paginatedData.totalInflow,
    outflow: paginatedData.totalOutflow
  }), [paginatedData]);

  const getTypeIcon = (type: Transaction['type']) => {
    switch (type) {
      case 'Deposit': return <ArrowDownLeft className="text-emerald-500" size={14} />;
      case 'Earning': return <ArrowDownLeft className="text-emerald-500" size={14} />;
      case 'Withdrawal': return <ArrowUpRight className="text-amber-500" size={14} />;
      case 'Investment': return <Briefcase className="text-blue-500" size={14} />;
      case 'Expense': return <CreditCard className="text-rose-500" size={14} />;
      default: return <CreditCard className="text-gray-500" size={14} />;
    }
  };

  const exportColumns = [
    { header: 'ID', key: 'id' },
    { header: t('transactions.date', lang), key: 'date', format: (t: any) => formatDate(t.date) },
    { header: t('transactions.type', lang), key: 'type' },
    { header: t('transactions.description', lang), key: 'description' },
    { header: `${t('transactions.valuation', lang)} (${currencyCode})`, key: 'amount', format: (t: any) => t.amount.toLocaleString() },
    { header: t('transactions.status', lang), key: 'status' },
    { header: t('analysis.partnerEntity', lang), key: 'member', format: (t: any) => (t as any).memberId?.name || t.member || 'N/A' }
  ];

  const tableColumns: TableColumn<Transaction>[] = [
    {
      key: 'id',
      header: t('transactions.txRef', lang),
      sortable: true,
      render: (tx) => (
        <span className="font-mono text-xs text-slate-500 dark:text-blue-400" title={tx.id}>
          #{tx.id.substring(0, 8)}...
        </span>
      )
    },
    {
      key: 'date',
      header: t('transactions.date', lang),
      sortable: true,
      render: (tx) => <span className="text-xs text-slate-500 whitespace-nowrap">{formatDate(tx.date)}</span>
    },
    {
      key: 'type',
      header: t('transactions.type', lang),
      sortable: true,
      render: (tx) => (
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-gray-700">
            {getTypeIcon(tx.type)}
          </div>
          <span className="text-xs font-medium text-slate-800 dark:text-slate-200">{t(`common.${txTypeKeyMap[tx.type] || 'deposit'}`, lang)}</span>
        </div>
      )
    },
    {
      key: 'description',
      header: t('transactions.description', lang),
      render: (tx) => (
        <div className="flex flex-col">
          <p className="font-medium text-slate-900 dark:text-white text-xs leading-none mb-0.5">{tx.description}</p>
          {((tx as any).memberId || tx.member) && (
            <p className="text-[10px] text-gray-400 font-medium">
              {t('transactions.partner', lang)} {(tx as any).memberId?.name || tx.member}
              {((tx as any).memberId?.memberId) && (
                <span className="ml-1 opacity-60">(#{(tx as any).memberId.memberId})</span>
              )}
            </p>
          )}
        </div>
      )
    },
    {
      key: 'amount',
      header: t('transactions.valuation', lang),
      sortable: true,
      align: 'right',
      cellClassName: 'font-mono text-xs font-semibold text-slate-900 dark:text-white',
      render: (tx) => `${currencyCode} ${tx.amount.toLocaleString()}`
    },
    {
      key: 'balanceAfter',
      header: t('masterForm.runningBalance', lang) || 'Running Balance',
      align: 'right',
      render: (tx) => tx.balanceAfter !== undefined ? (
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
          {formatCurrency(tx.balanceAfter)}
        </span>
      ) : (
        <span className="text-[10px] text-slate-400 dark:text-slate-500">N/A</span>
      )
    },
    {
      key: 'status',
      header: t('transactions.status', lang),
      sortable: true,
      align: 'right',
      render: (tx) => {
        const isSuccess = tx.status === 'Success' || tx.status as any === 'Completed';
        const isPending = tx.status === 'Processing' || tx.status as any === 'Pending';
        return (
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${
            isSuccess ? 'bg-emerald-50 text-emerald-600 border-emerald-250 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' :
            isPending ? 'bg-amber-50 text-amber-600 border-amber-250 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30' :
            'bg-red-50 text-red-650 border-red-250 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30'
          }`}>
            {t(`common.${txStatusKeyMap[tx.status] || 'success'}`, lang)}
          </span>
        );
      }
    },
    {
      key: 'actions',
      header: t('transactions.actions', lang),
      align: 'right',
      render: (tx) => (
        <button
          onClick={() => handleDeleteClick(tx.id, tx.description)}
          disabled={!!processingId}
          className={`p-1 rounded border transition-colors ${
            processingId === tx.id
              ? 'bg-red-50 border-red-200 cursor-wait'
              : 'bg-transparent border-transparent text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 hover:border-red-200 dark:hover:border-red-900/50'
          }`}
          title="Archive Transaction"
        >
          {processingId === tx.id ? <Loader2 size={14} className="animate-spin text-red-500" /> : <Trash2 size={14} />}
        </button>
      )
    }
  ];

  return (
    <div className="space-y-4">
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

      <div className="flex items-center justify-between">
        <div>
          <nav className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider mb-1">
            <span>{t('nav.operations', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-blue-600 dark:text-blue-400">{t('nav.transactions', lang)}</span>
          </nav>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-slate-900 dark:text-white leading-tight">{t('nav.transactions', lang)}</h1>
            <button
              onClick={handleRefresh}
              className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 transition-all ${refreshing ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <ExportMenu
          data={paginatedData.data}
          columns={exportColumns}
          fileName={`transactions_${new Date().toISOString().split('T')[0]}`}
          title={t('transactions.globalReport', lang)}
          lang={lang}
          targetId="ledger-snapshot-target"
        />
      </div>

      <div id="ledger-snapshot-target" className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SummaryMetricCard
            label={t('transactions.inflow', lang)}
            value={`${currencyCode} ${totals.inflow.toLocaleString()}`}
            note={t('transactions.received', lang)}
          />
          <SummaryMetricCard
            label={t('transactions.deployed', lang)}
            value={`${currencyCode} ${totals.outflow.toLocaleString()}`}
            note={t('transactions.investedSpent', lang)}
            variant="dark"
          />
        </div>

        <div className="bg-white dark:bg-slate-900 rounded border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <SearchBar
                onSearch={(q) => {
                  setSearchQuery(q);
                  setCurrentPage(1);
                }}
                placeholder={t('transactions.searchPlaceholder', lang)}
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="appearance-none bg-white dark:bg-slate-900 pl-3 pr-8 py-1.5 rounded border border-gray-200 dark:border-gray-800 focus:border-blue-500 text-xs font-normal text-slate-700 dark:text-slate-350"
                >
                  <option value="All">{t('transactions.allTypes', lang)}</option>
                  <option value="Deposit">{t('common.deposit', lang)}</option>
                  <option value="Expense">{t('common.expense', lang)}</option>
                  <option value="Investment">{t('common.investment', lang)}</option>
                  <option value="Withdrawal">{t('common.withdrawal', lang)}</option>
                  <option value="Earning">{t('common.earning', lang)}</option>
                </select>
                <Filter size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <Table
            data={paginatedData.data}
            columns={tableColumns}
            loading={loading}
            loadingMessage="Loading transactions..."
            emptyMessage={<div className="text-gray-400 font-semibold text-xs py-4 text-center">{t('transactions.noTransactions', lang)}</div>}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            rowKey={(tx) => tx.id}
          />

          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-xs font-medium text-slate-500">
              {paginatedData.meta && (
                <>Showing {paginatedData.meta.from} to {paginatedData.meta.to} of {paginatedData.meta.total} records</>
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
        </div>
      </div>
    </div>
  );
};

export default Transactions;
