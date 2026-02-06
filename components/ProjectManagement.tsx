
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus, MoreHorizontal, Briefcase, Users, Calendar, ArrowUpRight,
  ArrowDownLeft, Filter, Search, X, CheckCircle2, TrendingUp,
  TrendingDown, DollarSign, PieChart as PieChartIcon, Activity,
  Edit2, Trash2, CheckCircle, Clock, AlertTriangle, RefreshCw, Info, Lock
} from 'lucide-react';
import { Project, Member, ProjectMemberParticipation, Transaction, ProjectUpdateRecord, AccessLevel, AppScreen } from '../types';
import ActionDialog, { ActionDialogProps } from './ActionDialog';
import Toast, { ToastType } from './Toast';
import { useNavigate } from 'react-router-dom';
import { useGlobalState } from '../context/GlobalStateContext';
import ExportMenu from './ExportMenu';
import { formatCurrency } from '../utils/formatters';
import { Language, t } from '../i18n/translations';
import Avatar from './Avatar';
import SearchBar from './SearchBar';
import Pagination from './Pagination';
import { projectService } from '../services/api';
import { ModalForm, FormInput, FormSelect, FormTextarea, FormLabel } from './ui/FormElements';
import PermissionGuard from './PermissionGuard';
import { usePermission } from '../hooks/usePermission';
import ProjectTransactionMaster from './ProjectTransactionMaster';

const SHARE_VALUE = 1000;

type TabType = 'Portfolio' | 'Capital Flow' | 'Project Transactions' | 'Performance';

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
    editProjectUpdate,
    deleteProjectUpdate,
    deleteProject,
    refreshProjects,
    currentUser
  } = useGlobalState();

  const activeMembers = globalMembers.filter(m => m.status === 'active');
  const hasWritePermission = usePermission(AppScreen.PROJECT_MANAGEMENT, AccessLevel.WRITE);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [paginatedProjects, setPaginatedProjects] = useState<{
    data: Project[];
    total: number;
    pages: number;
  }>({ data: [], total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPaginatedProjects = async (page: number, search: string, limit: number) => {
    setLoading(true);
    try {
      const result = await projectService.getAll({ page, limit, search });
      setPaginatedProjects({
        data: result.data.map((p: any) => ({ ...p, id: p._id || p.id })),
        total: result.total,
        pages: result.pages
      });
    } catch (err) {
      console.error('Failed to fetch paginated projects:', err);
      showNotification(t('projects.processError', lang), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPaginatedProjects(currentPage, searchQuery, rowsPerPage);
  }, [currentPage, searchQuery, rowsPerPage, globalProjects]); // Also refresh when globalProjects changes (after add/delete)

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPaginatedProjects(currentPage, searchQuery, rowsPerPage);
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
  const [isMasterTxModalOpen, setIsMasterTxModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

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

  const handleSubmitProject = async () => {
    setIsSubmitting(true);
    try {
      const totalShares = participationList.reduce((acc, p) => acc + p.sharesInvested, 0);
      const initialInvestment = totalShares * SHARE_VALUE;

      const projectData = {
        ...newProject,
        budget: parseFloat(newProject.budget) || initialInvestment,
        expectedRoi: parseFloat(newProject.expectedRoi) || 0,
        totalShares,
        initialInvestment,
        involvedMembers: participationList,
      };

      if (isEditMode && editingProjectId) {
        await updateProject({ ...projectData, id: editingProjectId } as any);
        showNotification(t('projects.updateSuccess', lang).replace('{type}', 'Project').replace('{amount}', projectData.title));
      } else {
        await addProject(projectData as any);
        showNotification(t('projects.createSuccess', lang).replace('{title}', projectData.title).replace('{amount}', initialInvestment.toLocaleString()));
      }

      setIsModalOpen(false);
      closeDialog();
      fetchPaginatedProjects(currentPage, searchQuery, rowsPerPage);

      // Reset
      resetForm();
    } catch (error: any) {
      showNotification(error.message || t('projects.processError', lang), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
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
    setIsEditMode(false);
    setEditingProjectId(null);
    setIsModalOpen(false);
  };

  const handleEditClick = (project: Project) => {
    setIsEditMode(true);
    setEditingProjectId(project.id);
    setNewProject({
      title: project.title,
      category: project.category,
      description: project.description,
      budget: project.budget.toString(),
      expectedRoi: project.expectedRoi.toString(),
      health: project.health,
      startDate: project.startDate.split('T')[0],
      projectFundHandler: project.projectFundHandler || '',
    });
    setParticipationList(project.involvedMembers || []);
    setIsModalOpen(true);
    setOpenMenuId(null);
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
      title: isEditMode ? t('common.edit', lang) : t('projects.launchConfirm', lang),
      message: isEditMode
        ? "Confirming project structural modifications. Ensure these changes align with your strategic roadmap."
        : t('projects.launchWarning', lang),
      details: [
        { label: t('projects.projectIdentifier', lang), value: newProject.title },
        { label: t('projects.sectorClassification', lang), value: t(`common.${catKeyMap[newProject.category] || 'realEstate'}`, lang) },
        { label: t('projects.plannedBudget', lang), value: `${t('common.bdt', lang)} ${(totalShares * SHARE_VALUE).toLocaleString()}` },
        { label: t('projects.fundHandler', lang), value: newProject.projectFundHandler },
        { label: t('projects.memberStakeholders', lang), value: participationList.length }
      ],
      onConfirm: handleSubmitProject
    });
  };

  // Removed handleEditUpdate as per instructions. Existing updates are for audit only.

  const handleDeleteUpdate = (update: any) => {
    setDialog({
      isOpen: true,
      title: "Delete Event Record",
      message: `Are you sure you want to delete this ${update.type}? This will reverse the financial impact on the project and fund.`,
      type: 'confirm',
      details: [
        { label: "Event", value: update.description },
        { label: "Amount", value: `BDT ${formatCurrency(update.amount)}` },
        { label: "Date", value: new Date(update.date).toLocaleDateString() }
      ],
      onConfirm: async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
          await deleteProjectUpdate(update.projectId, update._id || update.id);
          showNotification("Event record deleted and financials reversed", 'success');
          closeDialog();
        } catch (error: any) {
          showNotification(error.message || "Failed to delete update", 'error');
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  // Removed executeProjectUpdate and handleReviewUpdate as per instructions.

  const handleStatusChange = (project: Project, newStatus: Project['status']) => {
    updateProject({ ...project, status: newStatus });
    showNotification(t('projects.statusUpdated', lang).replace('{status}', newStatus));
    setOpenMenuId(null);
  };

  const executeDeleteProject = async (projectId: string) => {
    setIsSubmitting(true);
    try {
      await deleteProject(projectId);
      showNotification(t('projects.deleteSuccess', lang));
      closeDialog();
      fetchPaginatedProjects(currentPage, searchQuery, rowsPerPage);
    } catch (error: any) {
      // Logic for error display is already partially handled by GlobalStateContext's lastError,
      // but we show a specific notification here for immediate feedback.
      showNotification(error.message || "Termination failed. Ensure liquidity is zero and records are clear.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (projectId: string) => {
    setDialog({
      isOpen: true,
      type: 'delete',
      title: t('projects.confirmTermination', lang),
      message: `Caution: Terminating "${globalProjects.find(p => p.id === projectId)?.title}" will revert its Initial Investment liquidity back to the primary enterprise reserves. This action is irreversible once committed.`,
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

  const catKeyMap: Record<string, string> = {
    'Real Estate': 'realEstate',
    'Energy': 'energy',
    'Farming': 'farming',
    'Technology': 'technology',
    'Stocks': 'stocks'
  };

  const statusKeyMap: Record<string, string> = {
    'In Progress': 'inProgress',
    'Completed': 'completed',
    'Review': 'review'
  };

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
              { header: t('projects.projectIdentifier', lang), key: 'title' },
              { header: t('projects.auditStatus', lang), key: 'status' },
              { header: `${t('projects.plannedBudget', lang)} (BDT)`, key: 'budget', format: (p: any) => p.budget.toLocaleString() },
              { header: t('projects.performanceMargin', lang), key: 'expectedRoi', format: (p: any) => `${p.expectedRoi}%` },
              { header: t('projects.date', lang), key: 'startDate' }
            ]}
            fileName={`projects_${new Date().toISOString().split('T')[0]}`}
            title="Project Portfolio Report"
            lang={lang}
            targetId="projects-snapshot-target"
          />
          <PermissionGuard screen={AppScreen.PROJECT_MANAGEMENT} requiredLevel={AccessLevel.WRITE}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20 active:scale-95"
              >
                <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
              </button>
            </div>
          </PermissionGuard>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div id="projects-snapshot-target" className="space-y-10">
        <div className="bg-white/50 dark:bg-white/5 rounded-[2.5rem] p-2 backdrop-blur-xl border border-gray-100 dark:border-white/5 flex items-center gap-6 justify-between mb-8">
          <div className="flex gap-4">
            {(['Portfolio', 'Capital Flow', 'Project Transactions', 'Performance'] as TabType[]).map((tab) => {
              const tabKey = tab.split(' ').map((word, i) => i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab
                    ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-xl'
                    : 'text-gray-500 hover:text-dark dark:hover:text-white'
                    }`}
                >
                  {t(`projects.${tabKey}`, lang)}
                </button>
              );
            })}
          </div>

          <div className="pr-4 hidden md:block">
            <SearchBar
              onSearch={(q) => {
                setSearchQuery(q);
                setCurrentPage(1);
              }}
              placeholder={t('members.filterPlaceholder', lang)}
            />
          </div>
        </div>

        {/* Tab Content */}
        <main className="min-h-[500px]">
          {activeTab === 'Portfolio' && (
            <div className="space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {loading ? (
                  <div className="col-span-full h-96 flex flex-col items-center justify-center text-center p-10">
                    <RefreshCw className="animate-spin text-brand mb-4" size={48} strokeWidth={3} />
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Scanning Portfolio...</p>
                  </div>
                ) : paginatedProjects.data.length === 0 ? (
                  <div className="col-span-full h-96 flex flex-col items-center justify-center text-center p-10 bg-white/5 border border-dashed border-gray-300 dark:border-white/10 rounded-[4rem]">
                    <Briefcase size={48} className="text-gray-400 mb-4 opacity-50" />
                    <h3 className="text-xl font-black text-gray-500">{t('projects.noProjects', lang)}</h3>
                    <p className="text-xs text-gray-400 mt-2">Try adjusting your search filters</p>
                  </div>
                ) : (
                  paginatedProjects.data.map(project => (
                    <div key={project.id} className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] card-shadow border border-gray-50 dark:border-white/5 transition-all hover:-translate-y-2 group relative">
                      <div className="flex justify-between items-start mb-8">
                        <div className="flex gap-2">
                          <span className={`text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest flex items-center gap-1.5 ${getStatusColor(project.status, project.health)}`}>
                            {getStatusIcon(project.status, project.health)}
                            {t(`common.${statusKeyMap[project.status] || 'inProgress'}`, lang)}
                          </span>
                          {project.health !== 'Stable' && (
                            <span className={`text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest flex items-center gap-1.5 ${project.health === 'Critical' ? 'bg-rose-500/20 text-rose-500' : 'bg-amber-500/20 text-amber-500'}`}>
                              {t(`common.${project.health === 'At Risk' ? 'atRisk' : project.health.toLowerCase()}`, lang)}
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
                                    <button
                                      onClick={() => project.updates.length === 0 ? handleEditClick(project) : showNotification("Structural Lock: Purge operational updates before editing.", "warning")}
                                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${project.updates.length === 0 ? 'hover:bg-brand/10 text-dark dark:text-brand' : 'opacity-40 cursor-not-allowed text-gray-400'}`}
                                    >
                                      <div className="flex items-center gap-3 font-bold text-xs"><Edit2 size={14} /> {t('common.edit', lang)}</div>
                                      {project.updates.length > 0 && <Lock size={12} />}
                                    </button>
                                    <button onClick={() => handleStatusChange(project, 'Completed')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-xs font-bold text-emerald-600 transition-all">
                                      <CheckCircle size={14} /> {t('projects.markCompleted', lang)}
                                    </button>
                                    <button onClick={() => handleStatusChange(project, 'Review')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-500/10 text-xs font-bold text-amber-600 transition-all">
                                      <AlertTriangle size={14} /> {t('projects.sendReview', lang)}
                                    </button>
                                    <button onClick={() => handleStatusChange(project, 'In Progress')} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-brand/10 text-xs font-bold text-dark dark:text-brand transition-all">
                                      <Clock size={14} /> {t('projects.reactivate', lang)}
                                    </button>
                                  </>
                                )}
                                {currentUser?.permissions[AppScreen.DIVIDENDS] === AccessLevel.WRITE && (
                                  <button onClick={() => navigate(`/dividends?projectId=${project.id}`)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-brand/10 text-xs font-bold text-dark dark:text-brand transition-all">
                                    <TrendingUp size={14} /> {t('projects.profitSettlement', lang)}
                                  </button>
                                )}
                                {currentUser?.permissions[AppScreen.PROJECT_MANAGEMENT] === AccessLevel.WRITE && (
                                  <>
                                    <div className="h-px bg-gray-100 dark:bg-white/5 my-1" />
                                    <button
                                      onClick={() => project.updates.length === 0 ? handleDeleteClick(project.id) : showNotification("Termination Lock: Purge operational updates before deleting.", "warning")}
                                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${project.updates.length === 0 ? 'hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600' : 'opacity-40 cursor-not-allowed text-gray-400'}`}
                                    >
                                      <div className="flex items-center gap-3 font-bold text-xs"><Trash2 size={14} /> {t('projects.deleteProject', lang)}</div>
                                      {project.updates.length > 0 && <Lock size={12} />}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mb-6">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{t(`common.${catKeyMap[project.category] || 'realEstate'}`, lang)}</p>
                        <h3 className="text-3xl font-black text-dark dark:text-white mb-2 leading-[0.9] tracking-tighter group-hover:text-brand transition-colors">{project.title}</h3>
                      </div>

                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-8 line-clamp-2 leading-relaxed">{project.description}</p>

                      <div className="space-y-8">
                        <div className="flex items-center justify-between p-6 bg-gray-50 dark:bg-[#111814] rounded-[2.5rem] border border-gray-100 dark:border-white/5 transition-all group-hover:bg-brand group-hover:border-brand shadow-inner">
                          <div>
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 group-hover:text-dark/60">{t('projects.currentAllocation', lang)}</p>
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
                                  <Avatar
                                    key={`${m.memberId || i}-${i}`}
                                    name={displayName}
                                    size="sm"
                                    className="-ml-3 first:ml-0 border-2 border-white dark:border-[#1A221D] shadow-lg"
                                  />
                                );
                              })}
                              {(project.involvedMembers || []).length > 3 && (
                                <div className="w-9 h-9 rounded-full border-2 border-white dark:border-[#1A221D] bg-gray-100 dark:bg-white/5 flex items-center justify-center text-[9px] font-black dark:text-white shadow-lg">
                                  +{(project.involvedMembers || []).length - 3}
                                </div>
                              )}
                            </div>
                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{t('projects.equityStake', lang)}</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{t('projects.growth', lang)}</p>
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
                  ))
                )}
              </div>
              <Pagination
                currentPage={currentPage}
                totalPages={paginatedProjects.pages}
                onPageChange={setCurrentPage}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(newLimit) => {
                  setRowsPerPage(newLimit);
                  setCurrentPage(1);
                }}
              />
            </div>
          )}

          {activeTab === 'Capital Flow' && (
            <div className="bg-white dark:bg-[#1A221D] rounded-[4rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5 animate-in slide-in-from-bottom-4 duration-500">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-white/5">
                      <th className="px-12 py-8 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.financialEvent', lang)}</th>
                      <th className="px-12 py-8 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.date', lang)}</th>
                      <th className="px-12 py-8 text-left text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.strategicVenture', lang)}</th>
                      <th className="px-12 py-8 text-right text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.debitCredit', lang)}</th>
                      <th className="px-12 py-8 text-right text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('projects.auditStatus', lang)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                    {globalProjects.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                        <td className="px-12 py-8">
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-brand/10 text-brand rounded-2xl group-hover:scale-110 transition-transform"><ArrowUpRight size={18} strokeWidth={3} /></div>
                            <div>
                              <p className="font-black text-dark dark:text-white text-sm uppercase group-hover:text-brand transition-colors">{t('projects.capitalInjection', lang)}</p>
                              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Token: {p.id.substring(0, 8)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-12 py-8 text-xs font-bold text-gray-400">{new Date(p.startDate).toLocaleDateString()}</td>
                        <td className="px-12 py-8 font-black text-dark dark:text-white text-sm">{p.title}</td>
                        <td className="px-12 py-8 text-right font-black text-dark dark:text-white text-2xl tracking-tighter">-{formatCurrency(p.initialInvestment)}</td>
                        <td className="px-12 py-8 text-right">
                          <span className="px-5 py-2 bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest rounded-full border border-emerald-500/20">{t('projects.verifiedLedger', lang)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'Project Transactions' && (
            <div className="space-y-10 animate-in fade-in duration-500">
              <div className="flex items-center justify-between px-6">
                <div>
                  <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-2">{t('masterForm.title', lang)}</h3>
                  <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">{t('masterForm.subtitle', lang)}</p>
                </div>
                <PermissionGuard screen={AppScreen.PROJECT_MANAGEMENT} requiredLevel={AccessLevel.WRITE}>
                  <button
                    onClick={() => {
                      setIsMasterTxModalOpen(true);
                    }}
                    className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
                  >
                    <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
                  </button>
                </PermissionGuard>
              </div>

              <div className="bg-white dark:bg-[#1A221D] rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5 overflow-hidden flex flex-col">
                <div className="p-10 border-b border-gray-50 dark:border-white/5 flex items-center justify-between bg-gray-50/30 dark:bg-white/5">
                  <div className="flex items-center gap-4">
                    <div className="bg-brand p-4 rounded-2xl shadow-xl shadow-brand/20">
                      <Activity className="text-dark" size={24} strokeWidth={3} />
                    </div>
                    <div>
                      <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('projects.ventureActivities', lang) || 'Project Activities'}</h4>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mt-2">{t('projects.auditTrailDesc', lang) || 'Audit trail of all earnings and expenses'}</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto max-h-[700px] no-scrollbar">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50/50 dark:bg-white/5 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-white/10">
                        <th className="px-10 py-5">{t('projects.ventureEntity', lang)}</th>
                        <th className="px-10 py-5">{t('projects.eventDetail', lang)}</th>
                        <th className="px-10 py-5">{t('projects.timestamp', lang)}</th>
                        <th className="px-10 py-5 text-right">{t('masterForm.preBalance', lang) || 'Prev Balance'}</th>
                        <th className="px-10 py-5 text-right font-black text-dark dark:text-brand">{t('masterForm.postBalance', lang) || 'New Balance'}</th>
                        {hasWritePermission && (
                          <th className="px-10 py-5 text-right">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                      {globalProjects.flatMap(p => p.updates.map(u => ({ ...u, projectTitle: p.title, projectId: p.id, _id: (u as any)._id }))).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((update, idx) => (
                        <tr key={`${update.projectId}-${idx}`} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                          <td className="px-10 py-8 font-black text-xs dark:text-white group-hover:text-brand uppercase transition-colors">{update.projectTitle}</td>
                          <td className="px-10 py-8">
                            <p className="text-sm font-black dark:text-white uppercase leading-none mb-1">{update.description}</p>
                            <span className={`text-[9px] font-black uppercase tracking-widest ${update.type === 'Earning' ? 'text-emerald-500' : 'text-rose-500'}`}>{update.type === 'Earning' ? t('projects.earning', lang) : t('projects.expense', lang)}</span>
                          </td>
                          <td className="px-10 py-8 text-[11px] font-bold text-gray-400 font-mono tracking-tighter">{new Date(update.date).toLocaleDateString()}</td>
                          <td className={`px-10 py-8 text-right font-black text-xl tracking-tighter ${update.type === 'Earning' ? '+' : '-'} ${update.type === 'Earning' ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {formatCurrency(update.amount)}
                          </td>
                          <td className="px-10 py-8 text-right text-[11px] font-bold text-gray-400">
                            {formatCurrency(update.balanceBefore || 0)}
                          </td>
                          <td className="px-10 py-8 text-right text-[11px] font-black dark:text-white">
                            {formatCurrency(update.balanceAfter || 0)}
                          </td>
                          {hasWritePermission && (
                            <td className="px-10 py-8 text-right">
                              <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                {/* Edit button removed as per instructions */}
                                <button
                                  onClick={() => handleDeleteUpdate(update)}
                                  className="p-2 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                                  title="Delete Record"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          )}
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
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 group-hover:text-white/40 dark:group-hover:text-dark/40">{t('projects.initialInvestment', lang)}</p>
                      <p className="text-4xl font-black text-dark dark:text-white tracking-tighter group-hover:text-white dark:group-hover:text-dark leading-none">{formatCurrency(selectedProject.initialInvestment)}</p>
                    </div>
                    <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] card-shadow border border-gray-50 dark:border-white/5 hover:border-emerald-500/30 transition-all">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">{t('projects.cumulativeRevenue', lang)}</p>
                      <p className="text-4xl font-black text-emerald-500 tracking-tighter leading-none">{formatCurrency(analytics.totalEarnings)}</p>
                    </div>
                    <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] card-shadow border border-gray-50 dark:border-white/5 hover:border-rose-500/30 transition-all">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">{t('projects.operatingOverhead', lang)}</p>
                      <p className="text-4xl font-black text-rose-500 tracking-tighter leading-none">{formatCurrency(analytics.totalExpenses)}</p>
                    </div>
                    <div className={`p-10 rounded-[4rem] card-shadow border transition-all duration-500 ${analytics.profit >= 0 ? 'bg-brand/10 border-brand text-dark dark:text-brand' : 'bg-rose-500/10 border-rose-500 text-rose-600'}`}>
                      <p className={`text-[10px] font-black uppercase tracking-widest mb-4 ${analytics.profit >= 0 ? 'text-brand' : 'text-rose-500'}`}>{t('projects.performanceMargin', lang)}</p>
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
                          <Users className="text-brand" size={28} /> {t('projects.equityParticipation', lang)}
                        </h4>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('common.bdt', lang)}</span>
                      </div>
                      <div className="space-y-6">
                        {selectedProject.involvedMembers.map((m) => {
                          const participationPercent = (m.sharesInvested / selectedProject.totalShares) * 100;
                          const partnerProfit = (analytics.profit * participationPercent) / 100;
                          return (
                            <div key={m.memberId} className="p-8 bg-gray-50 dark:bg-[#111814] rounded-[2.5rem] border border-gray-100 dark:border-white/5 flex items-center justify-between transition-all hover:translate-x-2 group">
                              <div>
                                <p className="font-black text-dark dark:text-white text-xl leading-none mb-1 group-hover:text-brand transition-colors">{m.memberName}</p>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{m.sharesInvested} {t('dashboard.trust', lang)} ({participationPercent.toFixed(1)}%)</p>
                              </div>
                              <div className="text-right">
                                <p className={`text-2xl font-black tracking-tighter ${partnerProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  {partnerProfit >= 0 ? '+' : ''}{formatCurrency(partnerProfit)}
                                </p>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('projects.netEntitlement', lang)}</p>
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
                            <p className="text-[10px] font-black text-brand uppercase tracking-[0.4em]">Project Analytics v2.6</p>
                          </div>
                          <h4 className="text-5xl font-black text-white uppercase tracking-tighter leading-[0.8] mb-8">{t('projects.stratIntel', lang)}</h4>
                          <p className="text-white/40 text-base font-medium leading-relaxed max-w-sm mb-12">
                            Performance tracking indicates that "{selectedProject.title}" is operating within {analytics.roi >= 15 ? 'optimal efficiency ranges' : 'standard fiscal parameters'}. Reserve capital is currently {selectedProject.currentFundBalance > selectedProject.initialInvestment * 0.2 ? 'sufficient' : 'strained'}.
                          </p>
                        </div>
                        <div className="pt-12 border-t border-white/10 flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">{t('projects.ventureReserve', lang)}</p>
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
                  <p className="text-gray-400">{t('projects.selectProjectPerf', lang)}</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* CREATE PROJECT MODAL */}
      <ModalForm
        isOpen={isModalOpen}
        onClose={resetForm}
        title={isEditMode ? t('common.edit', lang) : t('projects.newPlan', lang)}
        subtitle={isEditMode ? "Structural Audit & Modification" : t('projects.ventureCapital', lang)}
        onSubmit={handleReviewCreate}
        submitLabel={isEditMode ? "Verify & Save Updates" : t('projects.launchVenture', lang)}

        maxWidth="max-w-6xl"
        loading={isSubmitting}
      >
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <FormInput
              label={t('projects.projectIdentifier', lang)}
              value={newProject.title}
              onChange={e => setNewProject({ ...newProject, title: e.target.value })}
              placeholder={t('projects.titlePlaceholder', lang)}
              required
            />
            <FormSelect
              label={t('projects.sectorClassification', lang)}
              value={newProject.category}
              onChange={e => setNewProject({ ...newProject, category: e.target.value })}
              options={Object.keys(catKeyMap).map(cat => ({
                value: cat,
                label: t(`common.${catKeyMap[cat]}`, lang)
              }))}
              required
            />
            <FormInput
              label={t('projects.plannedBudget', lang)}
              type="number"
              value={newProject.budget}
              onChange={e => setNewProject({ ...newProject, budget: e.target.value })}
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <FormInput
              label={t('projects.targetRoi', lang)}
              type="number"
              value={newProject.expectedRoi}
              onChange={e => setNewProject({ ...newProject, expectedRoi: e.target.value })}
              placeholder="%"
            />
            <FormSelect
              label={t('projects.initialRiskProfile', lang)}
              value={newProject.health}
              onChange={e => setNewProject({ ...newProject, health: e.target.value as any })}
              options={[
                { value: "Stable", label: t('common.stable', lang) },
                { value: "At Risk", label: t('common.atRisk', lang) },
                { value: "Critical", label: t('common.critical', lang) }
              ]}
              required
            />
            <FormInput
              label={t('projects.kickoffDate', lang)}
              type="date"
              value={newProject.startDate}
              onChange={e => setNewProject({ ...newProject, startDate: e.target.value })}
              required
            />
            <FormInput
              label={t('projects.fundHandler', lang)}
              value={newProject.projectFundHandler}
              onChange={e => setNewProject({ ...newProject, projectFundHandler: e.target.value })}
              required
            />
          </div>

          <FormTextarea
            label={t('projects.strategicObjective', lang)}
            value={newProject.description}
            onChange={e => setNewProject({ ...newProject, description: e.target.value })}
            placeholder={t('projects.goalPlaceholder', lang)}
            required
            className="h-24 resize-none"
          />

          {/* Stakeholder Participation Builder */}
          <div className="p-8 bg-gray-50 dark:bg-[#111814] rounded-3xl border border-gray-100 dark:border-white/5">
            <h4 className="text-sm font-black text-dark dark:text-white uppercase tracking-widest mb-6 flex items-center gap-2">
              <Users size={16} className="text-brand" /> {t('projects.stakeholderEquity', lang)}
            </h4>

            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <FormSelect
                label={t('projects.memberLabel', lang)}
                value={tempMemberId}
                onChange={e => setTempMemberId(e.target.value)}
                options={activeMembers.map(m => ({
                  value: m.id || m.memberId,
                  label: m.name
                }))}
                className="flex-[2]"
              />
              <FormInput
                label={t('projects.sharesLabel', lang)}
                type="number"
                value={tempShares}
                onChange={e => setTempShares(e.target.value)}
                className="flex-1"
              />
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleAddParticipation}
                  className="bg-brand text-dark p-4 rounded-2xl hover:scale-105 active:scale-95 transition-all mb-0.5"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>

            {participationList.length > 0 && (
              <div className="space-y-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                {participationList.map((p, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-white dark:bg-white/5 p-4 rounded-2xl border border-gray-100 dark:border-white/5">
                    <div>
                      <p className="text-xs font-black text-dark dark:text-white uppercase">{p.memberName}</p>
                      <p className="text-[10px] font-bold text-gray-400">ID: {p.memberId}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-black text-brand">{p.sharesInvested} {t('projects.units', lang)}</span>
                      <button
                        type="button"
                        onClick={() => setParticipationList(participationList.filter((_, i) => i !== idx))}
                        className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 p-2 rounded-xl transition-all"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {participationList.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-white/10 flex justify-between items-center">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('projects.totalSeedCapital', lang)}</p>
                <div className="text-right">
                  <p className="text-xl font-black text-dark dark:text-white tracking-tighter">
                    BDT {(participationList.reduce((acc, p) => acc + p.sharesInvested, 0) * SHARE_VALUE).toLocaleString()}
                  </p>
                  <p className="text-[9px] font-black text-brand uppercase tracking-widest">
                    {participationList.reduce((acc, p) => acc + p.sharesInvested, 0)} {t('dashboard.trust', lang)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </ModalForm>

      <ProjectTransactionMaster
        lang={lang}
        isOpen={isMasterTxModalOpen}
        onClose={() => setIsMasterTxModalOpen(false)}
        onSuccess={() => {
          fetchPaginatedProjects(currentPage, searchQuery, rowsPerPage);
          handleRefresh();
        }}
        initialProjectId={selectedProjectId || undefined}
      />

      <ActionDialog
        isOpen={dialog.isOpen}
        type={dialog.type || 'confirm'}
        title={dialog.title}
        message={dialog.message}
        onConfirm={dialog.onConfirm}
        onClose={closeDialog}
        details={dialog.details}
        loading={isSubmitting}
      />
    </div>
  );
};

export default ProjectManagement;
