import React, { useState } from 'react';
import { Plus, Search, Filter, Archive, Wallet, ArrowUpRight, ArrowDownRight, FolderOpen, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Fund, AccessLevel, AppScreen } from '../types';
import { useGlobalState } from '../context/GlobalStateContext';
import ExportMenu from './ExportMenu';
import Toast, { ToastType } from './Toast';
import { formatCurrency } from '../utils/formatters';
import { Language, t } from '../i18n/translations';

interface FundsManagementProps {
  lang: Language;
}

const FundsManagement: React.FC<FundsManagementProps> = ({ lang }) => {
  const { funds, addFund, updateFund, refreshFunds, currentUser } = useGlobalState();
  const [refreshing, setRefreshing] = useState(false);

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
    handlingOfficer: ''
  });

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const handleOpenModal = () => {
    setFormData({ name: '', type: 'OTHER', description: '', initialBalance: '', handlingOfficer: '' });
    setIsModalOpen(true);
  };

  const handleCreateFund = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name: formData.name,
        type: formData.type,
        description: formData.description,
        status: 'ACTIVE',
        balance: 0,
        currency: 'BDT', // Default
        handlingOfficer: formData.handlingOfficer
      };

      // If initial balance provided
      if (formData.initialBalance && parseFloat(formData.initialBalance) > 0) {
        payload.initialBalance = parseFloat(formData.initialBalance);
      }

      await addFund(payload);
      showNotification(`Fund "${formData.name}" created successfully.`);
      setIsModalOpen(false);
    } catch (err: any) {
      showNotification(err.message || "Failed to create fund.", "error");
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
              { header: 'Funding Name', key: 'name' },
              { header: 'Type', key: 'type' },
              { header: 'Officer', key: 'handlingOfficer' },
              { header: 'Balance', key: 'balance', format: (f: any) => formatCurrency(f.balance) },
              { header: 'Currency', key: 'currency' },
              { header: 'Description', key: 'description' }
            ]}
            fileName={`funds_${new Date().toISOString().split('T')[0]}`}
            title="Liquidity Funds Report"
          />
          {currentUser?.permissions[AppScreen.FUNDS_MANAGEMENT] === AccessLevel.WRITE && (
            <button onClick={handleOpenModal} className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20">
              <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeFunds.map(fund => (
          <div key={fund.id} className="group relative bg-white dark:bg-[#1A221D] p-8 rounded-[3rem] border border-gray-100 dark:border-white/5 hover:border-brand/20 transition-all card-shadow overflow-hidden">
            {currentUser?.permissions[AppScreen.FUNDS_MANAGEMENT] === AccessLevel.WRITE && (
              <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleArchive(fund)} className="p-2 bg-gray-50 dark:bg-white/5 rounded-full text-gray-400 hover:text-red-500 transition-colors" title="Archive Fund">
                  <Archive size={16} />
                </button>
              </div>
            )}

            <div className="flex items-start justify-between mb-8">
              <div className={`p-4 rounded-2xl ${fund.type === 'PROJECT' ? 'bg-purple-500/10 text-purple-500' : fund.type === 'DEPOSIT' || fund.type === 'Primary' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500'}`}>
                {fund.type === 'PROJECT' ? <FolderOpen size={24} /> : <Wallet size={24} />}
              </div>
              <div className="text-right">
                <span className="inline-block px-3 py-1 bg-gray-50 dark:bg-white/5 rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {fund.type === 'Primary' ? 'DEPOSIT' : fund.type}
                </span>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-xl font-black text-dark dark:text-white leading-tight mb-2 line-clamp-2">{fund.name}</h3>
              <p className="text-xs font-bold text-gray-400 line-clamp-2">{fund.description || "No description provided."}</p>
            </div>

            {fund.handlingOfficer && (
              <div className="mb-6 px-4 py-2 bg-gray-50 dark:bg-white/5 rounded-xl inline-block">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Handler</p>
                <p className="text-xs font-bold text-dark dark:text-white">{fund.handlingOfficer}</p>
              </div>
            )}

            <div className="pt-6 border-t border-gray-50 dark:border-white/5">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Current Balance</p>
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className={`font-black text-dark dark:text-white tracking-tighter ${formatCurrency(fund.balance).length > 14 ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'}`}>
                  {formatCurrency(fund.balance)}
                </span>
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

      {/* Archived Section (Collapsed by default logic or separate section) */}
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
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-dark/90 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white dark:bg-[#1A221D] w-full max-w-lg rounded-[3rem] card-shadow p-10 animate-in zoom-in-95 duration-300 relative border border-white/10">
            <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter mb-8">New Fund</h3>
            <form onSubmit={handleCreateFund} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Fund Name</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand" placeholder="e.g. Operational Reserve" />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Fund Type</label>
                <select value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand appearance-none">
                  <option value="DEPOSIT">DEPOSIT (Capital Inflow)</option>
                  <option value="OTHER">OTHER (Special Purpose)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Initial Balance (Optional)</label>
                <input type="number" min="0" value={formData.initialBalance} onChange={e => setFormData({ ...formData, initialBalance: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand" placeholder="0.00" />
                <p className="text-[10px] text-gray-400 pl-1">* Creates an opening balance transaction automatically.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Handling Officer</label>
                <input required type="text" value={formData.handlingOfficer} onChange={e => setFormData({ ...formData, handlingOfficer: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand" placeholder="Officer Name" />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest pl-1">Description</label>
                <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand h-24 resize-none" placeholder="Purpose of this fund..."></textarea>
              </div>

              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-4 rounded-[2rem] bg-gray-100 dark:bg-white/5 font-black text-xs uppercase hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-gray-500">Cancel</button>
                <button type="submit" className="flex-1 py-4 rounded-[2rem] bg-dark dark:bg-brand text-white dark:text-dark font-black text-xs uppercase hover:scale-105 transition-all shadow-xl">Create Fund</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FundsManagement;
