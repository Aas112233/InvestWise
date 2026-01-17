
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus, MoreHorizontal, Briefcase, Users, Calendar, ArrowUpRight,
  ArrowDownLeft, Filter, Search, X, CheckCircle2, TrendingUp,
  TrendingDown, DollarSign, PieChart as PieChartIcon, Activity,
  Edit2, Trash2, CheckCircle, Clock, AlertTriangle, RefreshCw, Info
} from 'lucide-react';
import { Project, Member, ProjectMemberParticipation, Transaction, ProjectUpdateRecord, AccessLevel, AppScreen } from '../types';
import ActionDialog, { ActionDialogProps } from './ActionDialog';
import Toast, { ToastType } from './Toast';
import { useNavigate } from 'react-router-dom';
import { useGlobalState } from '../context/GlobalStateContext';
import ExportMenu from './ExportMenu';
import { formatCurrency } from '../utils/formatters';
import { Language, t } from '../i18n/translations';

const SHARE_VALUE = 1000;

type TabType = 'Portfolio' | 'Capital Flow' | 'Ops Update' | 'Performance';

interface ProjectManagementProps {
  lang: Language;
}

const ProjectManagement: React.FC<ProjectManagementProps> = ({ lang }) => {
  const navigate = useNavigate();
  const {
    projects: globalProjects,
    members: globalMembers,
    addProject,
    updateProject,
    addProjectUpdate,
    deleteProject,
    refreshProjects,
    currentUser
  } = useGlobalState();

  const activeMembers = globalMembers.filter(m => m.status === 'active');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshProjects();
    setTimeout(() => setRefreshing(false), 500);
  };
  const [activeTab, setActiveTab] = useState<TabType>('Portfolio');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Dialog State
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: ActionDialogProps['type'];
    title: string;
    message: string;
    details?: { label: string; value: string | number }[];
    onConfirm: () => void;
  }>({
    isOpen: false,
    type: 'confirm',
    title: '',
    message: '',
    onConfirm: () => { },
  });

  const closeDialog = () => setDialog(prev => ({ ...prev, isOpen: false }));

  // Set default selected project
  useEffect(() => {
    if (globalProjects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(globalProjects[0].id);
    }
  }, [globalProjects, selectedProjectId]);

  const menuRef = useRef<HTMLDivElement>(null);

  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Form State for New Project
  const [newProject, setNewProject] = useState({
    title: '',
    category: 'Real Estate',
    description: '',
    budget: '',
    expectedRoi: '',
    health: 'Stable' as 'Stable' | 'At Risk' | 'Critical',
    startDate: new Date().toISOString().split('T')[0],
    projectFundHandler: '',
  });

  const [participationList, setParticipationList] = useState<ProjectMemberParticipation[]>([]);
  const [tempMemberId, setTempMemberId] = useState('');

  // Update tempMemberId and projectFundHandler when global state loads
  useEffect(() => {
    if (activeMembers.length > 0 && !tempMemberId) {
      setTempMemberId(activeMembers[0].id || activeMembers[0].memberId);
    }
    // Set default fund handler to current user or first member
    if (activeMembers.length > 0 && !newProject.projectFundHandler) {
      setNewProject(prev => ({ ...prev, projectFundHandler: activeMembers[0].name }));
    }
  }, [activeMembers]);

  const [tempShares, setTempShares] = useState('10');
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  // Form State for Updates
  const [updateForm, setUpdateForm] = useState({
    projectId: '',
    type: 'Earning' as 'Earning' | 'Expense',
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
  });

  // Initialize updateForm.projectId
  useEffect(() => {
    if (globalProjects.length > 0 && !updateForm.projectId) {
      setUpdateForm(prev => ({ ...prev, projectId: globalProjects[0].id }));
    }
  }, [globalProjects]);

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const handleAddParticipation = () => {
    // Determine which ID property to match. The dropdown values use `m.id`.
    const member = activeMembers.find(m => m.id === tempMemberId || m.memberId === tempMemberId);
    if (!member) return;

    if (participationList.find(p => p.memberId === member.memberId)) {
      showNotification("Member already participating in this project.", "error");
      return;
    }

    setParticipationList([...participationList, {
      memberId: member.memberId, // Store readable memberId or unique ID? Type says memberId.
      memberName: member.name,
      sharesInvested: parseInt(tempShares)
    }]);
  };

  const executeCreateProject = () => {
    const totalShares = participationList.reduce((acc, p) => acc + p.sharesInvested, 0);
    const initialInvestment = totalShares * SHARE_VALUE;

    const project: Project = {
      id: '', // Backend will assign
      ...newProject,
      budget: parseFloat(newProject.budget) || initialInvestment,
      expectedRoi: parseFloat(newProject.expectedRoi) || 0,
      totalShares,
      initialInvestment,
      involvedMembers: participationList,
      status: 'In Progress',
      currentFundBalance: initialInvestment,
      totalEarnings: 0,
      totalExpenses: 0,
      updates: []
    };

    addProject(project);
    setIsModalOpen(false);
    showNotification(`Project "${project.title}" created. BDT ${initialInvestment.toLocaleString()} moved to project fund.`);
    closeDialog();

    // Reset
    setNewProject({
      title: '',
      category: 'Real Estate',
      description: '',
      budget: '',
      expectedRoi: '',
      health: 'Stable',
      startDate: new Date().toISOString().split('T')[0],
      projectFundHandler: activeMembers[0]?.name || '',
    });
    setParticipationList([]);
  };

  const handleReviewCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (participationList.length === 0) {
      showNotification("Please add at least one participating member.", "error");
      return;
    }
    const totalShares = participationList.reduce((acc, p) => acc + p.sharesInvested, 0);

    setDialog({
      isOpen: true,
      type: 'review',
      title: 'Launch Venture?',
      message: 'You are about to launch a new venture. This will deduct the initial investment from the Primary Fund.',
      details: [
        { label: 'Project', value: newProject.title },
        { label: 'Category', value: newProject.category },
        { label: 'Initial Capital', value: `BDT ${(totalShares * SHARE_VALUE).toLocaleString()}` },
        { label: 'Fund Handler', value: newProject.projectFundHandler },
        { label: 'Stakeholders', value: participationList.length }
      ],
      onConfirm: executeCreateProject
    });
  };

  const executeProjectUpdate = () => {
    const amount = parseFloat(updateForm.amount);
    addProjectUpdate(updateForm.projectId, {
      type: updateForm.type,
      amount,
      description: updateForm.description
    });

    showNotification(`${updateForm.type} of BDT ${amount.toLocaleString()} recorded for project.`);
    setUpdateForm({ ...updateForm, amount: '', description: '' });
    setIsUpdateModalOpen(false);
    closeDialog();
  };

  const handleReviewUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(updateForm.amount);
    if (!amount || amount <= 0) {
      showNotification("Enter a valid amount.", "error");
      return;
    }

    const project = globalProjects.find(p => p.id === updateForm.projectId);

    setDialog({
      isOpen: true,
      type: 'review',
      title: 'Authorize Ledger Entry',
      message: 'Confirm this financial event to be recorded in the immutable ledger.',
      details: [
        { label: 'Project', value: project?.title || 'Unknown' },
        { label: 'Type', value: updateForm.type },
        { label: 'Volume', value: `BDT ${amount.toLocaleString()}` },
        { label: 'Reason', value: updateForm.description }
      ],
      onConfirm: executeProjectUpdate
    });
  };

  const handleStatusChange = (project: Project, newStatus: Project['status']) => {
    updateProject({ ...project, status: newStatus });
    showNotification(`Project status updated to ${newStatus}.`);
    setOpenMenuId(null);
  };

  const executeDeleteProject = async (projectId: string) => {
    try {
      await deleteProject(projectId);
      showNotification("Project successfully removed from active portfolio.");
      closeDialog();
    } catch (error: any) {
      // Logic for error display is already partially handled by GlobalStateContext's lastError,
      // but we show a specific notification here for immediate feedback.
      showNotification(error.message || "Termination failed. Ensure liquidity is zero and records are clear.", "error");
    }
  };

  const handleDeleteClick = (projectId: string) => {
    setDialog({
      isOpen: true,
      type: 'delete',
      title: 'Confirm Termination',
      message: 'Are you sure you want to terminate this project? Ensure all financial assets have been liquidated or transferred. This action is irreversible.',
      onConfirm: () => executeDeleteProject(projectId)
    });
    setOpenMenuId(null);
  };

  // Derived Analytics Data
  const selectedProject = useMemo(() =>
    globalProjects.find(p => p.id === selectedProjectId), [globalProjects, selectedProjectId]
  );

  const analytics = useMemo(() => {
    if (!selectedProject) return null;

    // Prefer pre-aggregated fields from backend for enterprise accuracy
    const totalEarnings = selectedProject.totalEarnings || selectedProject.updates
      .filter(u => u.type === 'Earning')
      .reduce((acc, curr) => acc + curr.amount, 0);

    const totalExpenses = selectedProject.totalExpenses || selectedProject.updates
      .filter(u => u.type === 'Expense')
      .reduce((acc, curr) => acc + curr.amount, 0);

    const netProfit = totalEarnings - totalExpenses;
    const roi = selectedProject.initialInvestment > 0
      ? (netProfit / selectedProject.initialInvestment) * 100
      : 0;

    return { totalEarnings, totalExpenses, profit: netProfit, roi };
  }, [selectedProject]);

  const getStatusColor = (status: Project['status'], health?: Project['health']) => {
    if (health === 'Critical') return 'text-rose-500 bg-rose-500/10';
    if (health === 'At Risk') return 'text-amber-500 bg-amber-500/10';

    switch (status) {
      case 'Completed': return 'text-emerald-500 bg-emerald-500/10';
      case 'Review': return 'text-amber-500 bg-amber-500/10';
      default: return 'text-brand bg-dark/80 dark:bg-brand/10';
    }
  };

  const getStatusIcon = (status: Project['status'], health?: Project['health']) => {
    if (health === 'Critical' || health === 'At Risk') return <AlertTriangle size={12} />;

    switch (status) {
      case 'Completed': return <CheckCircle2 size={12} />;
      case 'Review': return <AlertTriangle size={12} />;
      default: return <Clock size={12} />;
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
            <span className="text-brand">{t('nav.projectMgmt', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.projectMgmt', lang)}</h1>
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
            data={globalProjects}
            columns={[
              { header: 'ID', key: 'id' },
              { header: 'Title', key: 'title' },
              { header: 'Status', key: 'status' },
              { header: 'Budget', key: 'budget', format: (p: any) => formatCurrency(p.budget) },
              { header: 'Expected ROI', key: 'expectedRoi', format: (p: any) => `${p.expectedRoi}%` },
              { header: 'Start Date', key: 'startDate' }
            ]}
            fileName={`projects_${new Date().toISOString().split('T')[0]}`}
            title="Project Portfolio Report"
            targetId="projects-snapshot-target"
          />
          {currentUser?.permissions[AppScreen.PROJECT_MANAGEMENT] === AccessLevel.WRITE && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20 active:scale-95"
            >
              <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div id="projects-snapshot-target" className="space-y-10">
        <div className="flex gap-4 p-2 bg-white/50 dark:bg-white/5 rounded-[2.5rem] backdrop-blur-xl border border-gray-100 dark:border-white/5 max-w-fit">
          {(['Portfolio', 'Capital Flow', 'Ops Update', 'Performance'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab
                ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-xl'
                : 'text-gray-500 hover:text-dark dark:hover:text-white'
                }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <main className="min-h-[500px]">
          {activeTab === 'Portfolio' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {globalProjects.map(project => (
                <div key={project.id} className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] card-shadow border border-gray-50 dark:border-white/5 transition-all hover:-translate-y-2 group relative">
                  <div className="flex justify-between items-start mb-8">
                    <div className="flex gap-2">
                      <span className={`text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest flex items-center gap-1.5 ${getStatusColor(project.status, project.health)}`}>
                        {getStatusIcon(project.status, project.health)}
                        {project.status}
                      </span>
                      {project.health !== 'Stable' && (
                        <span className={`text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest flex items-center gap-1.5 ${project.health === 'Critical' ? 'bg-rose-500/20 text-rose-500' : 'bg-amber-500/20 text-amber-500'}`}>
                          {project.health}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === project.id ? null : project.id)}
                        className="text-gray-300 hover:text-dark dark:hover:text-brand p-2 rounded-xl transition-all hover:bg-gray-50 dark:hover:bg-white/5"
                      >
                        <MoreHorizontal size={24} />
                      </button>
                      {openMenuId === project.id && (
                        <div ref={menuRef} className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-dark rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 z-20 overflow-hidden animate-in slide-in-from-top-2 duration-200">
                          <div className="p-2 space-y-1">
                            {currentUser?.permissions[AppScreen.PROJECT_MANAGEMENT] === AccessLevel.WRITE && (
                              <>
                                <button onClick={() => handleStatusChange(project, 'Completed')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-xs font-bold text-emerald-600 transition-all">
                                  <CheckCircle size={14} /> Mark Completed
                                </button>
                                <button onClick={() => handleStatusChange(project, 'Review')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-500/10 text-xs font-bold text-amber-600 transition-all">
                                  <AlertTriangle size={14} /> Send for Review
                                </button>
                                <button onClick={() => handleStatusChange(project, 'In Progress')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-brand/10 text-xs font-bold text-dark dark:text-brand transition-all">
                                  <Clock size={14} /> Reactivate
                                </button>
                              </>
                            )}
                            {currentUser?.permissions[AppScreen.DIVIDENDS] === AccessLevel.WRITE && (
                              <button onClick={() => navigate(`/dividends?projectId=${project.id}`)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-brand/10 text-xs font-bold text-dark dark:text-brand transition-all">
                                <TrendingUp size={14} /> Profit Settlement
                              </button>
                            )}
                            {currentUser?.permissions[AppScreen.PROJECT_MANAGEMENT] === AccessLevel.WRITE && (
                              <>
                                <div className="h-px bg-gray-100 dark:bg-white/5 my-1" />
                                <button onClick={() => handleDeleteClick(project.id)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-500/10 text-xs font-bold text-rose-600 transition-all">
                                  <Trash2 size={14} /> Delete Project
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{project.category}</p>
                    <h3 className="text-3xl font-black text-dark dark:text-white mb-2 leading-[0.9] tracking-tighter group-hover:text-brand transition-colors">{project.title}</h3>
                  </div>

                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-8 line-clamp-2 leading-relaxed">{project.description}</p>

                  <div className="space-y-8">
                    <div className="flex items-center justify-between p-6 bg-gray-50 dark:bg-[#111814] rounded-[2.5rem] border border-gray-100 dark:border-white/5 transition-all group-hover:bg-brand group-hover:border-brand shadow-inner">
                      <div>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 group-hover:text-dark/60">Current Allocation</p>
                        <p className={`font-black text-dark dark:text-white group-hover:text-dark tracking-tighter transition-colors flex-wrap ${formatCurrency(project.currentFundBalance).length > 14 ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl'}`}>
                          {formatCurrency(project.currentFundBalance)}
                        </p>
                      </div>
                      <Briefcase className="text-gray-300 dark:text-gray-700 group-hover:text-dark/40 transition-colors" size={32} />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex -space-x-3">
                          {(project.involvedMembers || []).slice(0, 3).map((m, i) => {
                            const currentMember = activeMembers.find(mem => mem.memberId === m.memberId);
                            const displayName = currentMember?.name || m.memberName;
                            return (
                              <div key={`${m.memberId || i}-${i}`} className="w-9 h-9 rounded-full border-2 border-white dark:border-[#1A221D] bg-dark flex items-center justify-center text-[9px] font-black text-brand shadow-lg" title={displayName}>
                                {displayName?.[0] || '?'}
                              </div>
                            );
                          })}
                          {(project.involvedMembers || []).length > 3 && (
                            <div className="w-9 h-9 rounded-full border-2 border-white dark:border-[#1A221D] bg-gray-100 dark:bg-white/5 flex items-center justify-center text-[9px] font-black dark:text-white shadow-lg">
                              +{(project.involvedMembers || []).length - 3}
                            </div>
                          )}
                        </div>
                        <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Equity Stake</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Growth</p>
                        <div className="flex items-center gap-1 text-emerald-500 font-black text-xs">
                          {project.initialInvestment > 0 ? (
                            <> <TrendingUp size={12} /> {((project.currentFundBalance / project.initialInvestment - 1) * 100).toFixed(1)}% </>
                          ) : (
                            <span>N/A</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {globalProjects.length === 0 && (
                <div className="col-span-full h-96 flex flex-col items-center justify-center text-center p-10 bg-white/5 border border-dashed border-gray-300 dark:border-white/10 rounded-[4rem]">
                  <Briefcase size={48} className="text-gray-400 mb-4 opacity-50" />
                  <h3 className="text-xl font-black text-gray-500">No Projects Found</h3>
                  <p className="text-xs text-gray-400 mt-2">Launch a new venture to get started.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'Capital Flow' && (
            <div className="bg-white dark:bg-[#1A221D] rounded-[4rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5 animate-in slide-in-from-bottom-4 duration-500">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-white/5">
                      <th className="px-12 py-8 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest">Financial Event</th>
                      <th className="px-12 py-8 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest">Date</th>
                      <th className="px-12 py-8 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest">Strategic Venture</th>
                      <th className="px-12 py-8 text-right text-[11px] font-black text-gray-500 uppercase tracking-widest">Debit/Credit (BDT)</th>
                      <th className="px-12 py-8 text-right text-[11px] font-black text-gray-500 uppercase tracking-widest">Audit Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                    {globalProjects.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                        <td className="px-12 py-8">
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-brand/10 text-brand rounded-2xl group-hover:scale-110 transition-transform"><ArrowUpRight size={18} strokeWidth={3} /></div>
                            <div>
                              <p className="font-black text-dark dark:text-white text-sm uppercase group-hover:text-brand transition-colors">Capital Injection</p>
                              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Token: {p.id.substring(0, 8)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-12 py-8 text-xs font-bold text-gray-400">{new Date(p.startDate).toLocaleDateString()}</td>
                        <td className="px-12 py-8 font-black text-dark dark:text-white text-sm">{p.title}</td>
                        <td className="px-12 py-8 text-right font-black text-dark dark:text-white text-2xl tracking-tighter">-{formatCurrency(p.initialInvestment)}</td>
                        <td className="px-12 py-8 text-right">
                          <span className="px-5 py-2 bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest rounded-full border border-emerald-500/20">Verified Ledger</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'Ops Update' && (
            <div className="space-y-10 animate-in fade-in duration-500">
              <div className="flex items-center justify-between px-6">
                <div>
                  <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-2">Operational Ledger</h3>
                  <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Historical operation trail & financial event logging</p>
                </div>
                <button
                  onClick={() => setIsUpdateModalOpen(true)}
                  className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
                >
                  <Plus size={20} strokeWidth={3} /> Record Event
                </button>
              </div>

              <div className="bg-white dark:bg-[#1A221D] rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5 overflow-hidden flex flex-col">
                <div className="p-10 border-b border-gray-50 dark:border-white/5 flex items-center justify-between bg-gray-50/30 dark:bg-white/5">
                  <div className="flex items-center gap-4">
                    <div className="bg-brand p-4 rounded-2xl shadow-xl shadow-brand/20">
                      <Activity className="text-dark" size={24} strokeWidth={3} />
                    </div>
                    <div>
                      <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">Venture Activities</h4>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-2">Audit trail of all earnings and expenses</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto max-h-[700px] no-scrollbar">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50/50 dark:bg-white/5 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-white/10">
                        <th className="px-10 py-5">Venture Entity</th>
                        <th className="px-10 py-5">Event Detail</th>
                        <th className="px-10 py-5">Timestamp</th>
                        <th className="px-10 py-5 text-right">Ledger Impact</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                      {globalProjects.flatMap(p => p.updates.map(u => ({ ...u, projectTitle: p.title, projectId: p.id }))).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((update, idx) => (
                        <tr key={`${update.projectId}-${idx}`} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                          <td className="px-10 py-8 font-black text-xs dark:text-white group-hover:text-brand uppercase transition-colors">{update.projectTitle}</td>
                          <td className="px-10 py-8">
                            <p className="text-sm font-black dark:text-white uppercase leading-none mb-1">{update.description}</p>
                            <span className={`text-[9px] font-black uppercase tracking-widest ${update.type === 'Earning' ? 'text-emerald-500' : 'text-rose-500'}`}>{update.type}</span>
                          </td>
                          <td className="px-10 py-8 text-[11px] font-bold text-gray-400 font-mono tracking-tighter">{new Date(update.date).toLocaleDateString()}</td>
                          <td className={`px-10 py-8 text-right font-black text-xl tracking-tighter ${update.type === 'Earning' ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {update.type === 'Earning' ? '+' : '-'}{formatCurrency(update.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Performance' && (
            <div className="space-y-10 animate-in slide-in-from-bottom-8 duration-700">
              <div className="flex items-center gap-6 p-1 bg-white/50 dark:bg-white/5 rounded-[2.5rem] border border-gray-100 dark:border-white/5 max-w-fit mx-auto shadow-inner overflow-x-auto">
                {globalProjects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProjectId(p.id)}
                    className={`px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${selectedProjectId === p.id
                      ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-2xl scale-105'
                      : 'text-gray-500 hover:text-dark dark:hover:text-white'
                      }`}
                  >
                    {p.title}
                  </button>
                ))}
              </div>

              {selectedProject && analytics ? (
                <div className="animate-in slide-in-from-bottom-4 duration-500">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
                    <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] card-shadow border border-gray-50 dark:border-white/5 group hover:bg-dark dark:hover:bg-brand transition-all duration-500">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 group-hover:text-white/40 dark:group-hover:text-dark/40">Initial Investment</p>
                      <p className="text-4xl font-black text-dark dark:text-white tracking-tighter group-hover:text-white dark:group-hover:text-dark leading-none">{formatCurrency(selectedProject.initialInvestment)}</p>
                    </div>
                    <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] card-shadow border border-gray-50 dark:border-white/5 hover:border-emerald-500/30 transition-all">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Cumulative Revenue</p>
                      <p className="text-4xl font-black text-emerald-500 tracking-tighter leading-none">{formatCurrency(analytics.totalEarnings)}</p>
                    </div>
                    <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] card-shadow border border-gray-50 dark:border-white/5 hover:border-rose-500/30 transition-all">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Operating Overhead</p>
                      <p className="text-4xl font-black text-rose-500 tracking-tighter leading-none">{formatCurrency(analytics.totalExpenses)}</p>
                    </div>
                    <div className={`p-10 rounded-[4rem] card-shadow border transition-all duration-500 ${analytics.profit >= 0 ? 'bg-brand/10 border-brand text-dark dark:text-brand' : 'bg-rose-500/10 border-rose-500 text-rose-600'}`}>
                      <p className={`text-[10px] font-black uppercase tracking-widest mb-4 ${analytics.profit >= 0 ? 'text-brand' : 'text-rose-500'}`}>Performance Margin</p>
                      <div className="flex items-center justify-between">
                        <p className="text-5xl font-black tracking-tighter leading-none">{analytics.roi.toFixed(1)}%</p>
                        {analytics.profit >= 0 ? <TrendingUp size={40} strokeWidth={3} /> : <TrendingDown size={40} strokeWidth={3} />}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5">
                      <div className="flex items-center justify-between mb-10">
                        <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter flex items-center gap-4">
                          <Users className="text-brand" size={28} /> Equity Participation
                        </h4>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">BDT Breakdown</span>
                      </div>
                      <div className="space-y-6">
                        {selectedProject.involvedMembers.map((m) => {
                          const participationPercent = (m.sharesInvested / selectedProject.totalShares) * 100;
                          const partnerProfit = (analytics.profit * participationPercent) / 100;
                          return (
                            <div key={m.memberId} className="p-8 bg-gray-50 dark:bg-[#111814] rounded-[2.5rem] border border-gray-100 dark:border-white/5 flex items-center justify-between transition-all hover:translate-x-2 group">
                              <div>
                                <p className="font-black text-dark dark:text-white text-xl leading-none mb-1 group-hover:text-brand transition-colors">{m.memberName}</p>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{m.sharesInvested} Units Allocated ({participationPercent.toFixed(1)}%)</p>
                              </div>
                              <div className="text-right">
                                <p className={`text-2xl font-black tracking-tighter ${partnerProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  {partnerProfit >= 0 ? '+' : ''}{formatCurrency(partnerProfit)}
                                </p>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Net Entitlement</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-dark p-14 rounded-[4rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-32 bg-brand/5 rounded-full -mr-20 -mt-20 blur-3xl group-hover:scale-125 transition-transform duration-[2s]"></div>
                      <div className="absolute bottom-0 left-0 p-32 bg-brand/5 rounded-full -ml-20 -mb-20 blur-3xl"></div>

                      <div className="relative z-10 h-full flex flex-col justify-between">
                        <div>
                          <div className="inline-block px-5 py-2 bg-brand/10 border border-brand/20 rounded-full mb-8">
                            <p className="text-[10px] font-black text-brand uppercase tracking-[0.4em]">Venture Analytics v2.6</p>
                          </div>
                          <h4 className="text-5xl font-black text-white uppercase tracking-tighter leading-[0.8] mb-8">Strategic Intelligence Outlook</h4>
                          <p className="text-white/40 text-base font-medium leading-relaxed max-w-sm mb-12">
                            Performance tracking indicates that "{selectedProject.title}" is operating within {analytics.roi >= 15 ? 'optimal efficiency ranges' : 'standard fiscal parameters'}. Reserve capital is currently {selectedProject.currentFundBalance > selectedProject.initialInvestment * 0.2 ? 'sufficient' : 'strained'}.
                          </p>
                        </div>
                        <div className="pt-12 border-t border-white/10 flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">Liquid Venture Reserve</p>
                            <p className="text-4xl font-black text-white tracking-tighter leading-none">
                              {formatCurrency(selectedProject.currentFundBalance)}
                            </p>
                          </div>
                          <div className="w-20 h-20 rounded-[2.5rem] bg-brand flex items-center justify-center text-dark shadow-2xl shadow-brand/20 hover:scale-110 active:scale-95 transition-all cursor-pointer">
                            <PieChartIcon size={32} strokeWidth={3} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center p-10">
                  <p className="text-gray-400">Select a project to view performance analytics.</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* CREATE PROJECT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-dark/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white dark:bg-[#1A221D] w-full max-w-2xl rounded-[4rem] card-shadow overflow-y-auto max-h-[90vh] relative animate-in zoom-in-95 duration-300 border border-white/10 no-scrollbar">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-10 right-10 p-3 text-gray-400 hover:text-dark dark:hover:text-white transition-all"
            >
              <X size={28} />
            </button>
            <div className="p-10">
              <div className="mb-8">
                <h3 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-3">Venture Genesis</h3>
                <p className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.4em]">Asset Allocation & Member Integration</p>
              </div>

              <form onSubmit={handleReviewCreate} className="space-y-6">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Project Identifier</label>
                      <input
                        required type="text"
                        value={newProject.title}
                        onChange={e => setNewProject({ ...newProject, title: e.target.value })}
                        placeholder="e.g. Solar Farm Alpha"
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Sector Classification</label>
                      <select
                        value={newProject.category}
                        onChange={e => setNewProject({ ...newProject, category: e.target.value })}
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand appearance-none cursor-pointer"
                      >
                        {['Real Estate', 'Energy', 'Farming', 'Technology', 'Stocks'].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Planned Budget (BDT)</label>
                      <input
                        required type="number"
                        value={newProject.budget}
                        onChange={e => setNewProject({ ...newProject, budget: e.target.value })}
                        placeholder="0.00"
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Target ROI (%)</label>
                      <input
                        required type="number"
                        value={newProject.expectedRoi}
                        onChange={e => setNewProject({ ...newProject, expectedRoi: e.target.value })}
                        placeholder="e.g. 25"
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Strategic Objective</label>
                    <textarea
                      required
                      value={newProject.description}
                      onChange={e => setNewProject({ ...newProject, description: e.target.value })}
                      placeholder="Provide venture objectives..."
                      className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand h-24 resize-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Project Fund Handler</label>
                    <div className="relative">
                      <select
                        value={newProject.projectFundHandler}
                        onChange={e => setNewProject({ ...newProject, projectFundHandler: e.target.value })}
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand appearance-none cursor-pointer"
                      >
                        {activeMembers.map(m => <option key={m.id || m.memberId} value={m.name}>{m.name}</option>)}
                      </select>
                      <Users size={14} className="absolute right-5 top-1/2 -translate-y-1/2 text-brand pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Stakeholder Participation Builder */}
                <div className="p-6 rounded-[2rem] border border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#111814] transition-all">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-brand rounded-xl text-dark">
                      <Users size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-dark dark:text-brand">Stakeholder Participation</h4>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Partner Equity Builder</p>
                    </div>
                  </div>

                  <div className="flex gap-2 mb-4">
                    <select
                      value={tempMemberId}
                      onChange={e => setTempMemberId(e.target.value)}
                      className="flex-1 bg-white dark:bg-dark px-4 py-2.5 rounded-xl border-none outline-none text-xs font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand"
                    >
                      {activeMembers.map(m => <option key={m.id || m.memberId} value={m.id || m.memberId}>{m.name}</option>)}
                    </select>
                    <input
                      type="number"
                      value={tempShares}
                      onChange={e => setTempShares(e.target.value)}
                      placeholder="Units"
                      className="w-20 bg-white dark:bg-dark px-4 py-2.5 rounded-xl border-none outline-none text-xs font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand"
                    />
                    <button
                      type="button"
                      onClick={handleAddParticipation}
                      className="bg-brand text-dark px-6 py-2.5 rounded-xl font-black text-[10px] uppercase shadow-lg shadow-brand/10 hover:scale-105 active:scale-95 transition-all"
                    >
                      Add Stake
                    </button>
                  </div>

                  <div className="space-y-2 max-h-32 overflow-y-auto pr-2 no-scrollbar">
                    {participationList.map((p, idx) => (
                      <div key={p.memberId + idx} className="flex justify-between items-center p-3 bg-white dark:bg-dark/40 rounded-xl border border-gray-100 dark:border-white/5 animate-in slide-in-from-right-2 duration-300">
                        <span className="text-xs font-black text-dark dark:text-gray-200">
                          {activeMembers.find(m => m.memberId === p.memberId)?.name || p.memberName}
                        </span>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-black text-brand tracking-tighter">{p.sharesInvested} Units</span>
                          <button
                            type="button"
                            onClick={() => setParticipationList(participationList.filter((item) => item.memberId !== p.memberId))}
                            className="text-gray-400 hover:text-rose-500 transition-colors"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {participationList.length === 0 && (
                      <div className="bg-white/50 dark:bg-white/5 p-3 rounded-xl flex items-center justify-center gap-2">
                        <Info size={14} className="text-gray-400" />
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest italic">Pending partner allocation...</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-6 flex items-center justify-between border-t border-gray-100 dark:border-white/5">
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Vested Market Cap</p>
                    <p className="text-2xl font-black text-dark dark:text-brand tracking-tighter">
                      BDT {(participationList.reduce((acc, p) => acc + p.sharesInvested, 0) * SHARE_VALUE).toLocaleString()}
                    </p>
                  </div>
                  <button type="submit" className="bg-dark dark:bg-brand text-white dark:text-dark px-8 py-4 rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-xl hover:scale-105 transition-all">
                    Authorize Initiation
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* RECORD UPDATE MODAL */}
      {isUpdateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-dark/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white dark:bg-[#1A221D] w-full max-w-xl rounded-[4rem] card-shadow overflow-hidden relative animate-in zoom-in-95 duration-300 border border-white/10 no-scrollbar">
            <button
              onClick={() => setIsUpdateModalOpen(false)}
              className="absolute top-10 right-10 p-3 text-gray-400 hover:text-dark dark:hover:text-white transition-all"
            >
              <X size={28} />
            </button>
            <div className="p-10">
              <div className="mb-8">
                <h3 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-3">Ledger Event</h3>
                <p className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.4em]">Financial Event Reporting for Ventures</p>
              </div>

              <form onSubmit={handleReviewUpdate} className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Target Project</label>
                    <select
                      value={updateForm.projectId}
                      onChange={e => setUpdateForm({ ...updateForm, projectId: e.target.value })}
                      className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand appearance-none cursor-pointer"
                    >
                      {globalProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Entry Type</label>
                      <div className="relative">
                        <select
                          value={updateForm.type}
                          onChange={e => setUpdateForm({ ...updateForm, type: e.target.value as any })}
                          className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 pl-10 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand appearance-none cursor-pointer"
                        >
                          <option value="Earning">Earning (+)</option>
                          <option value="Expense">Expense (-)</option>
                        </select>
                        <TrendingUp size={14} className={`absolute left-4 top-1/2 -translate-y-1/2 ${updateForm.type === 'Earning' ? 'text-emerald-500' : 'text-rose-500'}`} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Volume (BDT)</label>
                      <input
                        required type="number"
                        value={updateForm.amount}
                        onChange={e => setUpdateForm({ ...updateForm, amount: e.target.value })}
                        placeholder="0.00"
                        className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Event Narrative</label>
                    <textarea
                      required
                      value={updateForm.description}
                      onChange={e => setUpdateForm({ ...updateForm, description: e.target.value })}
                      placeholder="Provide context for this operational record..."
                      className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-4 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand h-28 resize-none"
                    />
                  </div>
                </div>

                <div className="pt-6 flex items-center justify-between border-t border-gray-100 dark:border-white/5">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-xl ${updateForm.type === 'Earning' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                      <Activity size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Impact Status</p>
                      <p className={`text-sm font-black uppercase tracking-widest ${updateForm.type === 'Earning' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {updateForm.type === 'Earning' ? 'Capital Accrual' : 'Operating Cost'}
                      </p>
                    </div>
                  </div>
                  <button type="submit" className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-xl hover:scale-105 transition-all">
                    Authorize Entry
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      <ActionDialog
        isOpen={dialog.isOpen}
        type={dialog.type || 'confirm'}
        title={dialog.title}
        message={dialog.message}
        onConfirm={dialog.onConfirm}
        onClose={closeDialog}
        details={dialog.details}
      />
    </div>
  );
};

export default ProjectManagement;
