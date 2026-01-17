import React, { useState } from 'react';
import {
  FileText, Calendar, Clock,
  FileBarChart, PieChart,
  Users, Briefcase, Landmark, ShieldCheck, Activity,
  Award, Projector, Wallet, TrendingUp, Receipt
} from 'lucide-react';
import Toast, { ToastType } from './Toast';
import { reportService } from '../services/api';
import ExportMenu from './ExportMenu';
import { useGlobalState } from '../context/GlobalStateContext';
import { Language, t } from '../i18n/translations';

type ReportType = 'Member Contribution' | 'Project Performance' | 'Expense Audit' | 'Funds Summary' | 'ROI Analysis' | 'Dividend Report' | 'Stakeholder Statement' | 'Venture Growth Matrix' | 'Revenue Analytics' | 'Interest Accruals' | 'Comprehensive Master Ledger' | 'Project Specific Ledger' | 'Member Specific Ledger' | 'Project Expense Audit' | 'Member Deposit History';
type ExportFormat = 'PDF' | 'Excel' | 'JSON';
type PeriodType = 'Monthly' | 'Quarterly' | 'Yearly' | 'Custom';
type ReportCategory = 'Ledger' | 'Deposits' | 'Incomes' | 'Expenses' | 'Projects';

interface ReportsProps {
  lang: Language;
}

const Reports: React.FC<ReportsProps> = ({ lang }) => {
  const { members, projects } = useGlobalState();
  const [activeTab, setActiveTab] = useState<ReportCategory>('Ledger');
  const [activeType, setActiveType] = useState<ReportType>('Comprehensive Master Ledger');
  const [format, setFormat] = useState<ExportFormat>('PDF');
  const [periodType, setPeriodType] = useState<PeriodType>('Monthly');
  const [fiscalMonth, setFiscalMonth] = useState(new Date().toISOString().substring(0, 7));
  const [startDate, setStartDate] = useState(new Date().toISOString().substring(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().substring(0, 10));
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear().toString());
  const [fiscalQuarter, setFiscalQuarter] = useState('Q1');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const triggerDownload = (fileName: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleGenerateReport = async () => {
    setIsGenerating(true);

    try {
      let periodValue = '';
      if (periodType === 'Monthly') periodValue = fiscalMonth;
      else if (periodType === 'Quarterly') periodValue = `${fiscalYear}-${fiscalQuarter}`;
      else if (periodType === 'Yearly') periodValue = fiscalYear;
      else periodValue = `${startDate}_to_${endDate}`;

      const params = new URLSearchParams({
        format,
        period: periodType,
        date: periodValue
      });

      if (selectedProjectId) params.append('projectId', selectedProjectId);
      if (selectedMemberId) params.append('memberId', selectedMemberId);

      const fileName = `${activeType.replace(/\s+/g, '_')}_${periodValue}.${format.toLowerCase() === 'excel' ? 'xlsx' : format.toLowerCase()}`;
      const blob = await reportService.generate(activeType, params.toString());

      const reportData = {
        name: fileName,
        type: activeType,
        size: `${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
        format: format,
        fiscalMonth: periodValue
      };

      await reportService.create(reportData);
      triggerDownload(fileName, blob);
      showNotification(`${activeType} report generated and downloaded.`, 'success');
    } catch (error) {
      showNotification('Failed to generate report', 'error');
    }

    setIsGenerating(false);
  };

  const reportConfigs = [
    // Ledger
    { type: 'Comprehensive Master Ledger', category: 'Ledger', icon: <Activity size={20} />, desc: 'Universal "In-Out" data log. Includes all transactions, deposits, and expenditures in a single audit line.' },
    { type: 'Project Specific Ledger', category: 'Ledger', icon: <Briefcase size={20} />, desc: 'Narrow-focus financial history for a specific active or legacy project.' },
    { type: 'Member Specific Ledger', category: 'Ledger', icon: <Users size={20} />, desc: 'Individual data mining of all financial interactions for a single stakeholder.' },
    { type: 'Stakeholder Statement', category: 'Ledger', icon: <FileText size={20} />, desc: 'Individual partner financial activities and balance certification.' },
    { type: 'Funds Summary', category: 'Ledger', icon: <Landmark size={20} />, desc: 'Analysis of primary, project, and reserve fund distributions.' },
    { type: 'Dividend Report', category: 'Ledger', icon: <Award size={20} />, desc: 'Calculated profit distributions and equity payouts per stakeholder.' },

    // Deposits
    { type: 'Member Contribution', category: 'Deposits', icon: <Users size={20} />, desc: 'Detailed breakdown of all member deposits and share holdings.' },
    { type: 'Member Deposit History', category: 'Deposits', icon: <Wallet size={20} />, desc: 'Timeline extraction of all capital injections for a selected member.' },

    // Incomes
    { type: 'Revenue Analytics', category: 'Incomes', icon: <TrendingUp size={20} />, desc: 'Consolidated view of all revenue streams and project returns.' },
    { type: 'Interest Accruals', category: 'Incomes', icon: <TrendingUp size={20} />, desc: 'Tracking of interest earned from bank placements and holdings.' },

    // Expenses
    { type: 'Expense Audit', category: 'Expenses', icon: <Receipt size={20} />, desc: 'Complete historical log of all operational and project expenditures.' },
    { type: 'Project Expense Audit', category: 'Expenses', icon: <Receipt size={20} />, desc: 'Granular expenditure log narrowed down to a specific venture.' },

    // Projects
    { type: 'Project Performance', category: 'Projects', icon: <Briefcase size={20} />, desc: 'ROI tracking, milestone status, and project fund health.' },
    { type: 'ROI Analysis', category: 'Projects', icon: <PieChart size={20} />, desc: 'Strategic predictive modeling of venture returns over time.' },
    { type: 'Venture Growth Matrix', category: 'Projects', icon: <Projector size={20} />, desc: 'Comparative analysis of growth across all active and legacy ventures.' },
  ];

  const categories: { id: ReportCategory; icon: React.ReactNode }[] = [
    { id: 'Ledger', icon: <FileBarChart size={16} /> },
    { id: 'Deposits', icon: <Wallet size={16} /> },
    { id: 'Incomes', icon: <TrendingUp size={16} /> },
    { id: 'Expenses', icon: <Activity size={16} /> },
    { id: 'Projects', icon: <Briefcase size={16} /> },
  ];

  const filteredConfigs = reportConfigs.filter(cfg => cfg.category === activeTab);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Toast
        isVisible={toast.isVisible}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ ...toast, isVisible: false })}
      />

      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4">
          <div className="w-1.5 h-8 bg-brand rounded-full"></div>
          <h1 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.reports', lang)}</h1>
          <nav className="text-[10px] font-black text-gray-400 flex items-center gap-2 uppercase tracking-widest ml-4 opacity-50 border-l border-gray-200 dark:border-white/10 pl-4 h-4">
            <span>{t('nav.strategy', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.reports', lang)}</span>
          </nav>
        </div>
        <ExportMenu
          data={reportConfigs}
          columns={[
            { header: 'Category', key: 'category' },
            { header: 'Template', key: 'type' },
            { header: 'Description', key: 'desc' }
          ]}
          fileName={`reporting_templates_${new Date().toISOString().split('T')[0]}`}
          title="Intelligence Template Catalog"
          targetId="reports-config-capture"
        />
      </div>

      <div id="reports-config-capture" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col: Settings */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white dark:bg-[#1A221D] p-6 rounded-[2rem] card-shadow border border-gray-100 dark:border-white/5 h-full">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-brand"></div>
              Extraction Protocol
            </h4>

            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Period Selection</label>
                <div className="grid grid-cols-2 gap-2 bg-gray-50 dark:bg-[#111814] p-1 rounded-xl ring-1 ring-gray-100 dark:ring-white/10">
                  {(['Monthly', 'Quarterly', 'Yearly', 'Custom'] as PeriodType[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriodType(p)}
                      className={`py-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${periodType === p ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-md' : 'text-gray-400'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {periodType === 'Monthly' && (
                  <div className="relative">
                    <input type="month" value={fiscalMonth} onChange={(e) => setFiscalMonth(e.target.value)} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3.5 rounded-xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-xs font-bold text-dark dark:text-white outline-none" />
                    <Calendar className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  </div>
                )}
                {periodType === 'Quarterly' && (
                  <div className="grid grid-cols-2 gap-3">
                    <select value={fiscalYear} onChange={e => setFiscalYear(e.target.value)} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3.5 rounded-xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-xs font-bold text-dark dark:text-white outline-none">
                      {['2023', '2024', '2025', '2026'].map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <select value={fiscalQuarter} onChange={e => setFiscalQuarter(e.target.value)} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3.5 rounded-xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-xs font-bold text-dark dark:text-white outline-none">
                      {['Q1', 'Q2', 'Q3', 'Q4'].map(q => <option key={q} value={q}>{q}</option>)}
                    </select>
                  </div>
                )}
                {periodType === 'Yearly' && (
                  <select value={fiscalYear} onChange={e => setFiscalYear(e.target.value)} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3.5 rounded-xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-xs font-bold text-dark dark:text-white outline-none">
                    {['2023', '2024', '2025', '2026'].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
                {periodType === 'Custom' && (
                  <div className="grid grid-cols-1 gap-3">
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3.5 rounded-xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-xs font-bold text-dark dark:text-white outline-none" />
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3.5 rounded-xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-xs font-bold text-dark dark:text-white outline-none" />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Export Architecture</label>
                <div className="flex gap-2 bg-gray-50 dark:bg-[#111814] p-1 rounded-xl ring-1 ring-gray-100 dark:ring-white/10">
                  {(['PDF', 'Excel', 'JSON'] as ExportFormat[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${format === f ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-md' : 'text-gray-400'}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Context Filters */}
              {(activeType.includes('Project') || activeType === 'Project Expense Audit') && (
                <div className="space-y-3 animate-in slide-in-from-left duration-300">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Active Project Focus</label>
                  <select
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3.5 rounded-xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-xs font-bold text-dark dark:text-white outline-none"
                  >
                    <option value="">Select Target Project</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
              )}

              {(activeType.includes('Member') || activeType === 'Member Deposit History') && (
                <div className="space-y-3 animate-in slide-in-from-left duration-300">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Member Entity Filter</label>
                  <select
                    value={selectedMemberId}
                    onChange={e => setSelectedMemberId(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3.5 rounded-xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-xs font-bold text-dark dark:text-white outline-none"
                  >
                    <option value="">Select Target Member</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Col: Templates Selection */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveTab(cat.id);
                  const firstOfType = reportConfigs.find(cfg => cfg.category === cat.id);
                  if (firstOfType) setActiveType(firstOfType.type as ReportType);
                }}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === cat.id
                  ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-lg'
                  : 'bg-white dark:bg-white/5 text-gray-400 hover:bg-gray-50 dark:hover:bg-white/10'
                  }`}
              >
                {cat.icon}
                {cat.id}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-[#1A221D] p-8 rounded-[2rem] card-shadow border border-gray-100 dark:border-white/5 flex-grow relative overflow-hidden flex flex-col justify-center">
            <div className="absolute top-0 right-0 p-24 bg-brand/5 rounded-full -mr-10 -mt-10 blur-3xl"></div>

            <div className="relative z-10 space-y-8">
              <div className="space-y-4">
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-[0.2em] px-1">Select Module Protocol:</label>
                <div className="relative group">
                  <select
                    value={activeType}
                    onChange={(e) => setActiveType(e.target.value as ReportType)}
                    className="w-full bg-gray-50 dark:bg-[#111814] px-8 py-6 rounded-2xl border-none ring-2 ring-gray-100 dark:ring-white/10 text-lg font-black text-dark dark:text-white focus:ring-4 focus:ring-brand outline-none transition-all appearance-none cursor-pointer"
                  >
                    {filteredConfigs.map((cfg) => (
                      <option key={cfg.type} value={cfg.type} className="bg-white dark:bg-[#1A221D] text-dark dark:text-white py-2">
                        {cfg.type.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-8 top-1/2 -translate-y-1/2 pointer-events-none group-hover:scale-110 transition-transform">
                    <FileText className="text-brand" size={24} />
                  </div>
                </div>
              </div>

              <div className="bg-brand/5 p-6 rounded-2xl border border-brand/10">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-brand text-dark rounded-xl shadow-lg ring-4 ring-brand/20">
                    {reportConfigs.find(c => c.type === activeType)?.icon}
                  </div>
                  <div>
                    <h5 className="text-xs font-black text-dark dark:text-brand uppercase tracking-widest mb-1.5 flex items-center gap-2">
                      Template Logic
                      <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse"></div>
                    </h5>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-relaxed">
                      {reportConfigs.find(c => c.type === activeType)?.desc}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerateReport}
            disabled={isGenerating}
            className="w-full bg-dark dark:bg-brand text-white dark:text-dark py-5 rounded-[1.5rem] font-black text-[11px] uppercase tracking-[0.3em] flex items-center justify-center gap-3 hover:scale-[1.01] active:scale-[0.98] transition-all shadow-xl shadow-brand/10 disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Clock className="animate-spin" size={16} /> Encryption In Progress...
              </>
            ) : (
              <>
                <FileBarChart size={16} /> Finalize Intelligence Protocol
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Reports;
