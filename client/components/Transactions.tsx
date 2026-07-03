
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

type SortKey = keyof Transaction | 'member';
type SortOrder = 'asc' | 'desc';

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

 // Removed client-side filteredAndSortedTransactions as we use server-side logic now

 const totals = useMemo(() => ({
 inflow: paginatedData.totalInflow,
 outflow: paginatedData.totalOutflow
 }), [paginatedData]);

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
 <span className="text-[10px] font-black text-brand uppercase tracking-tighter" title={tx.id}>
 #{tx.id.substring(0, 8)}...
 </span>
 )
 },
 {
 key: 'date',
 header: t('transactions.date', lang),
 sortable: true,
 render: (tx) => <span className="text-xs font-bold text-gray-400 whitespace-nowrap">{formatDate(tx.date)}</span>
 },
 {
 key: 'type',
 header: t('transactions.type', lang),
 sortable: true,
 render: (tx) => (
 <div className="flex items-center gap-3">
 <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-white/5">
 {getTypeIcon(tx.type)}
 </div>
 <span className="text-xs font-black dark:text-white uppercase tracking-wider">{t(`common.${txTypeKeyMap[tx.type] || 'deposit'}`, lang)}</span>
 </div>
 )
 },
 {
 key: 'description',
 header: t('transactions.description', lang),
 render: (tx) => (
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
 )
 },
 {
 key: 'amount',
 header: t('transactions.valuation', lang),
 sortable: true,
 align: 'right',
 cellClassName: 'font-black text-dark dark:text-white text-lg tracking-tighter',
 render: (tx) => `${currencyCode} ${tx.amount.toLocaleString()}`
 },
 {
 key: 'balanceAfter',
 header: t('masterForm.runningBalance', lang) || 'Running Balance',
 align: 'right',
 render: (tx) => tx.balanceAfter !== undefined ? (
 <span className="text-xs font-black text-gray-600 dark:text-gray-300">
 {formatCurrency(tx.balanceAfter)}
 </span>
 ) : (
 <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500">N/A</span>
 )
 },
 {
 key: 'status',
 header: t('transactions.status', lang),
 sortable: true,
 align: 'right',
 render: (tx) => (
 <span className={`inline-block px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${tx.status === 'Success' || tx.status as any === 'Completed' ? 'bg-emerald-500/10 text-emerald-500' :
 tx.status === 'Processing' || tx.status as any === 'Pending' ? 'bg-amber-400/10 text-amber-500' :
 'bg-rose-500/10 text-rose-500'
 }`}>
 {t(`common.${txStatusKeyMap[tx.status] || 'success'}`, lang)}
 </span>
 )
 },
 {
 key: 'actions',
 header: t('transactions.actions', lang),
 align: 'right',
 render: (tx) => (
 <button
 onClick={() => handleDeleteClick(tx.id, tx.description)}
 disabled={!!processingId}
 className={`p-2 rounded-xl border transition-all ${processingId === tx.id
 ? 'bg-red-50 border-red-100 cursor-wait'
 : 'bg-transparent border-transparent text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-100 dark:hover:border-red-500/20'
 }`}
 title="Archive Transaction"
 >
 {processingId === tx.id ? <Loader2 size={16} className="animate-spin text-red-500" /> : <Trash2 size={16} />}
 </button>
 )
 }
 ];

 return (
 <div className="compact-screen space-y-10 animate-in fade-in duration-500">
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
 data={paginatedData.data}
 columns={exportColumns}
 fileName={`transactions_${new Date().toISOString().split('T')[0]}`}
 title={t('transactions.globalReport', lang)}
 lang={lang}
 targetId="ledger-snapshot-target"
 />
 </div>

 <div id="ledger-snapshot-target" className="space-y-10">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <SummaryMetricCard
 label={t('transactions.inflow', lang)}
 value={`${currencyCode} ${totals.inflow.toLocaleString()}`}
 note={t('transactions.received', lang)}
 valueClassName="text-2xl sm:text-3xl"
 noteClassName="text-emerald-500 text-sm sm:text-base"
 />
 <SummaryMetricCard
 label={t('transactions.deployed', lang)}
 value={`${currencyCode} ${totals.outflow.toLocaleString()}`}
 note={t('transactions.investedSpent', lang)}
 variant="dark"
 valueClassName="text-2xl sm:text-3xl"
 />
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

 <Table
 data={paginatedData.data}
 columns={tableColumns}
 loading={loading}
 loadingMessage="Scanning Ledger..."
 emptyMessage={<div className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t('transactions.noTransactions', lang)}</div>}
 sortBy={sortBy}
 sortOrder={sortOrder}
 onSort={handleSort}
 rowKey={(tx) => tx.id}
 />

 <div className="px-10 py-8 border-t border-gray-50 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
 <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
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
