import React, { useState, useEffect, useMemo } from 'react';
import {
  Sliders,
  CreditCard,
  Calendar,
  ShieldAlert,
  Globe,
  Database,
  Users,
  ShieldCheck,
  HardDrive,
  RefreshCw,
  Save,
  Lock,
  Plus,
  Trash2,
  Key,
  Download,
  Upload,
  Cloud,
  CheckCircle2,
  X,
  AlertTriangle,
  FileText,
  UserCheck,
  Building2,
  Mail,
  Phone,
  MapPin,
  Sparkles,
  Settings as SettingsIcon,
} from 'lucide-react';
import { User as UserType, AccessLevel, AppScreen, Member } from '../types';
import { useGlobalState } from '../context/GlobalStateContext';
import Toast, { ToastType } from './Toast';
import { Language, t } from '../i18n/translations';
import { FormInput, FormSelect } from './ui/FormElements';
import MonthSelect from './ui/MonthSelect';
import AuditLogs from './Settings/AuditLogs';
import api from '../services/api';
import { Skeleton } from './ui/Skeleton';
import { checkUserPermission } from '../utils/permissions';

interface BackupEntry {
  key: string;
  filename: string;
  size: number;
  sizeKB: string;
  lastModified: string;
  age: string;
  type: 'daily' | 'monthly' | 'manual';
}

interface SettingsProps {
  currentUser: UserType | null;
  lang: Language;
}

export const Settings: React.FC<SettingsProps> = ({ currentUser, lang }) => {
  const {
    systemUsers,
    members,
    updateMember,
    updateUser,
    updateUserPassword,
    deleteUser,
    settings,
    updateSettings,
  } = useGlobalState();

  // 4 Primary Unified Tabs
  const [activeTab, setActiveTab] = useState<'CONFIGURATIONS' | 'PROFILES' | 'USERS_PERMISSIONS' | 'AUDIT_BACKUPS'>('CONFIGURATIONS');
  const [backupSubTab, setBackupSubTab] = useState<'AUDIT' | 'LOCAL_BACKUP' | 'CLOUD_BACKUP'>('AUDIT');

  // Processing state
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  // ----------------------------------------------------
  // Tab 1: System Setups & Configurations State
  // ----------------------------------------------------
  const [organizationConfig, setOrganizationConfig] = useState({
    companyName: 'InvestWise',
    companyTagline: 'Enterprise Investment Management',
    companyAddress: '',
    companyEmail: '',
    companyPhone: '',
    companyWebsite: '',
    companyRegNo: '',
  });

  const [financialConfig, setFinancialConfig] = useState({
    fiscalYearStart: 'July',
    fiscalYearEnd: 'June',
    baseCurrency: 'BDT',
    taxRate: 15.0,
    accountingMethod: 'Accrual',
    shareValueBdt: 1000,
    isShareValueLocked: false,
    withdrawalLimitPercent: 80,
    withdrawalNoticeDays: 30,
    maxWithdrawalPerRequest: 100000,
    statutoryReservePercent: 10,
  });

  const [governanceConfig, setGovernanceConfig] = useState<{
    monthlyMeetingDay: number;
    depositDueDate: number;
    gracePeriodDays: number;
    meetingTypes: string[];
    penaltyRules: Array<{
      tier: number;
      title: string;
      type: string;
      deductionAmount?: number;
      isPercentage?: boolean;
    }>;
  }>({
    monthlyMeetingDay: 5,
    depositDueDate: 10,
    gracePeriodDays: 3,
    meetingTypes: ['FOUNDING_MEMBER', 'SHAREHOLDER', 'INVESTOR', 'GENERAL'],
    penaltyRules: [
      { tier: 1, title: '1st Offense: Verbal Warning', type: 'VERBAL_WARNING', deductionAmount: 0, isPercentage: false },
      { tier: 2, title: '2nd Offense: Minor Fine', type: 'FUND_DEDUCTION', deductionAmount: 50, isPercentage: false },
      { tier: 3, title: '3rd Offense: Major Fine', type: 'FUND_DEDUCTION', deductionAmount: 200, isPercentage: false },
      { tier: 4, title: '4th Offense: Suspension & Fine', type: 'SUSPENSION', deductionAmount: 500, isPercentage: false },
    ],
  });

  const [systemConfig, setSystemConfig] = useState({
    language: 'English',
    refreshInterval: 'Real-time',
    theme: 'System Default',
    dateFormat: 'DD/MM/YYYY',
    isMaintenanceMode: false,
  });

  // Sync settings when loaded
  useEffect(() => {
    if (settings) {
      if (settings.organization) {
        setOrganizationConfig((prev) => ({ ...prev, ...settings.organization }));
      } else if (settings.companyName) {
        setOrganizationConfig((prev) => ({
          ...prev,
          companyName: settings.companyName || 'InvestWise',
          companyTagline: settings.companyTagline || 'Enterprise Investment Management',
          companyAddress: settings.companyAddress || '',
          companyEmail: settings.companyEmail || '',
          companyPhone: settings.companyPhone || '',
          companyWebsite: settings.companyWebsite || '',
          companyRegNo: settings.companyRegNo || '',
        }));
      }
      if (settings.financial) setFinancialConfig((prev) => ({ ...prev, ...settings.financial }));
      if (settings.governance) setGovernanceConfig((prev) => ({ ...prev, ...settings.governance }));
      if (settings.system) setSystemConfig((prev) => ({ ...prev, ...settings.system }));
    }
  }, [settings]);

  // Refresh settings from server
  const refreshServerSettings = async () => {
    try {
      setProcessingId('refresh');
      const { data } = await api.get('/settings');
      if (data.organization) setOrganizationConfig((prev) => ({ ...prev, ...data.organization }));
      if (data.financial) setFinancialConfig((prev) => ({ ...prev, ...data.financial }));
      if (data.governance) setGovernanceConfig((prev) => ({ ...prev, ...data.governance }));
      if (data.system) setSystemConfig((prev) => ({ ...prev, ...data.system }));
      showNotification('Settings synchronized from database.');
    } catch (err) {
      showNotification('Failed to fetch settings', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  // Save Handlers for Tab 1
  const handleSaveOrganization = async () => {
    try {
      setProcessingId('organization-save');
      await updateSettings({ organization: organizationConfig });
      showNotification('Company & organization profile updated successfully across the platform.');
      const { data } = await api.get('/settings');
      if (data.organization) setOrganizationConfig((prev) => ({ ...prev, ...data.organization }));
    } catch (error: any) {
      showNotification(error.response?.data?.message || error.message || 'Failed to save organization profile', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSaveFinancial = async () => {
    try {
      setProcessingId('financial-save');
      await updateSettings({ financial: financialConfig });
      showNotification('Fiscal & financial rules saved successfully.');
      const { data } = await api.get('/settings');
      if (data.financial) setFinancialConfig((prev) => ({ ...prev, ...data.financial }));
    } catch (error: any) {
      showNotification(error.response?.data?.message || error.message || 'Failed to save financial settings', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSaveGovernance = async () => {
    try {
      setProcessingId('governance-save');
      await updateSettings({ governance: governanceConfig });
      showNotification('Governance & meeting policies saved successfully.');
      const { data } = await api.get('/settings');
      if (data.governance) setGovernanceConfig((prev) => ({ ...prev, ...data.governance }));
    } catch (error: any) {
      showNotification(error.response?.data?.message || error.message || 'Failed to save governance settings', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSaveSystem = async () => {
    try {
      setProcessingId('system-save');
      await updateSettings({ system: systemConfig });
      showNotification('System preferences saved successfully.');
    } catch (error: any) {
      showNotification('Failed to save system settings', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  // ----------------------------------------------------
  // Tab 2: Member Profiles State
  // ----------------------------------------------------
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [memberProfileForm, setMemberProfileForm] = useState<Partial<Member>>({});

  useEffect(() => {
    if (!selectedMemberId && members.length > 0) {
      setSelectedMemberId(members[0].id);
      setMemberProfileForm(members[0]);
    }
  }, [members, selectedMemberId]);

  const handleSelectMember = (id: string) => {
    setSelectedMemberId(id);
    const m = members.find((item) => item.id === id);
    if (m) setMemberProfileForm(m);
  };

  const handleSaveMemberProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId) return;

    try {
      setProcessingId('profile-save');
      await updateMember(memberProfileForm as Member);
      showNotification(`Profile for ${memberProfileForm.name || 'member'} updated successfully.`);
    } catch (err: any) {
      showNotification('Failed to update member profile', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  // ----------------------------------------------------
  // Tab 3: Users & Permissions State
  // ----------------------------------------------------
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, Map<AppScreen, AccessLevel>>>(new Map());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [newPassword, setNewPassword] = useState<string>('');

  // Add User Modal State
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    role: 'Member' as UserType['role'],
    password: '',
  });

  useEffect(() => {
    if (!selectedUserId && systemUsers.length > 0) {
      setSelectedUserId(systemUsers[0].id);
    }
  }, [systemUsers, selectedUserId]);

  const allModules: AppScreen[] = [
    AppScreen.DASHBOARD,
    AppScreen.MEMBERS,
    AppScreen.MEETINGS,
    AppScreen.GOVERNANCE,
    AppScreen.DEPOSITS,
    AppScreen.REQUEST_DEPOSIT,
    AppScreen.TRANSACTIONS,
    AppScreen.DIVIDENDS,
    AppScreen.EXPENSES,
    AppScreen.PROJECT_MANAGEMENT,
    AppScreen.FUNDS_MANAGEMENT,
    AppScreen.ANALYSIS,
    AppScreen.REPORTS,
    AppScreen.GOALS,
    AppScreen.SETTINGS,
  ];

  const handlePermissionChange = (userId: string, screen: AppScreen, level: AccessLevel) => {
    const userPendingMap = pendingPermissions.get(userId) || new Map();
    userPendingMap.set(screen, level);
    setPendingPermissions(new Map(pendingPermissions.set(userId, userPendingMap)));
    setHasUnsavedChanges(true);
  };

  const getEffectivePermission = (userId: string, screen: AppScreen): AccessLevel => {
    const userPending = pendingPermissions.get(userId);
    if (userPending?.has(screen)) {
      return userPending.get(screen)!;
    }
    const user = systemUsers.find((u) => u.id === userId);
    return (user?.permissions as any)?.[screen] || AccessLevel.NONE;
  };

  const handleSaveAllPermissions = async () => {
    if (!hasUnsavedChanges || !selectedUserId) return;

    const userPending = pendingPermissions.get(selectedUserId);
    if (!userPending || userPending.size === 0) return;

    try {
      const userToUpdate = systemUsers.find((u) => u.id === selectedUserId);
      if (!userToUpdate) return;

      const currentPermissions = { ...(userToUpdate.permissions || {}) };
      for (const [screen, level] of userPending.entries()) {
        currentPermissions[screen] = level;
      }

      setProcessingId('batch-save');
      await updateUser(selectedUserId, { permissions: currentPermissions });

      pendingPermissions.delete(selectedUserId);
      setPendingPermissions(new Map(pendingPermissions));
      setHasUnsavedChanges(false);

      showNotification('User permissions updated successfully');
    } catch (e) {
      showNotification('Failed to update permissions', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleResetPassword = async (userId: string) => {
    if (!newPassword || newPassword.length < 8) {
      showNotification('Password must be at least 8 characters', 'error');
      return;
    }

    try {
      setProcessingId(`reset-${userId}`);
      await updateUserPassword(userId, newPassword);
      setNewPassword('');
      showNotification('User password updated successfully.');
    } catch (e) {
      showNotification('Failed to reset password', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Are you sure you want to remove this user account?')) return;
    try {
      setProcessingId(`delete-${userId}`);
      await deleteUser(userId);
      showNotification('User account removed');
      if (selectedUserId === userId) {
        setSelectedUserId(systemUsers.find((u) => u.id !== userId)?.id || null);
      }
    } catch (err) {
      showNotification('Failed to remove user', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  // ----------------------------------------------------
  // Tab 4: Audit & Backups State
  // ----------------------------------------------------
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [cloudBackups, setCloudBackups] = useState<BackupEntry[]>([]);
  const [isLoadingCloudBackups, setIsLoadingCloudBackups] = useState(false);

  const handleDownloadBackup = async () => {
    setIsBackingUp(true);
    try {
      const response = await api.get('/backup/download', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.setAttribute('download', `investwise-backup-${timestamp}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showNotification('Database backup downloaded successfully');
    } catch (error: any) {
      showNotification('Failed to download backup', 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.json')) {
        showNotification('Please select a valid JSON backup file', 'error');
        return;
      }
      setBackupFile(file);
      showNotification(`Selected: ${file.name}`);
    }
  };

  const handleRestoreBackup = async () => {
    if (!backupFile) {
      showNotification('Please choose a JSON backup file first', 'error');
      return;
    }
    if (!window.confirm('WARNING: This will overwrite existing database records with the backup file. Proceed?')) {
      return;
    }

    setIsRestoring(true);
    try {
      const formData = new FormData();
      formData.append('backup', backupFile);
      await api.post('/backup/restore', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showNotification('Backup restored successfully! Refreshing...');
      setBackupFile(null);
      setTimeout(() => window.location.reload(), 1500);
    } catch (error: any) {
      showNotification(error.response?.data?.message || 'Restore failed', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const loadCloudBackups = async () => {
    setIsLoadingCloudBackups(true);
    try {
      const response = await api.get('/backup/list');
      if (response.data.success) {
        setCloudBackups(response.data.backups || []);
      }
    } catch (error) {
      // Cloud backup optional
    } finally {
      setIsLoadingCloudBackups(false);
    }
  };

  const handleCloudBackup = async (type: 'daily' | 'monthly' = 'daily') => {
    setIsBackingUp(true);
    try {
      const response = await api.post('/backup/manual', { type });
      if (response.data.status === 'success') {
        showNotification(`Cloud backup created successfully (${response.data.duration}s)`);
        await loadCloudBackups();
      }
    } catch (error: any) {
      showNotification(error.response?.data?.error || 'Cloud backup failed', 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'AUDIT_BACKUPS' && backupSubTab === 'CLOUD_BACKUP') {
      loadCloudBackups();
    }
  }, [activeTab, backupSubTab]);

  const isAdmin = useMemo(() => {
    return currentUser?.role === 'Admin' || currentUser?.role === 'Administrator';
  }, [currentUser]);

  useEffect(() => {
    if (!isAdmin && activeTab !== 'CONFIGURATIONS') {
      setActiveTab('CONFIGURATIONS');
    }
  }, [isAdmin, activeTab]);

  const canWriteSettings = useMemo(() => {
    return checkUserPermission(currentUser, AppScreen.SETTINGS, AccessLevel.WRITE);
  }, [currentUser]);

  return (
    <div className="space-y-6">
      <Toast
        isVisible={toast.isVisible}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ ...toast, isVisible: false })}
      />

      {/* Top Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-sm">
              <SettingsIcon className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                {t('nav.settings', lang)} & System Configuration
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isAdmin
                  ? 'Financial Parameters, Meeting Schedules, 4-Tier Disciplinary Policy, Member Profiles, Roles & Security'
                  : 'Company Information & Official Organization Profile'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!canWriteSettings && (
            <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold shadow-xs">
              <Lock className="w-3.5 h-3.5" />
              <span>Read-Only Mode</span>
            </div>
          )}
          <button
            onClick={refreshServerSettings}
            disabled={processingId === 'refresh'}
            className="p-2.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
            title="Refresh Settings"
          >
            <RefreshCw className={`w-4 h-4 ${processingId === 'refresh' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Unified Tab Navigation */}
      {isAdmin ? (
        <div className="flex border-b border-slate-200 dark:border-slate-700 gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('CONFIGURATIONS')}
            className={`pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'CONFIGURATIONS'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Sliders className="w-4 h-4" />
            1. System Setups & Configurations
          </button>

          <button
            onClick={() => setActiveTab('PROFILES')}
            className={`pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'PROFILES'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Database className="w-4 h-4" />
            2. Member Profiles Management
          </button>

          <button
            onClick={() => setActiveTab('USERS_PERMISSIONS')}
            className={`pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'USERS_PERMISSIONS'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Users className="w-4 h-4" />
            3. Team & Access Control Matrix
          </button>

          <button
            onClick={() => setActiveTab('AUDIT_BACKUPS')}
            className={`pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'AUDIT_BACKUPS'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            4. Audit Logs & Database Backups
          </button>
        </div>
      ) : (
        <div className="flex border-b border-slate-200 dark:border-slate-700 gap-2">
          <div className="pb-3 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Organization Profile
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 1: SYSTEM SETUPS & CONFIGURATIONS (ALL CATEGORIZED) */}
      {/* ========================================================= */}
      {activeTab === 'CONFIGURATIONS' && (
        <div className="space-y-6">
          {/* Organization Profile */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-700 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                    Organization Profile
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Manage company name, legal registration, and contact information.
                  </p>
                </div>
              </div>

              {canWriteSettings ? (
                <button
                  onClick={handleSaveOrganization}
                  disabled={processingId === 'organization-save'}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  {processingId === 'organization-save' ? 'Saving...' : 'Save Profile'}
                </button>
              ) : (
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900">
                  <Lock className="w-3 h-3" /> Read Only
                </span>
              )}
            </div>

            {/* Form Input Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Company / Organization Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={organizationConfig.companyName}
                  onChange={(e) => setOrganizationConfig({ ...organizationConfig, companyName: e.target.value })}
                  placeholder="e.g. InvestWise Capital"
                  className={`w-full px-3 py-2 border rounded-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Corporate Tagline / Slogan
                </label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={organizationConfig.companyTagline}
                  onChange={(e) => setOrganizationConfig({ ...organizationConfig, companyTagline: e.target.value })}
                  placeholder="e.g. Enterprise Investment Management"
                  className={`w-full px-3 py-2 border rounded-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Registration / Tax / License No
                </label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={organizationConfig.companyRegNo}
                  onChange={(e) => setOrganizationConfig({ ...organizationConfig, companyRegNo: e.target.value })}
                  placeholder="e.g. REG-2026-90812"
                  className={`w-full px-3 py-2 border rounded-lg font-medium font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Official Email Address
                </label>
                <input
                  type="email"
                  disabled={!canWriteSettings}
                  value={organizationConfig.companyEmail}
                  onChange={(e) => setOrganizationConfig({ ...organizationConfig, companyEmail: e.target.value })}
                  placeholder="e.g. info@company.com"
                  className={`w-full px-3 py-2 border rounded-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Official Phone / Hotline
                </label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={organizationConfig.companyPhone}
                  onChange={(e) => setOrganizationConfig({ ...organizationConfig, companyPhone: e.target.value })}
                  placeholder="e.g. +880 1700-000000"
                  className={`w-full px-3 py-2 border rounded-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Official Website URL
                </label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={organizationConfig.companyWebsite}
                  onChange={(e) => setOrganizationConfig({ ...organizationConfig, companyWebsite: e.target.value })}
                  placeholder="e.g. https://investwise.local"
                  className={`w-full px-3 py-2 border rounded-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                  }`}
                />
              </div>

              <div className="md:col-span-3">
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Headquarters / Physical Office Address
                </label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={organizationConfig.companyAddress}
                  onChange={(e) => setOrganizationConfig({ ...organizationConfig, companyAddress: e.target.value })}
                  placeholder="e.g. Level 7, Financial Plaza, Corporate Avenue, Dhaka 1212"
                  className={`w-full px-3 py-2 border rounded-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Admin Only Configuration Sections */}
          {isAdmin && (
            <>
              {/* 1. Fiscal & Financial Rules */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-blue-600" />
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                      1. Financial & Capital Rules
                    </h3>
                  </div>
                  {canWriteSettings ? (
                    <button
                      onClick={handleSaveFinancial}
                      disabled={processingId === 'financial-save'}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {processingId === 'financial-save' ? 'Saving...' : 'Save Financial Rules'}
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900">
                      <Lock className="w-3 h-3" /> Read Only
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Base Currency</label>
                    <select
                      disabled={!canWriteSettings}
                      value={financialConfig.baseCurrency}
                      onChange={(e) => setFinancialConfig({ ...financialConfig, baseCurrency: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    >
                      <option value="BDT">BDT - Bangladeshi Taka</option>
                      <option value="USD">USD - US Dollar</option>
                      <option value="EUR">EUR - Euro</option>
                      <option value="GBP">GBP - British Pound</option>
                      <option value="SAR">SAR - Saudi Riyal</option>
                      <option value="AED">AED - UAE Dirham</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Accounting Method</label>
                    <select
                      disabled={!canWriteSettings}
                      value={financialConfig.accountingMethod}
                      onChange={(e) => setFinancialConfig({ ...financialConfig, accountingMethod: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    >
                      <option value="Accrual">Accrual Basis</option>
                      <option value="Cash">Cash Basis</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-700 dark:text-slate-300">Share Value ({financialConfig.baseCurrency})</label>
                      {(financialConfig.isShareValueLocked || !canWriteSettings) && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Locked
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      disabled={!canWriteSettings || financialConfig.isShareValueLocked}
                      value={financialConfig.shareValueBdt}
                      onChange={(e) => setFinancialConfig({ ...financialConfig, shareValueBdt: parseFloat(e.target.value) || 0 })}
                      className={`w-full px-3 py-2 border rounded-lg font-bold dark:text-white ${
                        !canWriteSettings || financialConfig.isShareValueLocked
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-400 cursor-not-allowed border-slate-200 dark:border-slate-800'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                      }`}
                    />
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Fiscal Year Start Month</label>
                    <MonthSelect
                      value={financialConfig.fiscalYearStart}
                      onChange={(val) => setFinancialConfig({ ...financialConfig, fiscalYearStart: val })}
                      lang={lang}
                      disabled={!canWriteSettings}
                    />
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Statutory Reserve (%)</label>
                    <input
                      type="number"
                      disabled={!canWriteSettings}
                      min={0}
                      max={100}
                      value={financialConfig.statutoryReservePercent}
                      onChange={(e) => setFinancialConfig({ ...financialConfig, statutoryReservePercent: parseFloat(e.target.value) || 0 })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    />
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Corporate Tax Rate (%)</label>
                    <input
                      type="number"
                      disabled={!canWriteSettings}
                      min={0}
                      max={100}
                      value={financialConfig.taxRate}
                      onChange={(e) => setFinancialConfig({ ...financialConfig, taxRate: parseFloat(e.target.value) || 0 })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    />
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Withdrawal Notice (Days)</label>
                    <input
                      type="number"
                      disabled={!canWriteSettings}
                      min={0}
                      value={financialConfig.withdrawalNoticeDays}
                      onChange={(e) => setFinancialConfig({ ...financialConfig, withdrawalNoticeDays: parseInt(e.target.value, 10) || 0 })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    />
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Max Withdrawal Per Request ({financialConfig.baseCurrency})</label>
                    <input
                      type="number"
                      disabled={!canWriteSettings}
                      min={0}
                      value={financialConfig.maxWithdrawalPerRequest}
                      onChange={(e) => setFinancialConfig({ ...financialConfig, maxWithdrawalPerRequest: parseFloat(e.target.value) || 0 })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* 2. Governance & Meeting Schedules */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                      2. Governance & Meeting Schedules
                    </h3>
                  </div>
                  {canWriteSettings ? (
                    <button
                      onClick={handleSaveGovernance}
                      disabled={processingId === 'governance-save'}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {processingId === 'governance-save' ? 'Saving...' : 'Save Meeting Policy'}
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900">
                      <Lock className="w-3 h-3" /> Read Only
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Monthly Recurring Meeting Day (1–28)
                    </label>
                    <input
                      type="number"
                      disabled={!canWriteSettings}
                      min={1}
                      max={28}
                      value={governanceConfig.monthlyMeetingDay}
                      onChange={(e) => setGovernanceConfig({ ...governanceConfig, monthlyMeetingDay: parseInt(e.target.value, 10) || 1 })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Scheduled on day {governanceConfig.monthlyMeetingDay} of every month</span>
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Monthly Deposit Due Deadline Day (1–28)
                    </label>
                    <input
                      type="number"
                      disabled={!canWriteSettings}
                      min={1}
                      max={28}
                      value={governanceConfig.depositDueDate}
                      onChange={(e) => setGovernanceConfig({ ...governanceConfig, depositDueDate: parseInt(e.target.value, 10) || 1 })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Members must submit monthly deposits by day {governanceConfig.depositDueDate}</span>
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Deposit Grace Period (Days)
                    </label>
                    <input
                      type="number"
                      disabled={!canWriteSettings}
                      min={0}
                      max={15}
                      value={governanceConfig.gracePeriodDays}
                      onChange={(e) => setGovernanceConfig({ ...governanceConfig, gracePeriodDays: parseInt(e.target.value, 10) || 0 })}
                      className={`w-full px-3 py-2 border rounded-lg font-medium ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Grace window before deposit is flagged late</span>
                  </div>
                </div>
              </div>

              {/* 3. 4-Tier Escalating Disciplinary Policy */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-rose-600" />
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                      3. 4-Tier Escalating Disciplinary Policy
                    </h3>
                  </div>
                  {canWriteSettings ? (
                    <button
                      onClick={handleSaveGovernance}
                      disabled={processingId === 'governance-save'}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {processingId === 'governance-save' ? 'Saving...' : 'Save Penalty Policy'}
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900">
                      <Lock className="w-3 h-3" /> Read Only
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {governanceConfig.penaltyRules.map((rule, idx) => (
                    <div
                      key={rule.tier}
                      className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-slate-900 dark:text-white text-xs">
                          Tier {rule.tier}: {rule.title}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300">
                          {rule.type}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Fine Amount ({financialConfig.baseCurrency})</label>
                          <input
                            type="number"
                            disabled={!canWriteSettings}
                            min={0}
                            value={rule.deductionAmount ?? 0}
                            onChange={(e) => {
                              const updated = [...governanceConfig.penaltyRules];
                              updated[idx] = { ...updated[idx], deductionAmount: parseFloat(e.target.value) || 0 };
                              setGovernanceConfig({ ...governanceConfig, penaltyRules: updated });
                            }}
                            className={`w-full px-2.5 py-1.5 border rounded text-xs font-bold ${
                              !canWriteSettings
                                ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white'
                            }`}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Deduction Type</label>
                          <select
                            disabled={!canWriteSettings}
                            value={rule.type}
                            onChange={(e) => {
                              const updated = [...governanceConfig.penaltyRules];
                              updated[idx] = { ...updated[idx], type: e.target.value };
                              setGovernanceConfig({ ...governanceConfig, penaltyRules: updated });
                            }}
                            className={`w-full px-2.5 py-1.5 border rounded text-xs ${
                              !canWriteSettings
                                ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white'
                            }`}
                          >
                            <option value="VERBAL_WARNING">Verbal Warning</option>
                            <option value="FUND_DEDUCTION">Fund Deduction</option>
                            <option value="SUSPENSION">Suspension & Fine</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 4. System Preferences & Localization */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                  <div className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-teal-600" />
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                      4. System Preferences & Localization
                    </h3>
                  </div>
                  {canWriteSettings ? (
                    <button
                      onClick={handleSaveSystem}
                      disabled={processingId === 'system-save'}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {processingId === 'system-save' ? 'Saving...' : 'Save Preferences'}
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900">
                      <Lock className="w-3 h-3" /> Read Only
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">System Language</label>
                    <select
                      disabled={!canWriteSettings}
                      value={systemConfig.language}
                      onChange={(e) => setSystemConfig({ ...systemConfig, language: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    >
                      <option value="English">English</option>
                      <option value="Bengali">Bengali (বাংলা)</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Date Display Format</label>
                    <select
                      disabled={!canWriteSettings}
                      value={systemConfig.dateFormat}
                      onChange={(e) => setSystemConfig({ ...systemConfig, dateFormat: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    >
                      <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 15/08/2026)</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY (e.g. 08/15/2026)</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Real-Time Refresh Interval</label>
                    <select
                      disabled={!canWriteSettings}
                      value={systemConfig.refreshInterval}
                      onChange={(e) => setSystemConfig({ ...systemConfig, refreshInterval: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg ${
                        !canWriteSettings
                          ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                      }`}
                    >
                      <option value="Real-time">Real-time (Active Sync)</option>
                      <option value="30s">Every 30 Seconds</option>
                      <option value="1m">Every 1 Minute</option>
                      <option value="5m">Every 5 Minutes</option>
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: MEMBER PROFILES MANAGEMENT */}
      {/* ========================================================= */}
      {isAdmin && activeTab === 'PROFILES' && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Member Extended Profile Records</h3>
              <p className="text-xs text-slate-500">View and update contact, address, NID, and nominee registration records.</p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Select Member:</label>
              <select
                value={selectedMemberId}
                onChange={(e) => handleSelectMember(e.target.value)}
                className="px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold dark:text-white"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.memberId || 'ID'}) - {m.role}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <form onSubmit={handleSaveMemberProfile} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Full Name</label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={memberProfileForm.name || ''}
                  onChange={(e) => setMemberProfileForm({ ...memberProfileForm, name: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg font-medium ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Phone Number</label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={memberProfileForm.phone || ''}
                  onChange={(e) => setMemberProfileForm({ ...memberProfileForm, phone: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg font-medium ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Email Address</label>
                <input
                  type="email"
                  disabled={!canWriteSettings}
                  value={memberProfileForm.email || ''}
                  onChange={(e) => setMemberProfileForm({ ...memberProfileForm, email: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg font-medium ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Father's / Guardian's Name</label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={memberProfileForm.fatherName || ''}
                  onChange={(e) => setMemberProfileForm({ ...memberProfileForm, fatherName: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg font-medium ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">NID / Passport Number</label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={memberProfileForm.nidOrPassport || ''}
                  onChange={(e) => setMemberProfileForm({ ...memberProfileForm, nidOrPassport: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg font-medium ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                  }`}
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Residential Address</label>
                <input
                  type="text"
                  disabled={!canWriteSettings}
                  value={memberProfileForm.address || ''}
                  onChange={(e) => setMemberProfileForm({ ...memberProfileForm, address: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg font-medium ${
                    !canWriteSettings
                      ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-white'
                  }`}
                />
              </div>
            </div>

            {/* Nominee Sub-Card */}
            <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 mt-4">
              <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">
                Nominee & Beneficiary Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-400 block mb-1">Nominee Name</label>
                  <input
                    type="text"
                    disabled={!canWriteSettings}
                    value={memberProfileForm.nomineeName || ''}
                    onChange={(e) => setMemberProfileForm({ ...memberProfileForm, nomineeName: e.target.value })}
                    className={`w-full px-3 py-2 border rounded text-xs ${
                      !canWriteSettings
                        ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white'
                    }`}
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-400 block mb-1">Relation</label>
                  <input
                    type="text"
                    disabled={!canWriteSettings}
                    value={memberProfileForm.nomineeRelation || ''}
                    onChange={(e) => setMemberProfileForm({ ...memberProfileForm, nomineeRelation: e.target.value })}
                    className={`w-full px-3 py-2 border rounded text-xs ${
                      !canWriteSettings
                        ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white'
                    }`}
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-400 block mb-1">Nominee NID / Passport</label>
                  <input
                    type="text"
                    disabled={!canWriteSettings}
                    value={memberProfileForm.nomineeNidOrPassport || ''}
                    onChange={(e) => setMemberProfileForm({ ...memberProfileForm, nomineeNidOrPassport: e.target.value })}
                    className={`w-full px-3 py-2 border rounded text-xs ${
                      !canWriteSettings
                        ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white'
                    }`}
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-400 block mb-1">Nominee Phone</label>
                  <input
                    type="text"
                    disabled={!canWriteSettings}
                    value={memberProfileForm.nomineePhone || ''}
                    onChange={(e) => setMemberProfileForm({ ...memberProfileForm, nomineePhone: e.target.value })}
                    className={`w-full px-3 py-2 border rounded text-xs ${
                      !canWriteSettings
                        ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-white'
                    }`}
                  />
                </div>
              </div>
            </div>

            {canWriteSettings ? (
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={processingId === 'profile-save'}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  {processingId === 'profile-save' ? 'Saving...' : 'Save Profile Changes'}
                </button>
              </div>
            ) : (
              <div className="flex justify-end pt-2">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900">
                  <Lock className="w-3 h-3" /> Read-Only Mode (Profile changes restricted)
                </span>
              </div>
            )}
          </form>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: TEAM & ACCESS CONTROL MATRIX */}
      {/* ========================================================= */}
      {isAdmin && activeTab === 'USERS_PERMISSIONS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* User List Panel */}
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  System Accounts ({systemUsers.length})
                </h3>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {systemUsers.map((u) => {
                  const isSelected = selectedUserId === u.id;
                  return (
                    <div
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-900/20 shadow-sm'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                          {u.name?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">{u.name}</p>
                          <span className="text-[10px] text-slate-400">{u.email}</span>
                        </div>
                      </div>

                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {u.role}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Permissions Matrix & Reset Tool */}
            <div className="lg:col-span-2 space-y-5">
              {selectedUserId && (
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-700 pb-3">
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                        Screen Access Matrix: {systemUsers.find((u) => u.id === selectedUserId)?.name}
                      </h3>
                      <p className="text-xs text-slate-400">Configure read / write authorization per screen module.</p>
                    </div>

                    {canWriteSettings && hasUnsavedChanges && (
                      <button
                        onClick={handleSaveAllPermissions}
                        disabled={processingId === 'batch-save'}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {processingId === 'batch-save' ? 'Saving...' : 'Save Permissions'}
                      </button>
                    )}

                    {!canWriteSettings && (
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900">
                        <Lock className="w-3 h-3" /> Read Only
                      </span>
                    )}
                  </div>

                  {/* Permissions Grid Table */}
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-3">Module Screen</th>
                          <th className="p-3 text-right">Access Level Authorization</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {allModules.map((screen) => {
                          const currentLevel = getEffectivePermission(selectedUserId, screen);

                          return (
                            <tr key={screen} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20">
                              <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                                {screen.replace(/_/g, ' ')}
                              </td>
                              <td className="p-3 text-right">
                                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-900">
                                  <button
                                    type="button"
                                    disabled={!canWriteSettings}
                                    onClick={() => handlePermissionChange(selectedUserId, screen, AccessLevel.NONE)}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${
                                      currentLevel === AccessLevel.NONE
                                        ? 'bg-rose-600 text-white shadow-sm'
                                        : !canWriteSettings
                                        ? 'text-slate-400 opacity-60 cursor-not-allowed'
                                        : 'text-slate-400 hover:text-slate-600'
                                    }`}
                                  >
                                    None
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!canWriteSettings}
                                    onClick={() => handlePermissionChange(selectedUserId, screen, AccessLevel.READ)}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${
                                      currentLevel === AccessLevel.READ
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : !canWriteSettings
                                        ? 'text-slate-400 opacity-60 cursor-not-allowed'
                                        : 'text-slate-400 hover:text-slate-600'
                                    }`}
                                  >
                                    Read Only
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!canWriteSettings}
                                    onClick={() => handlePermissionChange(selectedUserId, screen, AccessLevel.WRITE)}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${
                                      currentLevel === AccessLevel.WRITE
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : !canWriteSettings
                                        ? 'text-slate-400 opacity-60 cursor-not-allowed'
                                        : 'text-slate-400 hover:text-slate-600'
                                    }`}
                                  >
                                    Read & Write
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Password Reset Section */}
                  <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex-1">
                      <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Set New User Password</label>
                      <input
                        type="password"
                        disabled={!canWriteSettings}
                        placeholder={canWriteSettings ? "Enter minimum 8 characters..." : "Password change restricted"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className={`w-full px-3 py-2 border rounded text-xs ${
                          !canWriteSettings
                            ? 'bg-slate-100 dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-800 cursor-not-allowed'
                            : 'bg-white dark:bg-slate-800 border dark:text-white'
                        }`}
                      />
                    </div>
                    {canWriteSettings ? (
                      <button
                        onClick={() => handleResetPassword(selectedUserId)}
                        disabled={processingId === `reset-${selectedUserId}`}
                        className="px-3.5 py-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white rounded font-bold self-end sm:self-auto"
                      >
                        {processingId === `reset-${selectedUserId}` ? 'Updating...' : 'Update Password'}
                      </button>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1 self-end sm:self-auto px-3 py-2">
                        <Lock className="w-3 h-3" /> Password Change Restricted
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 4: AUDIT LOGS & DISASTER RECOVERY */}
      {/* ========================================================= */}
      {isAdmin && activeTab === 'AUDIT_BACKUPS' && (
        <div className="space-y-6">
          {/* Sub Tab Navigation */}
          <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
            <button
              onClick={() => setBackupSubTab('AUDIT')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                backupSubTab === 'AUDIT'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Security Audit Trail
            </button>
            <button
              onClick={() => setBackupSubTab('LOCAL_BACKUP')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                backupSubTab === 'LOCAL_BACKUP'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Database JSON Export & Restore
            </button>
            <button
              onClick={() => setBackupSubTab('CLOUD_BACKUP')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                backupSubTab === 'CLOUD_BACKUP'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Cloudflare R2 Cloud Backup
            </button>
          </div>

          {backupSubTab === 'AUDIT' && (
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <AuditLogs lang={lang} currentUser={currentUser} />
            </div>
          )}

          {backupSubTab === 'LOCAL_BACKUP' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 text-xs">
                <div className="flex items-center gap-2 border-b pb-3">
                  <Download className="w-5 h-5 text-blue-600" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Export Local JSON Snapshot</h3>
                </div>
                <p className="text-slate-500">
                  Generate a complete encrypted snapshot of members, meetings, penalties, funds, transactions, and system settings.
                </p>
                <button
                  onClick={handleDownloadBackup}
                  disabled={isBackingUp}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {isBackingUp ? 'Generating Snapshot...' : 'Download JSON Backup'}
                </button>
              </div>

              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 text-xs">
                <div className="flex items-center gap-2 border-b pb-3">
                  <Upload className="w-5 h-5 text-rose-600" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Restore from JSON Snapshot</h3>
                </div>
                <p className="text-slate-500">
                  Upload a previously exported `.json` snapshot file to restore system records.
                </p>
                <input
                  type="file"
                  accept=".json"
                  disabled={!canWriteSettings}
                  onChange={handleFileSelect}
                  className={`w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-100 dark:file:bg-slate-700 file:text-slate-700 dark:file:text-slate-200 hover:file:bg-slate-200 ${
                    !canWriteSettings ? 'cursor-not-allowed opacity-60' : ''
                  }`}
                />
                {canWriteSettings ? (
                  <button
                    onClick={handleRestoreBackup}
                    disabled={isRestoring || !backupFile}
                    className={`px-4 py-2.5 text-white rounded-lg font-bold flex items-center gap-2 ${
                      backupFile ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <Upload className="w-4 h-4" />
                    {isRestoring ? 'Restoring Records...' : 'Execute Database Restore'}
                  </button>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" /> Database restore requires Write authorization.
                  </p>
                )}
              </div>
            </div>
          )}

          {backupSubTab === 'CLOUD_BACKUP' && (
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4 text-xs">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-indigo-600" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Cloudflare R2 Automated Storage</h3>
                </div>
                {canWriteSettings && (
                  <button
                    onClick={() => handleCloudBackup('daily')}
                    disabled={isBackingUp}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold"
                  >
                    {isBackingUp ? 'Triggering...' : 'Trigger Cloud Backup'}
                  </button>
                )}
              </div>
              <p className="text-slate-500">
                Off-site automated storage repository. Cloud snapshots are automatically retained and rotated on daily/monthly schedules.
              </p>

              {isLoadingCloudBackups ? (
                <div className="space-y-2 py-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`cb-skel-${i}`} className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg flex justify-between items-center">
                      <div className="space-y-1 flex-1">
                        <Skeleton width="60%" height="0.875rem" />
                        <Skeleton width="30%" height="0.65rem" />
                      </div>
                      <Skeleton width="3.5rem" height="1.25rem" borderRadius="9999px" />
                    </div>
                  ))}
                </div>
              ) : cloudBackups.length === 0 ? (
                <p className="text-slate-400 py-4">No cloud backup archives logged yet.</p>
              ) : (
                <div className="space-y-2">
                  {cloudBackups.map((cb) => (
                    <div key={cb.key} className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg flex justify-between items-center">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-white">{cb.filename}</span>
                        <span className="text-[10px] text-slate-400 block">{cb.sizeKB} KB • {cb.lastModified}</span>
                      </div>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px]">
                        {cb.type}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Settings;
