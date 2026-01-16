
import React, { useState, useEffect } from 'react';
import { 
  FileText, Download, Calendar, Filter, Search, 
  ChevronRight, ArrowRight, CheckCircle2, Clock, 
  FileSpreadsheet, FileJson, FileBarChart, PieChart,
  Users, Briefcase, Landmark, ShieldCheck, Activity,
  Trash2, ExternalLink
} from 'lucide-react';
import Toast, { ToastType } from './Toast';
import { reportService } from '../services/api';

type ReportType = 'Member Contribution' | 'Project Performance' | 'Expense Audit' | 'Funds Summary' | 'ROI Analysis';
type ExportFormat = 'PDF' | 'Excel' | 'JSON';

interface GeneratedReport {
  _id?: string;
  id?: string;
  name: string;
  type: ReportType;
  date?: string;
  createdAt?: string;
  size: string;
  format: ExportFormat;
  content?: string;
}

const Reports: React.FC = () => {
  const [activeType, setActiveType] = useState<ReportType>('Member Contribution');
  const [format, setFormat] = useState<ExportFormat>('PDF');
  const [fiscalMonth, setFiscalMonth] = useState('2026-03');
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<GeneratedReport[]>([]);
  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const reports = await reportService.getAll();
        setHistory(reports);
      } catch (error) {
        console.error('Failed to fetch reports:', error);
      }
    };
    fetchReports();
  }, []);

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
      const fileName = `${activeType.replace(/\s+/g, '_')}_${fiscalMonth}.${format.toLowerCase() === 'excel' ? 'xlsx' : format.toLowerCase()}`;
      
      const blob = await reportService.download(activeType, format, fiscalMonth);
      
      const reportData = {
        name: fileName,
        type: activeType,
        size: `${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
        format: format,
        fiscalMonth: fiscalMonth
      };

      const newReport = await reportService.create(reportData);
      setHistory([newReport, ...history]);
      triggerDownload(fileName, blob);
      showNotification(`${activeType} report generated and downloaded.`, 'success');
    } catch (error) {
      showNotification('Failed to generate report', 'error');
    }
    
    setIsGenerating(false);
  };

  const handleDeleteHistory = async (id: string) => {
    try {
      await reportService.delete(id);
      setHistory(history.filter(h => (h._id || h.id) !== id));
      showNotification("Report archive entry removed.");
    } catch (error) {
      showNotification('Failed to delete report', 'error');
    }
  };

  const reportConfigs = [
    { type: 'Member Contribution', icon: <Users size={20} />, desc: 'Detailed breakdown of all member deposits and share holdings.' },
    { type: 'Project Performance', icon: <Briefcase size={20} />, desc: 'ROI tracking, milestone status, and project fund health.' },
    { type: 'Expense Audit', icon: <Activity size={20} />, desc: 'Complete historical log of all operational and project expenditures.' },
    { type: 'Funds Summary', icon: <Landmark size={20} />, desc: 'Analysis of primary, project, and reserve fund distributions.' },
    { type: 'ROI Analysis', icon: <PieChart size={20} />, desc: 'Strategic predictive modeling of venture returns over time.' },
  ];

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <Toast 
        isVisible={toast.isVisible} 
        message={toast.message} 
        type={toast.type} 
        onClose={() => setToast({ ...toast, isVisible: false })} 
      />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>STRATEGY</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">AUDIT REPORTS</span>
          </nav>
          <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">Intelligence Engine</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Left: Configuration */}
        <div className="lg:col-span-2 space-y-10">
          <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-32 bg-brand/5 rounded-full -mr-10 -mt-10 blur-3xl group-hover:scale-110 transition-transform duration-[2s]"></div>
            
            <div className="relative z-10">
              <div className="mb-10">
                <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-3">Report Parameters</h3>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Configure your data extraction protocol</p>
              </div>

              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest px-1">Fiscal Period</label>
                    <div className="relative">
                      <input 
                        type="month" 
                        value={fiscalMonth}
                        onChange={(e) => setFiscalMonth(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-[#111814] px-6 py-4 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/10 text-sm font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand outline-none transition-all"
                      />
                      <Calendar className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest px-1">Export Format</label>
                    <div className="flex gap-2 bg-gray-50 dark:bg-[#111814] p-1 rounded-2xl ring-1 ring-gray-100 dark:ring-white/10">
                      {(['PDF', 'Excel', 'JSON'] as ExportFormat[]).map(f => (
                        <button 
                          key={f}
                          onClick={() => setFormat(f)}
                          className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${format === f ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-lg' : 'text-gray-400'}`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest px-1">Intelligence Template</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {reportConfigs.map((cfg) => (
                      <button
                        key={cfg.type}
                        onClick={() => setActiveType(cfg.type as ReportType)}
                        className={`text-left p-6 rounded-3xl border transition-all flex items-start gap-4 ${
                          activeType === cfg.type 
                          ? 'bg-brand/10 border-brand/40 shadow-xl' 
                          : 'bg-white dark:bg-white/5 border-gray-100 dark:border-white/5 hover:border-brand/20'
                        }`}
                      >
                        <div className={`p-3 rounded-2xl ${activeType === cfg.type ? 'bg-brand text-dark' : 'bg-gray-50 dark:bg-dark text-gray-400'}`}>
                          {cfg.icon}
                        </div>
                        <div>
                          <p className={`text-sm font-black uppercase tracking-tight mb-1 ${activeType === cfg.type ? 'text-dark dark:text-brand' : 'text-gray-500 dark:text-white'}`}>{cfg.type}</p>
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest leading-relaxed">{cfg.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={handleGenerateReport}
                  disabled={isGenerating}
                  className="w-full bg-dark dark:bg-brand text-white dark:text-dark py-6 rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-4 hover:scale-[1.02] active:scale-95 transition-all shadow-2xl shadow-brand/20 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <Clock className="animate-spin" size={20} /> Encrypting Strategic Ledger...
                    </>
                  ) : (
                    <>
                      <FileBarChart size={20} /> Generate & Download Report
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-brand p-10 rounded-[4rem] text-dark shadow-2xl shadow-brand/20">
               <ShieldCheck size={40} strokeWidth={3} className="mb-6 opacity-40" />
               <h4 className="text-3xl font-black tracking-tighter leading-none mb-3">Compliance Ready</h4>
               <p className="text-xs font-black uppercase tracking-widest opacity-60">System health: 100% Verified</p>
               <div className="mt-8 pt-8 border-t border-dark/10 flex justify-between items-center">
                  <p className="text-[10px] font-black uppercase tracking-widest">Last system sweep</p>
                  <p className="text-sm font-black uppercase">Just Now</p>
               </div>
            </div>
            <div className="bg-dark p-10 rounded-[4rem] text-white shadow-2xl">
               <Activity size={40} strokeWidth={3} className="text-brand mb-6 opacity-40" />
               <h4 className="text-3xl font-black tracking-tighter leading-none mb-3">Live Streaming</h4>
               <p className="text-xs font-black uppercase tracking-widest text-brand/60">Data sync: 12ms latency</p>
               <div className="mt-8 pt-8 border-t border-white/10 flex justify-between items-center">
                  <p className="text-[10px] font-black uppercase tracking-widest">Global Vault Status</p>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-brand animate-pulse"></div>
                    <p className="text-sm font-black uppercase">Secure</p>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* Right: History */}
        <div className="lg:col-span-1 space-y-10">
          <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5 h-full">
            <div className="flex items-center justify-between mb-10">
              <h4 className="text-xl font-black text-dark dark:text-white uppercase tracking-tighter">Generation Archive</h4>
              <FileSpreadsheet className="text-brand" size={24} />
            </div>

            <div className="space-y-6 max-h-[800px] overflow-y-auto pr-2 custom-scrollbar">
              {history.map((rpt) => (
                <div key={rpt._id || rpt.id} className="p-6 bg-gray-50 dark:bg-[#111814] rounded-3xl border border-gray-100 dark:border-white/5 group hover:border-brand/40 transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                       <div className="p-2.5 bg-white dark:bg-dark rounded-xl shadow-sm">
                          {rpt.format === 'PDF' && <FileText size={18} className="text-rose-500" />}
                          {rpt.format === 'Excel' && <FileSpreadsheet size={18} className="text-emerald-500" />}
                          {rpt.format === 'JSON' && <FileJson size={18} className="text-blue-500" />}
                       </div>
                       <div className="min-w-0">
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5 truncate">{rpt.type}</p>
                          <p className="text-xs font-black text-dark dark:text-white uppercase truncate max-w-[140px]">{rpt.name}</p>
                       </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={async () => {
                          try {
                            const blob = await reportService.download(rpt.type, rpt.format, rpt.fiscalMonth || '');
                            triggerDownload(rpt.name, blob);
                          } catch (error) {
                            showNotification('Failed to download report', 'error');
                          }
                        }}
                        className="p-2 text-gray-300 hover:text-brand transition-colors"
                        title="Download"
                      >
                        <Download size={18} />
                      </button>
                      <button 
                        onClick={() => handleDeleteHistory(rpt._id || rpt.id || '')}
                        className="p-2 text-gray-300 hover:text-rose-500 transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-white/5">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{rpt.createdAt ? new Date(rpt.createdAt).toISOString().split('T')[0] : rpt.date}</span>
                    <span className="text-[9px] font-black text-brand uppercase tracking-widest">{rpt.size}</span>
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">No reports archived yet</p>
                </div>
              )}
              <button className="w-full py-5 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-3xl text-[10px] font-black text-gray-400 uppercase tracking-widest hover:border-brand hover:text-brand transition-all">
                Access Cold Storage
              </button>
            </div>

            <div className="mt-12 p-8 bg-dark rounded-[3rem] text-center relative overflow-hidden">
               <div className="absolute inset-0 bg-brand/5 blur-2xl"></div>
               <p className="relative z-10 text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-4">Autonomous Auditing</p>
               <h5 className="relative z-10 text-xl font-black text-white uppercase tracking-tighter leading-none mb-6">Schedule Recurring Reports</h5>
               <button className="relative z-10 w-full py-4 bg-brand text-dark rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-105 active:scale-95 transition-all">
                 Configure Scheduler
               </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
