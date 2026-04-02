
import React, { useState, useEffect } from 'react';
import { Sparkles, X, Brain, Zap, Target, TrendingUp, Loader2, Search, Users, Briefcase, Wallet, PieChart, AlertTriangle, Receipt, Activity, BarChart3 } from 'lucide-react';
import { useGlobalState } from '../context/GlobalStateContext';
import { getAdvancedFinancialAdvice, getMemberAnalysis, getProjectAnalysis, getFundAnalysis, getRiskAssessment, getDepositAnalysis, getExpenseAnalysis, getTrendAnalysis, QueryType, getRateLimiterStatus } from '../services/longcatService';
import { Language, t } from '../i18n/translations';

interface AIAdvisorSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
}

type AnalysisType = QueryType | 'overview';

// Markdown table renderer component
const MarkdownTable: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n').filter(line => line.trim());
  const rows: string[][] = [];
  let isHeader = true;
  let headerRow: string[] = [];

  for (const line of lines) {
    if (line.includes('|') && !line.match(/^\|?\s*[-:|]+\s*\|$/)) {
      const cells = line.split('|').map(cell => cell.trim()).filter((cell, idx, arr) => {
        // Filter out empty first/last cells (from leading/trailing |)
        if (idx === 0 && cell === '') return false;
        if (idx === arr.length - 1 && cell === '') return false;
        return true;
      });
      if (cells.length > 0) {
        if (isHeader) {
          headerRow = cells;
          isHeader = false;
        } else {
          rows.push(cells);
        }
      }
    }
  }

  if (headerRow.length === 0) return null;

  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-white/20">
            {headerRow.map((header, i) => (
              <th key={i} className="text-left py-2 px-3 text-brand font-black uppercase tracking-wider whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="border-b border-white/10 hover:bg-white/5 transition-colors">
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} className="py-2 px-3 text-white/80 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Render AI response with markdown table support
const AIResponseRenderer: React.FC<{ content: string }> = ({ content }) => {
  // Check if content contains markdown table
  const hasTable = content.includes('|') && content.split('\n').some(line => line.includes('|'));

  if (!hasTable) {
    return <div className="text-sm font-medium text-white/80 leading-relaxed whitespace-pre-line">{content}</div>;
  }

  // Split content into parts and render tables
  const parts = content.split(/(\|[\s\S]*?\|)/g);

  return (
    <div className="text-sm font-medium text-white/80 leading-relaxed">
      {parts.map((part, index) => {
        if (part.trim().startsWith('|') && part.includes('|')) {
          return <MarkdownTable key={index} content={part} />;
        }
        return <p key={index} className="whitespace-pre-line mb-2">{part}</p>;
      })}
    </div>
  );
};

const AIAdvisorSidebar: React.FC<AIAdvisorSidebarProps> = ({ isOpen, onClose, lang }) => {
  const state = useGlobalState();

  // Load persisted state from localStorage
  const [advice, setAdvice] = useState<string>(() => {
    const saved = localStorage.getItem('aiAdvisorAdvice');
    return saved || '';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<AnalysisType>(() => {
    const saved = localStorage.getItem('aiAdvisorType') as AnalysisType;
    return saved || 'overview';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedFund, setSelectedFund] = useState('');
  const [customInstruction, setCustomInstruction] = useState(() => {
    return localStorage.getItem('aiAdvisorInstruction') || '';
  });
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('aiAdvisorModel') || 'LongCat-Flash-Lite';
  });
  const [isQueued, setIsQueued] = useState(false);
  const [queuePosition, setQueuePosition] = useState(0);

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem('aiAdvisorAdvice', advice);
  }, [advice]);

  useEffect(() => {
    localStorage.setItem('aiAdvisorType', selectedType);
  }, [selectedType]);

  useEffect(() => {
    localStorage.setItem('aiAdvisorInstruction', customInstruction);
  }, [customInstruction]);

  useEffect(() => {
    localStorage.setItem('aiAdvisorModel', selectedModel);
  }, [selectedModel]);

  const aiModels = [
    { id: 'LongCat-Flash-Chat', name: 'Flash Chat', speed: 'Fast', quality: 'Good' },
    { id: 'LongCat-Flash-Thinking-2601', name: 'Flash Thinking', speed: 'Medium', quality: 'Better' },
    { id: 'LongCat-Flash-Omni-2603', name: 'Flash Omni', speed: 'Medium', quality: 'Best' },
    { id: 'LongCat-Flash-Lite', name: 'Flash Lite', speed: 'Fastest', quality: 'Basic' },
  ];

  const templates = [
    { id: 'overview' as AnalysisType, icon: Brain, label: 'Overview', color: 'text-brand' },
    { id: 'member' as AnalysisType, icon: Users, label: 'Member', color: 'text-blue-400' },
    { id: 'project' as AnalysisType, icon: Briefcase, label: 'Project', color: 'text-green-400' },
    { id: 'fund' as AnalysisType, icon: Wallet, label: 'Fund', color: 'text-yellow-400' },
    { id: 'deposits' as AnalysisType, icon: Receipt, label: 'Deposits', color: 'text-emerald-400' },
    { id: 'expenses' as AnalysisType, icon: PieChart, label: 'Expenses', color: 'text-red-400' },
    { id: 'risk' as AnalysisType, icon: AlertTriangle, label: 'Risk', color: 'text-orange-400' },
    { id: 'trends' as AnalysisType, icon: Activity, label: 'Trends', color: 'text-purple-400' },
  ];

  const fetchAdvice = async () => {
    // Validate selection before making API request
    if (selectedType === 'member' && !selectedMember && !searchQuery) {
      setAdvice(lang === 'bn'
        ? 'কোন সদস্য নির্বাচন করা হয়নি। অনুগ্রহ করে ড্রপডাউন থেকে সদস্য নির্বাচন করুন অথবা নাম/আইডি দিয়ে খুঁজুন।'
        : 'No member selected. Please select a member from the dropdown or search by name/ID.');
      return;
    }
    if (selectedType === 'project' && !selectedProject && !searchQuery) {
      setAdvice(lang === 'bn'
        ? 'কোন প্রজেক্ট নির্বাচন করা হয়নি। অনুগ্রহ করে ড্রপডাউন থেকে প্রজেক্ট নির্বাচন করুন অথবা নাম দিয়ে খুঁজুন।'
        : 'No project selected. Please select a project from the dropdown or search by name.');
      return;
    }
    if (selectedType === 'fund' && !selectedFund && !searchQuery) {
      setAdvice(lang === 'bn'
        ? 'কোন ফান্ড নির্বাচন করা হয়নি। অনুগ্রহ করে ড্রপডাউন থেকে ফান্ড নির্বাচন করুন অথবা নাম দিয়ে খুঁজুন।'
        : 'No fund selected. Please select a fund from the dropdown or search by name.');
      return;
    }

    // Check rate limit status
    const status = getRateLimiterStatus();
    if (status.isQueued) {
      setIsQueued(true);
      setQueuePosition(status.queueLength);
      setAdvice(lang === 'bn'
        ? `অনুগ্রহ করে অপেক্ষা করুন... আপনার অনুরোধটি লাইনে আছে (${status.queueLength} টি অনুরোধ অপেক্ষা করছে)।`
        : `Please wait... Your request is queued (${status.queueLength} request(s) waiting).`);
    }

    setIsLoading(true);
    let result: string;

    try {
      if (selectedType === 'member' && selectedMember) {
        result = await getMemberAnalysis(state, selectedMember, lang, selectedModel, customInstruction || undefined);
      } else if (selectedType === 'project' && selectedProject) {
        result = await getProjectAnalysis(state, selectedProject, lang, selectedModel, customInstruction || undefined);
      } else if (selectedType === 'fund' && selectedFund) {
        result = await getFundAnalysis(state, selectedFund, lang, selectedModel, customInstruction || undefined);
      } else if (selectedType === 'risk') {
        result = await getRiskAssessment(state, lang, selectedModel, customInstruction || undefined);
      } else if (selectedType === 'deposits') {
        result = await getDepositAnalysis(state, lang, selectedModel, customInstruction || undefined);
      } else if (selectedType === 'expenses') {
        result = await getExpenseAnalysis(state, lang, selectedModel, customInstruction || undefined);
      } else if (selectedType === 'trends') {
        result = await getTrendAnalysis(state, lang, selectedModel, customInstruction || undefined);
      } else {
        result = await getAdvancedFinancialAdvice(state, lang, selectedModel, { type: selectedType as QueryType, searchQuery: searchQuery, customInstruction: customInstruction || undefined });
      }
      setAdvice(result);
    } catch (error) {
      setAdvice(lang === 'bn'
        ? 'বিশ্লেষণ ব্যর্থ। অনুগ্রহ করে আবার চেষ্টা করুন।'
        : 'Analysis failed. Please try again.');
    }
    setIsLoading(false);
    setIsQueued(false);
    setQueuePosition(0);
  };

  useEffect(() => {
    if (isOpen) {
      // Don't auto-fetch, wait for user to click Analyze
      // Only show initial message if no persisted advice exists
      if (!advice) {
        setAdvice(lang === 'bn'
          ? 'একটি টেমপ্লেট নির্বাচন করুন এবং এআই-এর মাধ্যমে বিশ্লেষণ করতে "Analyze Data" এ ক্লিক করুন।'
          : 'Select a template and click Analyze to get AI-powered insights.');
      }
    }
  }, [isOpen, lang]);

  const handleTemplateClick = (type: AnalysisType) => {
    setSelectedType(type);
    setSearchQuery('');
    setSelectedMember('');
    setSelectedProject('');
    setSelectedFund('');
    setAdvice(lang === 'bn'
      ? 'টেমপ্লেট নির্বাচন করা হয়েছে। বিশ্লেষণ করতে Analyze Data এ ক্লিক করুন।'
      : 'Template selected. Click Analyze to get insights.');
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedType === 'member' && searchQuery) {
      const member = state.members.find(m =>
        m.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.memberId?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (member) {
        setSelectedMember(member.id);
        setAdvice(lang === 'bn'
          ? 'সদস্য পাওয়া গেছে। বিশ্লেষণ করতে Analyze Data এ ক্লিক করুন।'
          : 'Member found. Click Analyze to get insights.');
      } else {
        setAdvice(lang === 'bn'
          ? 'সদস্য পাওয়া যায়নি। অনুগ্রহ করে ভিন্ন অনুসন্ধানী শব্দ চেষ্টা করুন।'
          : 'Member not found. Please try a different search term.');
      }
    } else if (selectedType === 'project' && searchQuery) {
      const project = state.projects.find(p =>
        p.title?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (project) {
        setSelectedProject(project.id);
        setAdvice(lang === 'bn'
          ? 'প্রজেক্ট পাওয়া গেছে। বিশ্লেষণ করতে Analyze Data এ ক্লিক করুন।'
          : 'Project found. Click Analyze to get insights.');
      } else {
        setAdvice(lang === 'bn'
          ? 'প্রজেক্ট পাওয়া যায়নি। অনুগ্রহ করে ভিন্ন অনুসন্ধানী শব্দ চেষ্টা করুন।'
          : 'Project not found. Please try a different search term.');
      }
    } else if (selectedType === 'fund' && searchQuery) {
      const fund = state.funds.find(f =>
        f.name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (fund) {
        setSelectedFund(fund.id);
        setAdvice(lang === 'bn'
          ? 'ফান্ড পাওয়া গেছে। বিশ্লেষণ করতে Analyze Data এ ক্লিক করুন।'
          : 'Fund found. Click Analyze to get insights.');
      } else {
        setAdvice(lang === 'bn'
          ? 'ফান্ড পাওয়া যায়নি। অনুগ্রহ করে ভিন্ন অনুসন্ধানী শব্দ চেষ্টা করুন।'
          : 'Fund not found. Please try a different search term.');
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] z-[100] bg-dark/80 backdrop-blur-3xl border-l border-white/10 shadow-[-50px_0_100px_rgba(0,0,0,0.5)] animate-in slide-in-from-right-full duration-500">
      <div className="p-6 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand rounded-2xl flex items-center justify-center text-dark shadow-2xl shadow-brand/20">
              <Brain size={20} strokeWidth={3} />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-tighter">AI Strategist</h2>
              <div className="relative mt-1">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg py-1 pl-2 pr-6 text-[9px] font-bold text-brand/80 focus:outline-none focus:border-brand/50 transition-colors cursor-pointer"
                >
                  {aiModels.map((model) => (
                    <option key={model.id} value={model.id} className="bg-dark text-white">
                      {model.name}
                    </option>
                  ))}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#BF3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-white/5 text-white/40 hover:text-brand transition-all rounded-xl">
            <X size={18} />
          </button>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="mb-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={selectedType === 'member' ? "Search member by name or ID..." :
                selectedType === 'project' ? "Search project..." :
                  selectedType === 'fund' ? "Search fund..." :
                    "Search anything..."}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-brand/50 transition-colors"
            />
          </div>
        </form>

        {/* Template Buttons */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => handleTemplateClick(template.id)}
              className={`p-3 rounded-2xl border transition-all flex flex-col items-center gap-1 ${selectedType === template.id
                  ? 'bg-brand/20 border-brand/50'
                  : 'bg-white/5 border-white/5 hover:border-brand/30'
                }`}
            >
              <template.icon size={18} className={template.color} />
              <span className="text-[8px] font-black text-white/60 uppercase tracking-tighter">{template.label}</span>
            </button>
          ))}
        </div>

        {/* Analyze Button */}
        <div className="mb-4">
          {/* Queue Status Indicator */}
          {isQueued && (
            <div className="mb-3 p-3 bg-brand/10 border border-brand/20 rounded-2xl flex items-center gap-3">
              <Loader2 className="animate-spin text-brand" size={16} />
              <div className="flex-1">
                <p className="text-[9px] font-black text-brand uppercase tracking-widest">
                  {lang === 'bn' ? 'লাইনে অপেক্ষা করুন' : 'QUEUED'}
                </p>
                <p className="text-[10px] font-bold text-brand/70">
                  {lang === 'bn'
                    ? `${queuePosition} টি অনুরোধ অপেক্ষা করছে...`
                    : `${queuePosition} request(s) waiting...`}
                </p>
              </div>
            </div>
          )}

          {/* Custom Instruction Input */}
          <div className="mb-3">
            <label className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-2 block">
              {lang === 'bn' ? 'কাস্টম নির্দেশনা (ঐচ্ছিক)' : 'Custom Instruction (Optional)'}
            </label>
            <textarea
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder={lang === 'bn'
                ? 'এআই-কে অতিরিক্ত নির্দেশনা দিন... যেমন: "বাংলায় উত্তর দিন", "শুধু ঝুঁকি বিশ্লেষণ করুন", "তুলনামূলক বিশ্লেষণ করুন"'
                : 'Add custom instructions for AI... e.g., "Respond in Bengali", "Focus on risks", "Compare with last month"'}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-brand/50 transition-colors resize-none h-20"
            />
          </div>

          <button
            onClick={fetchAdvice}
            disabled={isLoading}
            className="w-full py-4 bg-brand hover:bg-brand/90 disabled:bg-white/10 disabled:cursor-not-allowed text-dark font-black uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-3 shadow-lg shadow-brand/20"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={20} strokeWidth={3} />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <BarChart3 size={20} strokeWidth={3} />
                <span>Analyze Data</span>
              </>
            )}
          </button>
        </div>

        {/* Quick Select Dropdowns for specific types */}
        {(selectedType === 'member' || selectedType === 'project' || selectedType === 'fund') && (
          <div className="mb-4">
            {selectedType === 'member' && (
              <div className="relative">
                <select
                  value={selectedMember}
                  onChange={(e) => {
                    setSelectedMember(e.target.value);
                    if (e.target.value) {
                      setAdvice(lang === 'bn'
                        ? 'সদস্য নির্বাচন করা হয়েছে। বিশ্লেষণ করতে Analyze Data এ ক্লিক করুন।'
                        : 'Member selected. Click Analyze to get insights.');
                    } else {
                      setAdvice(lang === 'bn'
                        ? 'কোন সদস্য নির্বাচন করা হয়নি। অনুগ্রহ করে বিশ্লেষণের জন্য সদস্য নির্বাচন করুন।'
                        : 'No member selected. Please select a member to view analysis.');
                    }
                  }}
                  className="w-full bg-dark border border-white/20 rounded-2xl py-3 pl-4 pr-10 text-sm text-white focus:outline-none focus:border-brand/50 transition-colors cursor-pointer"
                >
                  <option value="" className="bg-dark text-white">Select a member...</option>
                  {state.members.map((m: any) => (
                    <option key={m.id} value={m.id} className="bg-dark text-white">{m.name}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#BF3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            )}
            {selectedType === 'project' && (
              <div className="relative">
                <select
                  value={selectedProject}
                  onChange={(e) => {
                    setSelectedProject(e.target.value);
                    if (e.target.value) {
                      setAdvice(lang === 'bn'
                        ? 'প্রজেক্ট নির্বাচন করা হয়েছে। বিশ্লেষণ করতে Analyze Data এ ক্লিক করুন।'
                        : 'Project selected. Click Analyze to get insights.');
                    } else {
                      setAdvice(lang === 'bn'
                        ? 'কোন প্রজেক্ট নির্বাচন করা হয়নি। অনুগ্রহ করে বিশ্লেষণের জন্য প্রজেক্ট নির্বাচন করুন।'
                        : 'No project selected. Please select a project to view analysis.');
                    }
                  }}
                  className="w-full bg-dark border border-white/20 rounded-2xl py-3 pl-4 pr-10 text-sm text-white focus:outline-none focus:border-brand/50 transition-colors cursor-pointer"
                >
                  <option value="" className="bg-dark text-white">Select a project...</option>
                  {state.projects.map((p: any) => (
                    <option key={p.id} value={p.id} className="bg-dark text-white">{p.title}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#BF3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            )}
            {selectedType === 'fund' && (
              <div className="relative">
                <select
                  value={selectedFund}
                  onChange={(e) => {
                    setSelectedFund(e.target.value);
                    if (e.target.value) {
                      setAdvice(lang === 'bn'
                        ? 'ফান্ড নির্বাচন করা হয়েছে। বিশ্লেষণ করতে Analyze Data এ ক্লিক করুন।'
                        : 'Fund selected. Click Analyze to get insights.');
                    } else {
                      setAdvice(lang === 'bn'
                        ? 'কোন ফান্ড নির্বাচন করা হয়নি। অনুগ্রহ করে বিশ্লেষণের জন্য ফান্ড নির্বাচন করুন।'
                        : 'No fund selected. Please select a fund to view analysis.');
                    }
                  }}
                  className="w-full bg-dark border border-white/20 rounded-2xl py-3 pl-4 pr-10 text-sm text-white focus:outline-none focus:border-brand/50 transition-colors cursor-pointer"
                >
                  <option value="" className="bg-dark text-white">Select a fund...</option>
                  {state.funds.map((f: any) => (
                    <option key={f.id} value={f.id} className="bg-dark text-white">{f.name}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#BF3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Analysis Output */}
        <div className="flex-1 overflow-y-auto space-y-4 no-scrollbar">
          <div className="bg-brand/10 border border-brand/20 p-6 rounded-[2rem] relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-12 bg-brand/5 rounded-full -mr-6 -mt-6 blur-2xl group-hover:scale-150 transition-transform duration-1000"></div>
            <p className="text-[9px] font-black text-brand uppercase tracking-[0.4em] mb-3">
              {selectedType === 'overview' && 'STRATEGIC PULSE'}
              {selectedType === 'member' && 'MEMBER ANALYSIS'}
              {selectedType === 'project' && 'PROJECT ANALYSIS'}
              {selectedType === 'fund' && 'FUND ANALYSIS'}
              {selectedType === 'deposits' && 'DEPOSIT TRENDS'}
              {selectedType === 'expenses' && 'EXPENSE ANALYSIS'}
              {selectedType === 'risk' && 'RISK ASSESSMENT'}
              {selectedType === 'trends' && 'TREND ANALYSIS'}
            </p>
            {isLoading ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <Loader2 className="animate-spin text-brand" size={32} />
                <p className="text-[10px] font-black text-brand/60 uppercase tracking-widest animate-pulse">Analyzing Data...</p>
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto no-scrollbar pr-2">
                <AIResponseRenderer content={advice || "Select a template and click Analyze to get AI-powered insights."} />
              </div>
            )}
          </div>

          {/* Quick Metrics - Dynamic based on selected type */}
          <div className="p-6 bg-dark rounded-[2rem] border border-white/5">
            <h3 className="text-[10px] font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-brand" />
              {selectedType === 'overview' && 'OVERVIEW METRICS'}
              {selectedType === 'member' && 'MEMBER METRICS'}
              {selectedType === 'project' && 'PROJECT METRICS'}
              {selectedType === 'fund' && 'FUND METRICS'}
              {selectedType === 'deposits' && 'DEPOSIT METRICS'}
              {selectedType === 'expenses' && 'EXPENSE METRICS'}
              {selectedType === 'risk' && 'RISK INDICATORS'}
              {selectedType === 'trends' && 'TREND METRICS'}
            </h3>
            <div className="space-y-4">
              {/* Overview Metrics */}
              {selectedType === 'overview' && [
                { label: "Total Funds", val: `BDT ${(state.funds.reduce((acc: number, f: any) => acc + f.balance, 0) / 1000000).toFixed(1)}M`, fill: "75%" },
                { label: "Active Projects", val: state.projects.filter((p: any) => p.status === 'In Progress').length.toString(), fill: "60%" },
                { label: "Total Members", val: state.members.length.toString(), fill: "80%" },
                { label: "Net Position", val: `BDT ${(state.deposits.reduce((acc: number, d: any) => acc + d.amount, 0) - state.expenses.reduce((acc: number, e: any) => acc + e.amount, 0)) / 1000000}M`, fill: "50%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[8px] font-black uppercase text-white/30 mb-1.5">
                    <span>{m.label}</span>
                    <span className="text-brand">{m.val}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand shadow-[0_0_10px_rgba(191,243,0,0.5)]" style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}

              {/* Member Metrics */}
              {selectedType === 'member' && [
                { label: "Selected Member", val: selectedMember ? state.members.find((m: any) => m.id === selectedMember)?.name?.split(' ')[0] || 'N/A' : 'None', fill: "100%" },
                { label: "Total Contribution", val: `BDT ${(state.deposits.filter((d: any) => d.memberId === selectedMember).reduce((acc: number, d: any) => acc + d.amount, 0) / 1000).toFixed(0)}K`, fill: "85%" },
                { label: "Total Deposits", val: state.deposits.filter((d: any) => d.memberId === selectedMember).length.toString(), fill: "70%" },
                { label: "Shares Held", val: (state.members.find((m: any) => m.id === selectedMember)?.shares || 0).toString(), fill: "60%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[8px] font-black uppercase text-white/30 mb-1.5">
                    <span>{m.label}</span>
                    <span className="text-brand">{m.val}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand shadow-[0_0_10px_rgba(191,243,0,0.5)]" style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}

              {/* Project Metrics */}
              {selectedType === 'project' && [
                { label: "Selected Project", val: selectedProject ? state.projects.find((p: any) => p.id === selectedProject)?.title?.substring(0, 15) || 'N/A' : 'None', fill: "100%" },
                { label: "Budget Used", val: (() => {
                  const project = state.projects.find((p: any) => p.id === selectedProject);
                  const spent = state.expenses.filter((e: any) => e.projectId === selectedProject).reduce((acc: number, e: any) => acc + e.amount, 0);
                  return project?.budget ? `${((spent / project.budget) * 100).toFixed(0)}%` : 'N/A';
                })(), fill: "65%" },
                { label: "Total Spent", val: `BDT ${(state.expenses.filter((e: any) => e.projectId === selectedProject).reduce((acc: number, e: any) => acc + e.amount, 0) / 1000).toFixed(0)}K`, fill: "75%" },
                { label: "Transactions", val: state.expenses.filter((e: any) => e.projectId === selectedProject).length.toString(), fill: "50%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[8px] font-black uppercase text-white/30 mb-1.5">
                    <span>{m.label}</span>
                    <span className="text-brand">{m.val}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand shadow-[0_0_10px_rgba(191,243,0,0.5)]" style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}

              {/* Fund Metrics */}
              {selectedType === 'fund' && [
                { label: "Selected Fund", val: selectedFund ? state.funds.find((f: any) => f.id === selectedFund)?.name?.substring(0, 15) || 'N/A' : 'None', fill: "100%" },
                { label: "Current Balance", val: `BDT ${(state.funds.find((f: any) => f.id === selectedFund)?.balance || 0) / 1000}K`, fill: "80%" },
                { label: "Fund Type", val: state.funds.find((f: any) => f.id === selectedFund)?.type || 'N/A', fill: "50%" },
                { label: "Initial Balance", val: `BDT ${(state.funds.find((f: any) => f.id === selectedFund)?.initialBalance || 0) / 1000}K`, fill: "60%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[8px] font-black uppercase text-white/30 mb-1.5">
                    <span>{m.label}</span>
                    <span className="text-brand">{m.val}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand shadow-[0_0_10px_rgba(191,243,0,0.5)]" style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}

              {/* Deposit Metrics */}
              {selectedType === 'deposits' && [
                { label: "Total Deposits", val: `BDT ${(state.deposits.reduce((acc: number, d: any) => acc + d.amount, 0) / 1000000).toFixed(1)}M`, fill: "90%" },
                { label: "Deposit Count", val: state.deposits.length.toString(), fill: "70%" },
                { label: "Avg per Deposit", val: `BDT ${(state.deposits.reduce((acc: number, d: any) => acc + d.amount, 0) / (state.deposits.length || 1)).toFixed(0)}`, fill: "60%" },
                { label: "Active Contributors", val: [...new Set(state.deposits.map((d: any) => d.memberId))].length.toString(), fill: "75%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[8px] font-black uppercase text-white/30 mb-1.5">
                    <span>{m.label}</span>
                    <span className="text-brand">{m.val}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand shadow-[0_0_10px_rgba(191,243,0,0.5)]" style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}

              {/* Expense Metrics */}
              {selectedType === 'expenses' && [
                { label: "Total Expenses", val: `BDT ${(state.expenses.reduce((acc: number, e: any) => acc + e.amount, 0) / 1000000).toFixed(1)}M`, fill: "85%" },
                { label: "Expense Count", val: state.expenses.length.toString(), fill: "65%" },
                { label: "Avg per Expense", val: `BDT ${(state.expenses.reduce((acc: number, e: any) => acc + e.amount, 0) / (state.expenses.length || 1)).toFixed(0)}`, fill: "55%" },
                { label: "Categories Used", val: [...new Set(state.expenses.map((e: any) => e.category))].length.toString(), fill: "70%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[8px] font-black uppercase text-white/30 mb-1.5">
                    <span>{m.label}</span>
                    <span className="text-brand">{m.val}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand shadow-[0_0_10px_rgba(191,243,0,0.5)]" style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}

              {/* Risk Metrics */}
              {selectedType === 'risk' && [
                { label: "Low Balance Funds", val: state.funds.filter((f: any) => f.balance < 100000).length.toString(), fill: "40%" },
                { label: "Over-Budget Projects", val: state.projects.filter((p: any) => {
                  const spent = state.expenses.filter((e: any) => e.projectId === p.id).reduce((acc: number, e: any) => acc + e.amount, 0);
                  return p.budget && spent > p.budget;
                }).length.toString(), fill: "30%" },
                { label: "Inactive Members", val: state.members.filter((m: any) => !state.deposits.some((d: any) => d.memberId === m.id)).length.toString(), fill: "35%" },
                { label: "High Expenses", val: state.expenses.filter((e: any) => e.amount > 50000).length.toString(), fill: "45%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[8px] font-black uppercase text-white/30 mb-1.5">
                    <span>{m.label}</span>
                    <span className={`${parseFloat(m.val) > 0 ? 'text-orange-400' : 'text-brand'}`}>{m.val}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full shadow-[0_0_10px_rgba(255,165,0,0.5)] ${parseFloat(m.val) > 0 ? 'bg-orange-500' : 'bg-brand'}`} style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}

              {/* Trend Metrics */}
              {selectedType === 'trends' && [
                { label: "Net Cash Flow", val: `BDT ${(state.deposits.reduce((acc: number, d: any) => acc + d.amount, 0) - state.expenses.reduce((acc: number, e: any) => acc + e.amount, 0)) / 1000}K`, fill: "70%" },
                { label: "Savings Rate", val: `${state.deposits.length > 0 ? (((state.deposits.reduce((acc: number, d: any) => acc + d.amount, 0) - state.expenses.reduce((acc: number, e: any) => acc + e.amount, 0)) / state.deposits.reduce((acc: number, d: any) => acc + d.amount, 0)) * 100).toFixed(1) : 0}%`, fill: "60%" },
                { label: "Deposit Velocity", val: `+${state.deposits.length} txns`, fill: "75%" },
                { label: "Expense Ratio", val: `${state.deposits.length > 0 ? ((state.expenses.reduce((acc: number, e: any) => acc + e.amount, 0) / state.deposits.reduce((acc: number, d: any) => acc + d.amount, 0)) * 100).toFixed(0) : 0}%`, fill: "50%" }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[8px] font-black uppercase text-white/30 mb-1.5">
                    <span>{m.label}</span>
                    <span className="text-brand">{m.val}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-brand shadow-[0_0_10px_rgba(191,243,0,0.5)]" style={{ width: m.fill }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-[8px] font-black text-white/20 uppercase tracking-[0.5em] text-center">Powered by Investwise AI Engine</p>
        </div>
      </div>
    </div>
  );
};

export default AIAdvisorSidebar;
