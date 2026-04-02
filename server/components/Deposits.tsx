import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Filter, X, Calendar, User, CheckSquare, Square, ChevronLeft, ChevronRight, Edit2, Trash2, Loader2, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Download, Upload } from 'lucide-react';
// Dynamically imported: import * as XLSX from 'xlsx';
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
import Pagination from './Pagination';

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
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [paginatedData, setPaginatedData] = useState<{
    total: number;
    pages: number;
    totalInflow: number;
    totalMonthly: number;
    meta?: any;
  }>({ total: 0, pages: 0, totalInflow: 0, totalMonthly: 0 });
  const [loading, setLoading] = useState(true);

  const activeMembers = globalMembers.filter(m => m.status === 'active');
  const [refreshing, setRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFixingDates, setIsFixingDates] = useState(false);

  const handleFixDates = async () => {
    if (!window.confirm("This will scan ALL deposits and correct the Transaction Date to coincide with the 1st of the month (for non-current months). This ensures analytics accuracy. Continue?")) return;

    setIsFixingDates(true);
    let count = 0;
    try {
      // Fetch all deposits to scan
      const res = await financeService.getTransactions({ limit: 10000, type: 'Deposit' });
      const all = res.data;
      const updates: (() => Promise<any>)[] = [];

      for (const t of all) {
        // Extract monthly period from description or fallback
        const descMonth = (t.description?.match(/\[(.*?)\]/) || [])[1] || t.description;

        // Only enforce for past/future months, leave current month flexible (or strict if desired, but here specific to request)
        if (descMonth && descMonth !== getCurrentMonthYear()) {
          const targetDate = getDateFromMonthStr(descMonth);
          if (targetDate) {
            const currentIso = new Date(t.date).toISOString().split('T')[0];
            // If mismatch, queue update
            if (currentIso !== targetDate) {
              updates.push(() => {
                // To avoid 400 Bad Request due to validation, we should be careful about what we send.
                // It's safer to send just the fields we want to update if the backend supports partial updates,
                // but if it's a PUT replacing the whole object, we need correct IDs.
                // The safest bet for this specific app's likely controller:
                // Strict ID extraction
                const mId = typeof t.memberId === 'object' && t.memberId ? (t.memberId._id || t.memberId.id) : t.memberId;
                const fId = typeof t.fundId === 'object' && t.fundId ? (t.fundId._id || t.fundId.id) : t.fundId;

                // Skip if critical IDs are missing (would cause 400)
                if (!mId || !fId) {
                  console.warn('Skipping sync for deposit due to missing IDs:', t);
                  return Promise.resolve();
                }

                // Construct payload - strictly matching handleSubmit logic (no status)
                const payload = {
                  memberId: mId,
                  amount: Number(t.amount),
                  fundId: fId,
                  description: t.description,
                  date: new Date(targetDate).toISOString(),
                  shareNumber: Math.floor(Number(t.amount) / SHARE_WORTH), // Backend requires this field to be a valid number
                  cashierName: t.handlingOfficer || t.cashierName || 'System',
                  depositMethod: t.depositMethod || 'Cash'
                };

                console.log('Syncing Date for:', t._id, payload);
                return financeService.editDeposit(t._id || t.id, payload);
              });
            }
          }
        }
      }

      if (updates.length > 0) {
        // Execute sequentially to prevent "Write conflict" on backend
        for (const updateFn of updates) {
          await updateFn();
        }
        count = updates.length;
        showNotification(`Successfully synchronized dates for ${count} deposits.`);
        handleRefresh();
      } else {
        showNotification("All deposit dates are already synchronized.");
      }
    } catch (e) {
      console.error(e);
      showNotification("Failed to synchronize dates", "error");
    } finally {
      setIsFixingDates(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshTransactions();
    setTimeout(() => setRefreshing(false), 500);
  };

  const fetchPaginatedDeposits = async (page: number, limit: number, search: string, field: string, sort: string, order: 'asc' | 'desc') => {
    setLoading(true);
    try {
      const response = await financeService.getTransactions({
        page,
        limit,
        search,
        searchField: field,
        sortBy: sort,
        sortOrder: order,
        type: 'Deposit'
      });

      // Map Transactions to Deposits (handling normalization for UI)
      const mapped = response.data.map((t: any) => ({
        id: t._id || t.id,
        memberId: t.memberId?.memberId || 'N/A', // Display ID
        memberMongoId: t.memberId?._id || t.memberId, // Database ID
        memberName: t.memberId?.name || 'Unknown',
        amount: t.amount,
        date: new Date(t.date).toLocaleDateString(),
        status: t.status,
        shareNumber: Math.floor(t.amount / SHARE_WORTH),
        depositMonth: (t.description?.match(/\[(.*?)\]/) || [])[1] || t.description || 'N/A',
        cashierName: t.handlingOfficer || 'System',
        fundId: t.fundId?._id || t.fundId, // ✅ Capture fund ID
        fundName: t.fundId?.name || t.fundId || 'N/A', // ✅ Capture fund Name
        depositMethod: t.depositMethod || 'Cash', // ✅ Capture Method
        createdAt: t.createdAt ? new Date(t.createdAt).toLocaleDateString() : new Date(t.date).toLocaleDateString(),
        updatedAt: t.updatedAt && t.updatedAt !== t.createdAt ? new Date(t.updatedAt).toLocaleDateString() : undefined
      }));

      setDeposits(mapped);
      setPaginatedData({
        total: response.meta.total,
        pages: response.meta.pages,
        totalInflow: response.totalInflow || 0,
        totalMonthly: response.totalMonthly || 0,
        meta: response.meta
      });
    } catch (err) {
      console.error('Failed to fetch deposits:', err);
      showNotification(t('deposits.recordError', lang), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPaginatedDeposits(currentPage, rowsPerPage, searchQuery, searchField, sortBy, sortOrder);
  }, [currentPage, rowsPerPage, searchQuery, searchField, sortBy, sortOrder, globalDeposits]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDeposit, setEditingDeposit] = useState<Deposit | null>(null);
  const [autoCalculate, setAutoCalculate] = useState(true);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const getCurrentMonthYear = () => {
    const date = new Date();
    return `${t(`common.months.${monthKeys[date.getMonth()]}`, lang)} ${date.getFullYear()}`;
  };

  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<{ memberId: string; amount: string; shareNumber: string; depositMonth: string; txnDate?: string }[]>([]);
  const [bulkFundId, setBulkFundId] = useState('');
  const [bulkDepositMethod, setBulkDepositMethod] = useState('Cash');
  const [bulkMonth, setBulkMonth] = useState(getCurrentMonthYear());
  const [isBulkMonthPickerOpen, setIsBulkMonthPickerOpen] = useState(false);

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

  const [formData, setFormData] = useState({
    memberId: '',
    memberName: '',
    shareNumber: '0',
    amount: '0',
    depositMonth: getCurrentMonthYear(),
    cashierName: 'System',
    fundId: '',
    depositMethod: 'Cash',
    txnDate: new Date().toISOString().split('T')[0]
  });

  const convertToInputDate = (dateStr: string) => {
    try {
      if (!dateStr) return new Date().toISOString().split('T')[0];
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
      return d.toISOString().split('T')[0];
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  };

  const getDateFromMonthStr = (monthStr: string) => {
    try {
      if (!monthStr) return '';
      const parts = monthStr.split(' ');
      const year = parseInt(parts[parts.length - 1]);
      const monthPart = parts.slice(0, parts.length - 1).join(' ');
      const monthIdx = monthKeys.findIndex(k => t(`common.months.${k}`, lang) === monthPart);

      if (monthIdx !== -1 && !isNaN(year)) {
        return `${year}-${(monthIdx + 1).toString().padStart(2, '0')}-01`;
      }
      return '';
    } catch {
      return '';
    }
  };

  useEffect(() => {
    if (isModalOpen) {
      const currentVal = formData.depositMonth;
      const isCurrent = currentVal === getCurrentMonthYear();

      if (!isCurrent) {
        const lockedDate = getDateFromMonthStr(currentVal);
        if (lockedDate && formData.txnDate !== lockedDate) {
          setFormData(prev => ({ ...prev, txnDate: lockedDate }));
        }
      }
    }
  }, [formData.depositMonth, isModalOpen, lang]);

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
        memberId: (deposit as any).memberMongoId || deposit.memberId,
        // This is expected to be MongoID or MemberID? 
        // Existing logic uses memberId (MEM001) for select. 
        // Check deposit object: it has memberName and memberId (display ID like MEM001 usually, looking at table: ID: #{dep.memberId}). 
        // Table shows dep.memberId.
        memberName: deposit.memberName,
        shareNumber: deposit.shareNumber.toString(),
        amount: deposit.amount.toString(),
        depositMonth: deposit.depositMonth,
        cashierName: deposit.cashierName,
        fundId: deposit.fundId || funds.find(f => (f.type === 'DEPOSIT' || f.type === 'Primary') && f.status !== 'ARCHIVED')?.id || '',
        depositMethod: deposit.depositMethod || 'Cash',
        txnDate: convertToInputDate(deposit.date)
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
        fundId: defaultFund ? defaultFund.id : '',
        depositMethod: 'Cash',
        txnDate: new Date().toISOString().split('T')[0]
      });
      setAutoCalculate(true);
    }
    setPickerYear(new Date().getFullYear());
    setIsModalOpen(true);
  };

  // ...



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
      setFormData({
        ...formData,
        amount: (sharesNum * SHARE_WORTH).toString()
      });
    }
  };

  const selectMonth = (monthName: string, index: number) => {
    const translatedMonth = t(`common.months.${monthKeys[index]}`, lang);
    const newMonthStr = `${translatedMonth} ${pickerYear}`;

    // Auto-calculate Transaction Date Lock
    let newTxnDate = new Date().toISOString().split('T')[0]; // Default to today

    // If not current month, lock to 1st of that month
    const now = new Date();
    const isCurrentMonth = index === now.getMonth() && pickerYear === now.getFullYear();

    if (!isCurrentMonth) {
      // Create date for 1st of selected month
      const d = new Date(pickerYear, index, 1);
      // Adjust for timezone offset to ensure YYYY-MM-DD matches local intent or UTC+6
      const year = d.getFullYear();
      const month = String(index + 1).padStart(2, '0');
      const day = '01';
      newTxnDate = `${year}-${month}-${day}`;
    }

    setFormData({
      ...formData,
      depositMonth: newMonthStr,
      txnDate: newTxnDate
    });
    setIsMonthPickerOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (!formData.fundId) {
        throw new Error(t('deposits.selectFundError', lang));
      }

      if (editingDeposit) {
        // Edit Mode
        const payload = {
          memberId: formData.memberId,
          amount: parseInt(formData.amount),
          fundId: formData.fundId,
          description: formData.depositMonth,
          date: new Date(formData.txnDate).toISOString(),
          // Controller expects date.
          shareNumber: Math.floor(parseInt(formData.amount) / SHARE_WORTH), // Backend requires this
          cashierName: formData.cashierName,
          depositMethod: formData.depositMethod
        };

        await financeService.editDeposit(editingDeposit.id, payload);
        showNotification(t('deposits.updateSuccess', lang) || 'Deposit updated successfully');
      } else {
        // Create Mode
        const selectedMember = activeMembers.find(m => m.id === formData.memberId);
        if (!selectedMember) throw new Error(t('deposits.invalidMember', lang));

        const payload = {
          memberId: selectedMember.id,
          amount: parseInt(formData.amount),
          fundId: formData.fundId,
          description: formData.depositMonth,
          date: new Date(formData.txnDate).toISOString(),
          shareNumber: parseInt(formData.shareNumber),
          status: 'Completed',
          cashierName: formData.cashierName,
          depositMethod: formData.depositMethod
        };

        await financeService.addDeposit(payload);
        showNotification(t('deposits.confirmSuccess', lang).replace('{amount}', parseInt(formData.amount).toLocaleString()).replace('{member}', formData.memberName));
      }

      handleCloseModal();
      fetchPaginatedDeposits(currentPage, rowsPerPage, searchQuery, searchField, sortBy, sortOrder);
      await refreshTransactions();
    } catch (err: any) {
      showNotification(err.message || t('deposits.recordError', lang), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const downloadBulkTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      // Prepare data for Excel - helpful for users to see who needs to pay
      const data = activeMembers.map(m => ({
        'Partner Name': m.name,
        'Partner ID': m.memberId,
        'Month': bulkMonth,
        'Transaction Date (YYYY-MM-DD)': new Date().toISOString().split('T')[0],
        'Shares': m.shares,
        'Deposit Amount (BDT)': m.shares * SHARE_WORTH,
        '_internal_id': m.id // Important for precise matching
      }));

      const ws = XLSX.utils.json_to_sheet(data);

      // Set column widths for better readability
      ws['!cols'] = [
        { wch: 30 }, // Name
        { wch: 15 }, // ID
        { wch: 15 }, // Month
        { wch: 15 }, // Tx Date
        { wch: 10 }, // Shares
        { wch: 20 }, // Amount
        { wch: 5 }   // Hidden internal ID
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bulk_Deposit_Template");
      XLSX.writeFile(wb, `InvestWise_Bulk_Deposit_${bulkMonth.replace(' ', '_')}.xlsx`);

      showNotification("Template downloaded. You can now edit and upload it.");
    } catch (err) {
      console.error("Template failed:", err);
      showNotification("Failed to generate template", "error");
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const normalizeMonth = (input: any) => {
          if (!input) return bulkMonth;

          // Case 1: Excel Serial Number (e.g. 45658)
          if (typeof input === 'number') {
            const date = new Date((input - 25569) * 86400 * 1000);
            if (!isNaN(date.getTime())) {
              const mIdx = date.getMonth();
              const year = date.getFullYear();
              return `${t(`common.months.${monthKeys[mIdx]}`, lang)} ${year}`;
            }
          }

          const str = input.toString().trim();

          // Case 2: Handle string formats
          // Split by typical separators
          const parts = str.split(/[- /]/);
          let mIdx = -1;
          let yPart = '';

          const shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
          const fullMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

          if (parts.length >= 2) {
            // Check first part for month
            const p0 = parts[0].toLowerCase();
            const p1 = parts[1];
            const p2 = parts[2];

            // Try to find month index in p0 or p1
            const searchPart = (p: string) => {
              const num = parseInt(p);
              if (!isNaN(num) && num >= 1 && num <= 12) return num - 1;
              const sIdx = shortMonths.findIndex(sm => p.toLowerCase().startsWith(sm));
              if (sIdx !== -1) return sIdx;
              return fullMonths.findIndex(fm => p.toLowerCase() === fm);
            };

            mIdx = searchPart(parts[0]);

            // If p0 was month, yPart is usually the last part
            if (mIdx !== -1) {
              yPart = parts[parts.length - 1];
            } else {
              // Try if p1 is the month (e.g. 01-Jan-25 or 01-01-25)
              mIdx = searchPart(parts[1]);
              yPart = parts[parts.length - 1];
            }

            // Normalize Year
            if (yPart.length === 2) yPart = '20' + yPart;

            if (mIdx !== -1 && /^\d{4}$/.test(yPart)) {
              return `${t(`common.months.${monthKeys[mIdx]}`, lang)} ${yPart}`;
            }
          }

          return str; // Fallback
        };

        const importedRows = data.map(item => {
          // Match by internal ID if present, otherwise by Partner ID
          const memberId = item['_internal_id'] || activeMembers.find(m => m.memberId === item['Partner ID'])?.id;
          if (!memberId) return null;

          const depositMonth = normalizeMonth(item['Month']);
          let txnDate = convertToInputDate(item['Transaction Date (YYYY-MM-DD)'] || item['Date'] || new Date().toISOString());

          // Enforce 1st of month lock for non-current months
          if (depositMonth !== getCurrentMonthYear()) {
            const locked = getDateFromMonthStr(depositMonth);
            if (locked) txnDate = locked;
          }

          return {
            memberId,
            amount: (item['Deposit Amount (BDT)'] || 0).toString(),
            shareNumber: (item['Shares'] || 0).toString(),
            depositMonth,
            txnDate
          };
        }).filter(Boolean) as typeof bulkRows;

        if (importedRows.length > 0) {
          setBulkRows(importedRows);
          showNotification(`Successfully imported ${importedRows.length} deposit records.`);
        } else {
          showNotification("Could not find any valid member records in the file", "error");
        }
      } catch (err) {
        console.error("Upload failed:", err);
        showNotification("Failed to parse Excel file", "error");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = ''; // Reset for same file re-upload
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (!bulkFundId) throw new Error(t('deposits.selectFundError', lang));

      const validRows = bulkRows.filter(r => r.memberId && parseInt(r.amount) > 0);
      if (validRows.length === 0) throw new Error("Please add at least one valid deposit");

      const fund = funds.find(f => f.id === bulkFundId);
      const payload = {
        fundId: bulkFundId,
        commonMonth: bulkMonth,
        cashierName: fund?.handlingOfficer || 'System',
        depositMethod: bulkDepositMethod,
        deposits: validRows.map(r => {
          // Enforce 1st of month lock for non-current months just to be safe at submission time
          let finalDate = r.txnDate;
          if (r.depositMonth !== getCurrentMonthYear()) {
            const locked = getDateFromMonthStr(r.depositMonth);
            if (locked) finalDate = locked;
          }

          return {
            memberId: r.memberId,
            amount: parseInt(r.amount),
            shareNumber: Math.floor(parseInt(r.amount) / SHARE_WORTH), // Always calculate from amount
            depositMonth: r.depositMonth,
            date: finalDate // backend expects 'date'
          };
        })
      };

      const response = await financeService.bulkAddDeposit(payload);
      showNotification(`Successfully processed ${response.count} deposits. Total: ${formatCurrency(response.totalAmount)}`);

      setIsBulkModalOpen(false);
      fetchPaginatedDeposits(currentPage, rowsPerPage, searchQuery, searchField, sortBy, sortOrder);
      await refreshTransactions();
    } catch (err: any) {
      showNotification(err.message || "Bulk processing failed", "error");
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

  const totalMonthly = paginatedData.totalMonthly;
  const totalAmount = paginatedData.totalInflow;
  const totalCount = paginatedData.total;

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
          <button
            onClick={handleFixDates}
            disabled={isFixingDates}
            className="hidden md:flex items-center gap-2 px-5 py-3 bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
          >
            {isFixingDates ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Sync Dates
          </button>
          <ExportMenu
            data={deposits}
            columns={[
              { header: 'ID', key: 'id' },
              { header: t('transactions.date', lang), key: 'date', format: (d: any) => new Date(d.date).toLocaleDateString() },
              { header: t('nav.members', lang), key: 'memberName' },
              { header: t('deposits.monthPeriod', lang), key: 'depositMonth' },
              { header: t('deposits.shares', lang), key: 'shareNumber' },
              { header: t('deposits.shares', lang), key: 'shareNumber' },
              { header: `${t('deposits.amountBDT', lang)} (BDT)`, key: 'amount', format: (d: any) => d.amount.toLocaleString() },
              { header: 'Method', key: 'depositMethod' },
              { header: t('funds.fundName', lang), key: 'fundName' },
              { header: 'Created At', key: 'createdAt' },
              { header: 'Updated At', key: 'updatedAt' },
              { header: t('transactions.status', lang), key: 'status' }
            ]}
            fileName={`deposits_${new Date().toISOString().split('T')[0]}`}
            title={t('deposits.capitalInflowReport', lang)}
            lang={lang}
            targetId="deposits-snapshot-target"
          />
          <PermissionGuard screen={AppScreen.DEPOSITS} requiredLevel={AccessLevel.WRITE}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const defaultFund = funds.find(f => (f.type === 'DEPOSIT' || f.type === 'Primary') && f.status !== 'ARCHIVED');
                  const currentMonth = getCurrentMonthYear();
                  setBulkFundId(defaultFund?.id || '');
                  setBulkDepositMethod('Cash');
                  setBulkRows([{ memberId: '', amount: '0', shareNumber: '0', depositMonth: currentMonth }]);
                  setBulkMonth(currentMonth);
                  setIsBulkModalOpen(true);
                }}
                className="bg-white dark:bg-white/5 text-dark dark:text-white border border-gray-100 dark:border-white/10 px-8 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/10 transition-all shadow-xl"
              >
                <Filter size={20} strokeWidth={3} className="rotate-90" /> Bulk Add
              </button>
              <button
                onClick={() => handleOpenModal()}
                className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
              >
                <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
              </button>
            </div>
          </PermissionGuard>
        </div>
      </div>

      <div id="deposits-snapshot-target" className="space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white dark:bg-[#1A221D] p-8 lg:p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5 transition-all hover:-translate-y-2 duration-500">
            <p className="text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-[0.2em] mb-4">{t('deposits.currentMonth', lang)}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`font-black text-dark dark:text-white tracking-tighter leading-none ${formatCurrency(totalMonthly).length > 12 ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'}`}>{formatCurrency(totalMonthly)}</span>
              <span className="text-sm font-black text-brand tracking-tight">Vested</span>
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
              <span className="text-4xl sm:text-5xl font-black text-dark dark:text-white tracking-tighter leading-none">{paginatedData.total}</span>
              <span className="text-sm font-black text-gray-400 tracking-tight">{t('deposits.records', lang)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5 transition-colors duration-300">
          <div className="px-10 py-8 border-b border-gray-50 dark:border-white/5 flex items-center justify-between gap-6">
            <div className="relative flex-1 max-w-xl flex items-center gap-3">
              <div className="relative">
                <select
                  value={searchField}
                  onChange={(e) => setSearchField(e.target.value)}
                  className="appearance-none bg-gray-50/50 dark:bg-[#111814] pl-4 pr-10 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-2 focus:ring-dark dark:focus:ring-brand text-sm font-bold transition-all dark:text-white cursor-pointer outline-none"
                >
                  <option value="all">All Fields</option>
                  <option value="memberName">Member Name</option>
                  <option value="memberId">Member ID</option>
                  <option value="id">Trx ID / Ref</option>
                  <option value="amount">Amount</option>
                  <option value="fundName">Fund Name</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  <ArrowUpDown size={14} />
                </div>
              </div>
              <div className="relative flex-1">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={
                    searchField === 'amount' ? 'Enter amount...' :
                      searchField === 'id' ? 'Enter ID...' :
                        t('deposits.filterPlaceholder', lang)
                  }
                  className="w-full bg-gray-50/50 dark:bg-[#111814] pl-14 pr-6 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-2 focus:ring-dark dark:focus:ring-brand text-sm font-bold transition-all dark:text-white placeholder:text-gray-400"
                />
              </div>
            </div>
            <button className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white transition-colors">
              <Filter size={20} />
            </button>
          </div>

          <div className="overflow-x-auto px-2">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50/30 dark:bg-white/5">
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest cursor-pointer hover:text-brand transition-colors group" onClick={() => handleSort('date')}>
                    <div className="flex items-center gap-2">
                      {t('deposits.depositTx', lang)}
                      {sortBy === 'date' ? (sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />) : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </div>
                  </th>
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest cursor-pointer hover:text-brand transition-colors group" onClick={() => handleSort('memberId')}>
                    <div className="flex items-center gap-2">
                      {t('deposits.partnerEntity', lang)}
                      {sortBy === 'memberId' ? (sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />) : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </div>
                  </th>
                  <th className="px-6 py-6 text-center text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest cursor-pointer hover:text-brand transition-colors group" onClick={() => handleSort('shares')}>
                    <div className="flex items-center justify-center gap-2">
                      {t('deposits.shares', lang)}
                      {sortBy === 'shares' ? (sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />) : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </div>
                  </th>
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.monthPeriod', lang)}</th>
                  <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest cursor-pointer hover:text-brand transition-colors group" onClick={() => handleSort('amount')}>
                    <div className="flex items-center justify-end gap-2">
                      {t('deposits.amountBDT', lang)}
                      {sortBy === 'amount' ? (sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />) : <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </div>
                  </th>
                  <th className="px-6 py-6 text-center text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Method</th>
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('funds.fundName', lang)}</th>
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('deposits.handledBy', lang)}</th>
                  <th className="px-6 py-6 text-left text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">Audit</th>
                  <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('transactions.status', lang)}</th>
                  <th className="px-6 py-6 text-right text-[11px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t('transactions.actions', lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-10 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <RefreshCw className="animate-spin text-brand" size={40} />
                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Scanning Ledger...</p>
                      </div>
                    </td>
                  </tr>
                ) : deposits.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-10 py-20 text-center">
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest">No deposits found matching your search</p>
                    </td>
                  </tr>
                ) : (
                  deposits.map((dep) => (
                    <tr key={dep.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                      <td className="px-6 py-6">
                        <div className="flex flex-col font-black">
                          <p className="text-[10px] text-brand uppercase tracking-tighter">#{dep.id.slice(-6)}</p>
                          <p className="text-[9px] text-gray-400">{dep.date}</p>
                        </div>
                      </td>
                      <td className="px-6 py-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center text-dark dark:text-brand font-black text-xs uppercase">
                            {dep.memberName.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <p className="font-black text-dark dark:text-white text-base leading-none mb-1 group-hover:text-brand transition-colors">{dep.memberName}</p>
                            <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">ID: {dep.memberId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-6 text-center">
                        <span className="font-black text-dark dark:text-brand text-lg">{dep.shareNumber}</span>
                      </td>
                      <td className="px-6 py-6 font-black text-gray-500 text-xs">
                        {t('deposits.monthPeriod', lang)}: {dep.depositMonth}
                      </td>
                      <td className="px-6 py-6 text-right">
                        <p className="font-black text-dark dark:text-white text-xl tracking-tighter leading-none">
                          {formatCurrency(dep.amount)}
                        </p>
                      </td>
                      <td className="px-6 py-6 text-center">
                        <span className="inline-block px-3 py-1 bg-gray-100 dark:bg-white/5 rounded-lg text-[10px] font-black uppercase text-gray-600 dark:text-gray-400">
                          {dep.depositMethod || 'Cash'}
                        </span>
                      </td>
                      <td className="px-6 py-6">
                        {(() => {
                          const getFundAccent = (name: string) => {
                            const n = (name || '').toLowerCase();

                            // Extended palette for variety
                            const accents = [
                              { bg: 'bg-emerald-50 dark:bg-emerald-500/20', border: 'border-emerald-200 dark:border-emerald-500/30', dot: 'bg-emerald-500' },
                              { bg: 'bg-blue-50 dark:bg-blue-500/20', border: 'border-blue-200 dark:border-blue-500/30', dot: 'bg-blue-500' },
                              { bg: 'bg-purple-50 dark:bg-purple-500/20', border: 'border-purple-200 dark:border-purple-500/30', dot: 'bg-purple-500' },
                              { bg: 'bg-rose-50 dark:bg-rose-500/20', border: 'border-rose-200 dark:border-rose-500/30', dot: 'bg-rose-500' },
                              { bg: 'bg-indigo-50 dark:bg-indigo-500/20', border: 'border-indigo-200 dark:border-indigo-500/30', dot: 'bg-indigo-500' },
                              { bg: 'bg-teal-50 dark:bg-teal-500/20', border: 'border-teal-200 dark:border-teal-500/30', dot: 'bg-teal-500' },
                              { bg: 'bg-orange-50 dark:bg-orange-500/20', border: 'border-orange-200 dark:border-orange-500/30', dot: 'bg-orange-500' },
                              { bg: 'bg-cyan-50 dark:bg-cyan-500/20', border: 'border-cyan-200 dark:border-cyan-500/30', dot: 'bg-cyan-500' },
                              { bg: 'bg-sky-50 dark:bg-sky-500/20', border: 'border-sky-200 dark:border-sky-500/30', dot: 'bg-sky-500' },
                              { bg: 'bg-amber-50 dark:bg-amber-500/20', border: 'border-amber-200 dark:border-amber-500/30', dot: 'bg-amber-500' },
                              { bg: 'bg-lime-50 dark:bg-lime-500/20', border: 'border-lime-200 dark:border-lime-500/30', dot: 'bg-lime-500' },
                              { bg: 'bg-violet-50 dark:bg-violet-500/20', border: 'border-violet-200 dark:border-violet-500/30', dot: 'bg-violet-500' }
                            ];

                            // Simple hash to ensure same name = same color, but different name = different color
                            let hash = 0;
                            for (let i = 0; i < n.length; i++) {
                              hash = n.charCodeAt(i) + ((hash << 5) - hash);
                            }
                            const index = Math.abs(hash) % accents.length;
                            return accents[index];
                          };

                          const accent = getFundAccent(dep.fundName || '');

                          return (
                            <div className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg border w-fit shadow-sm text-black dark:text-white ${accent.bg} ${accent.border}`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} />
                              {dep.fundName}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-6">
                        <div className="flex items-center gap-2 text-xs font-black text-gray-500 uppercase tracking-tighter">
                          <User size={12} />
                          {dep.cashierName}
                        </div>
                      </td>
                      <td className="px-6 py-6">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 text-[9px] font-black text-gray-400 uppercase tracking-wider">
                            <span className="text-gray-300 dark:text-gray-600">IN:</span> {dep.createdAt}
                          </div>
                          {dep.updatedAt && (
                            <div className="flex items-center gap-1.5 text-[9px] font-black text-brand uppercase tracking-wider">
                              <span className="text-gray-300 dark:text-gray-600">UP:</span> {dep.updatedAt}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-6 text-right">
                        <span className={`inline-block px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${dep.status === 'Completed' ? 'bg-brand/10 text-brand' : 'bg-amber-400/10 text-amber-500'
                          }`}>
                          {(dep.status === ('Completed' as any) || dep.status === ('Success' as any)) ? t('common.completed', lang) : (lang === 'bn' ? 'বিবেচনাধীন' : 'Pending')}
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

                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleOpenModal(dep);
                              }}
                              className="p-3 rounded-2xl shadow-xl border bg-white dark:bg-[#111814] border-gray-100 dark:border-white/5 text-gray-500 hover:text-brand hover:border-brand/30 transition-all"
                            >
                              <Edit2 size={16} />
                            </button>
                          </div>
                        </PermissionGuard>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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

      {
        isModalOpen && (
          <ModalForm
            isOpen={isModalOpen}
            onClose={handleCloseModal}
            title={editingDeposit ? t('deposits.editDeposit', lang) || 'Edit Deposit' : t('deposits.initializeDeposit', lang)}
            subtitle={t('deposits.moduleTitle', lang)}
            onSubmit={handleSubmit}
            submitLabel={editingDeposit ? t('common.update', lang) || 'Update' : t('deposits.commitTx', lang)}
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
                  value: p.id, // ✅ Use Mongo ID
                  label: `${p.name} (#${p.memberId}) - ${p.shares} ${t('deposits.shares', lang)}`,
                  className: "bg-white dark:bg-dark text-dark dark:text-white"
                }))}
                icon={<User size={18} />}
                required
                disabled={!!editingDeposit}
                className={!!editingDeposit ? "opacity-60 cursor-not-allowed" : ""}
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
                    onClick={() => {
                      if (!editingDeposit) handleToggleAutoCalc();
                    }}
                    className={`flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-brand hover:opacity-80 transition-all ${!!editingDeposit ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {autoCalculate ? <CheckSquare size={12} strokeWidth={3} /> : <Square size={12} strokeWidth={3} />}
                    {t('deposits.autoCalc', lang)}
                  </button>
                </div>
                <input
                  required
                  disabled={autoCalculate || !!editingDeposit}
                  type="number"
                  value={formData.amount}
                  onChange={e => setFormData({ ...formData, amount: e.target.value })}
                  className={`w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 focus:ring-2 focus:ring-dark dark:focus:ring-brand outline-none text-sm font-bold text-dark dark:text-white transition-all ${(autoCalculate || !!editingDeposit) ? 'opacity-50 cursor-not-allowed' : ''}`}
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

              {/* Field 7: Method */}
              <FormSelect
                label="Deposit Method"
                name="depositMethod"
                value={formData.depositMethod}
                onChange={e => setFormData({ ...formData, depositMethod: e.target.value })}
                options={['Cash', 'Bank', 'Mobile Banking', 'Check', 'Other'].map(m => ({
                  value: m,
                  label: m
                }))}
                required
              />

              {/* Field New: Transaction Date */}
              <FormInput
                label={t('deposits.transactionDate', lang)}
                name="txnDate"
                type="date"
                value={formData.txnDate}
                onChange={e => setFormData({ ...formData, txnDate: e.target.value })}
                required
                className={formData.depositMonth !== getCurrentMonthYear() ? "opacity-60 cursor-not-allowed" : ""}
                disabled={formData.depositMonth !== getCurrentMonthYear()}
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
        )
      }

      {
        isBulkModalOpen && (
          <ModalForm
            isOpen={isBulkModalOpen}
            onClose={() => setIsBulkModalOpen(false)}
            title="Bulk Deposit Entry"
            subtitle="Enterprise Batch Processing"
            onSubmit={handleBulkSubmit}
            submitLabel={`Process ${bulkRows.length} Deposits`}
            maxWidth="max-w-[90vw] lg:max-w-7xl"
            loading={isSubmitting}
          >
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-gray-50 dark:bg-white/5 p-8 rounded-[2.5rem]">
                <FormSelect
                  label="Target Collection Fund"
                  value={bulkFundId}
                  onChange={e => setBulkFundId(e.target.value)}
                  options={funds.filter(f => (f.type === 'DEPOSIT' || f.type === 'Primary') && f.status !== 'ARCHIVED').map(f => ({
                    value: f.id,
                    label: `${f.name} (${formatCurrency(f.balance)})`
                  }))}
                  required
                />
                <FormSelect
                  label="Deposit Method"
                  value={bulkDepositMethod}
                  onChange={e => setBulkDepositMethod(e.target.value)}
                  options={['Cash', 'Bank', 'Mobile Banking', 'Check', 'Other'].map(m => ({
                    value: m,
                    label: m
                  }))}
                  required
                />
                <div className="flex items-center gap-4 bg-white dark:bg-[#111814] p-2 rounded-3xl ring-1 ring-gray-100 dark:ring-white/10 lg:col-span-1 md:col-span-2">
                  <button
                    type="button"
                    onClick={downloadBulkTemplate}
                    className="flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl bg-gray-50 dark:bg-white/5 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-brand hover:bg-brand/5 transition-all"
                  >
                    <Download size={16} /> Get Template
                  </button>
                  <div className="w-px h-8 bg-gray-100 dark:bg-white/10" />
                  <label className="flex-1 flex items-center justify-center gap-3 py-4 rounded-2xl bg-gray-50 dark:bg-white/5 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-brand hover:bg-brand/5 transition-all cursor-pointer">
                    <Upload size={16} /> Import Excel
                    <input
                      type="file"
                      className="hidden"
                      accept=".xlsx, .xls"
                      onChange={handleExcelUpload}
                    />
                  </label>
                </div>
                <div className="bg-dark dark:bg-brand/10 p-4 rounded-3xl flex flex-col justify-center px-8 border border-white/5">
                  <p className="text-[9px] font-black text-white/40 dark:text-brand/60 uppercase tracking-widest mb-1">Batch Total Collection</p>
                  <p className="text-2xl font-black text-brand tracking-tighter uppercase leading-none">
                    {formatCurrency(bulkRows.reduce((sum, r) => sum + (parseInt(r.amount) || 0), 0))}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/5">
                      <th className="px-4 py-4 text-left text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Strategic Partner</th>
                      <th className="px-4 py-4 text-center text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Month / Period</th>
                      <th className="px-4 py-4 text-center text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Tx Date</th>
                      <th className="px-4 py-4 text-center text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Shares</th>
                      <th className="px-4 py-4 text-right text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Deposit (BDT)</th>
                      <th className="w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                    {bulkRows.map((row, index) => (
                      <tr key={index} className="group hover:bg-gray-50/50 dark:hover:bg-white/5 transition-all">
                        <td className="py-4 pr-4">
                          <select
                            value={row.memberId}
                            onChange={e => {
                              const memberId = e.target.value;
                              const member = activeMembers.find(m => m.id === memberId);
                              const updated = [...bulkRows];
                              updated[index] = {
                                ...row,
                                memberId,
                                shareNumber: member?.shares.toString() || '0',
                                amount: ((member?.shares || 0) * SHARE_WORTH).toString()
                              };
                              setBulkRows(updated);
                            }}
                            className="w-full min-w-[200px] bg-transparent p-4 rounded-xl font-bold text-sm outline-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-brand transition-all dark:text-white"
                          >
                            <option value="">Select Member...</option>
                            {activeMembers.map(m => (
                              <option key={m.id} value={m.id}>{m.name} (#{m.memberId})</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-4 px-4 text-center min-w-[180px]">
                          <div className="relative inline-block w-full">
                            <select
                              value={row.depositMonth}
                              onChange={e => {
                                const updated = [...bulkRows];
                                const newVal = e.target.value;
                                updated[index].depositMonth = newVal;

                                // Auto-lock date if not current month
                                if (newVal !== getCurrentMonthYear()) {
                                  const lockedDate = getDateFromMonthStr(newVal);
                                  if (lockedDate) {
                                    updated[index].txnDate = lockedDate;
                                  }
                                }

                                setBulkRows(updated);
                              }}
                              className="w-full bg-gray-50 dark:bg-white/5 p-4 rounded-xl font-bold text-[11px] uppercase tracking-wider outline-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-brand dark:text-white"
                            >
                              <optgroup label={(new Date().getFullYear() - 1).toString()}>
                                {Array.from({ length: 12 }).map((_, i) => (
                                  <option key={i} value={`${t(`common.months.${monthKeys[i]}`, lang)} ${new Date().getFullYear() - 1}`}>
                                    {t(`common.months.${monthKeys[i]}`, lang)} {new Date().getFullYear() - 1}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label={new Date().getFullYear().toString()}>
                                {Array.from({ length: 12 }).map((_, i) => (
                                  <option key={i} value={`${t(`common.months.${monthKeys[i]}`, lang)} ${new Date().getFullYear()}`}>
                                    {t(`common.months.${monthKeys[i]}`, lang)} {new Date().getFullYear()}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                          </div>
                        </td>
                        <td className="py-4 px-4 text-center min-w-[150px]">
                          <input
                            type="date"
                            value={row.txnDate || new Date().toISOString().split('T')[0]}
                            onChange={e => {
                              const updated = [...bulkRows];
                              updated[index].txnDate = e.target.value;
                              setBulkRows(updated);
                            }}
                            className={`w-full bg-gray-50 dark:bg-white/5 p-4 rounded-xl font-bold text-xs uppercase tracking-wider outline-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-brand dark:text-white ${row.depositMonth !== getCurrentMonthYear() ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={row.depositMonth !== getCurrentMonthYear()}
                          />
                        </td>
                        <td className="py-4 px-4 text-center">
                          <div className="bg-gray-100 dark:bg-white/5 px-4 py-3 rounded-xl inline-block min-w-[60px]">
                            <span className="font-black text-sm text-gray-500 dark:text-gray-400">{row.shareNumber}</span>
                          </div>
                        </td>
                        <td className="py-4 pl-4 text-right">
                          <input
                            type="number"
                            value={row.amount}
                            onChange={e => {
                              const updated = [...bulkRows];
                              updated[index].amount = e.target.value;
                              setBulkRows(updated);
                            }}
                            className="w-32 bg-gray-50 dark:bg-white/5 p-4 rounded-xl font-black text-right outline-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-brand text-brand"
                          />
                        </td>
                        <td className="py-4 pl-4 text-right">
                          <button
                            type="button"
                            onClick={() => setBulkRows(bulkRows.filter((_, i) => i !== index))}
                            disabled={bulkRows.length === 1}
                            className="p-3 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => setBulkRows([...bulkRows, { memberId: '', amount: '0', shareNumber: '0', depositMonth: bulkMonth }])}
                className="w-full py-5 border-2 border-dashed border-gray-100 dark:border-white/5 rounded-3xl text-[11px] font-black text-gray-400 uppercase tracking-widest hover:border-brand hover:text-brand transition-all flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Add Another Entry
              </button>
            </div>
          </ModalForm>
        )
      }
    </div >
  );
};

export default Deposits;
