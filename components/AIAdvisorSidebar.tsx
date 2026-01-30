
import React, { useState, useEffect } from 'react';
import { Sparkles, X, Brain, Zap, Target, TrendingUp, Loader2 } from 'lucide-react';
import { useGlobalState } from '../context/GlobalStateContext';
import { getAdvancedFinancialAdvice } from '../services/geminiService';
import { Language, t } from '../i18n/translations';

interface AIAdvisorSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
}

const AIAdvisorSidebar: React.FC<AIAdvisorSidebarProps> = ({ isOpen, onClose, lang }) => {
  const state = useGlobalState();
  const [advice, setAdvice] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const fetchAdvice = async () => {
    setIsLoading(true);
    const result = await getAdvancedFinancialAdvice(state);
    setAdvice(result);
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) fetchAdvice();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] z-[100] bg-dark/80 backdrop-blur-3xl border-l border-white/10 shadow-[-50px_0_100px_rgba(0,0,0,0.5)] animate-in slide-in-from-right-full duration-500">
      <div className="p-10 h-full flex flex-col">
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-brand rounded-2xl flex items-center justify-center text-dark shadow-2xl shadow-brand/20">
              <Brain size={24} strokeWidth={3} />
            </div>
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-tighter">AI Strategist</h2>
              <p className="text-[10px] font-black text-brand uppercase tracking-widest">Live Intelligence</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-white/5 text-white/40 hover:text-brand transition-all rounded-xl">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-8 no-scrollbar">
          <div className="bg-brand/10 border border-brand/20 p-8 rounded-[3rem] relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-12 bg-brand/5 rounded-full -mr-6 -mt-6 blur-2xl group-hover:scale-150 transition-transform duration-1000"></div>
            <p className="text-[10px] font-black text-brand uppercase tracking-[0.4em] mb-4">Strategic Pulse</p>
            {isLoading ? (
              <div className="flex flex-col items-center py-12 gap-4">
                <Loader2 className="animate-spin text-brand" size={40} />
                <p className="text-xs font-black text-brand/60 uppercase tracking-widest animate-pulse">Syncing Ledger...</p>
              </div>
            ) : (
              <div className="text-sm font-medium text-white/80 leading-relaxed whitespace-pre-line animate-in fade-in duration-700">
                {advice || "Scanning your portfolio for growth opportunities..."}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button onClick={fetchAdvice} className="p-6 bg-white/5 rounded-3xl border border-white/5 hover:border-brand/40 transition-all text-left group">
              <Zap size={20} className="text-brand mb-3 group-hover:scale-110 transition-transform" />
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Refresh Analysis</p>
            </button>
            <button className="p-6 bg-white/5 rounded-3xl border border-white/5 hover:border-brand/40 transition-all text-left group">
              <Target size={20} className="text-brand mb-3 group-hover:scale-110 transition-transform" />
              <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Set Benchmarks</p>
            </button>
          </div>

          <div className="p-8 bg-dark rounded-[2.5rem] border border-white/5">
            <h3 className="text-xs font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
              <TrendingUp size={16} className="text-brand" /> Health Metrics
            </h3>
            <div className="space-y-6">
              {[
                { label: "Cash on Hand", val: "BDT 850K", fill: "80%" },
                { label: "Project Risk", val: "Low", fill: "25%" },
                { label: "Member Growth", val: "+12%", fill: "60%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[9px] font-black uppercase text-white/30 mb-2">
                    <span>{m.label}</span>
                    <span className="text-brand">{m.val}</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand shadow-[0_0_10px_rgba(191,243,0,0.5)]" style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-white/10">
          <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.5em] text-center">Powered by Gemini AI Engine</p>
        </div>
      </div>
    </div>
  );
};

export default AIAdvisorSidebar;
