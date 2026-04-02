
import React, { createContext, useContext, useState, useEffect } from 'react';
import { Member, Project, Deposit, Expense, Fund, User, AccessLevel, AppScreen, Transaction } from '../types';
import api, { memberService, projectService, fundService, financeService, authService, analyticsService, auditService, isNetworkError, isDatabaseError, settingsService } from '../services/api';

// ... imports
export type ConnectionStatus = 'online' | 'offline' | 'degraded';

export interface SystemSettings {
  financial: {
    fiscalYearStart: string;
    baseCurrency: string;
    taxRate: number;
    accountingMethod: string;
  };
  system: {
    language: string;
    refreshInterval: string;
    theme: string;
    dateFormat: string;
    isMaintenanceMode: boolean;
  };
}

interface GlobalState {
  members: Member[];
  projects: Project[];
  deposits: Deposit[];
  expenses: Expense[];
  funds: Fund[];
  systemUsers: User[];
  currentUser: User | null;
  settings: SystemSettings | null;
  addDescription?: string; // Optional
  addMember: (m: Member) => void;
  updateMember: (m: Member) => Promise<void>;
  addProject: (p: Project) => void;
  addDeposit: (d: Deposit) => void;
  addExpense: (e: Expense) => void;
  editExpense: (id: string, e: Expense) => Promise<void>;
  updateProject: (p: Project) => void;
  deleteProject: (id: string) => void;
  addProjectUpdate: (projectId: string, update: any) => void;
  editProjectUpdate: (projectId: string, updateId: string, update: any) => Promise<void>;
  deleteProjectUpdate: (projectId: string, updateId: string) => Promise<void>;
  addFund: (f: Fund) => Promise<void>;
  updateFund: (f: Fund) => Promise<void>;
  addSystemUser: (u: User) => void;
  updateUser: (userId: string, data: Partial<User>) => Promise<void>;
  updateUserPassword: (userId: string, newPass: string) => void;
  deleteUser: (userId: string) => void;
  deleteMember: (id: string) => Promise<void>;
  onboardMember: (data: any) => Promise<void>;
  updateSettings: (s: Partial<SystemSettings>) => Promise<void>;
  connectionStatus: ConnectionStatus;
  lastOnlineAt: number | null;
  checkConnection: () => Promise<void>;
  lastError: { message: string; type: 'error' | 'warning' } | null;
  clearError: () => void;
  refreshMembers: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshFunds: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  refreshData: () => Promise<void>;
  distributeDividends: (data: any) => Promise<void>;
  transferEquity: (data: any) => Promise<void>;
  transferFunds: (data: any) => Promise<any>;
  reconcileFund: (id: string) => Promise<any>;
  transactions: Transaction[];
  globalStats: any;
  refreshAnalytics: () => Promise<void>;
  notifications: { count: number; items: any[] };
  refreshNotifications: () => Promise<void>;
}

const GlobalStateContext = createContext<GlobalState | undefined>(undefined);

const getDefaultPermissions = (role: User['role']) => {
  const perms: any = {};
  Object.values(AppScreen).forEach(screen => {
    if (role === 'Admin' || role === 'Administrator') perms[screen] = AccessLevel.WRITE;
    else if (role === 'Manager') perms[screen] = screen.includes('SETTINGS') ? AccessLevel.NONE : AccessLevel.WRITE;
    else if (role === 'Audit') perms[screen] = AccessLevel.READ;
    else if (role === 'Investor') {
      if ([AppScreen.DASHBOARD, AppScreen.DEPOSITS, AppScreen.PROJECT_MANAGEMENT, AppScreen.ANALYSIS].includes(screen)) {
        perms[screen] = AccessLevel.READ;
      } else {
        perms[screen] = AccessLevel.NONE;
      }
    }
    else if (role === 'Member') {
      if ([AppScreen.DASHBOARD, AppScreen.DEPOSITS].includes(screen)) {
        perms[screen] = AccessLevel.READ;
      } else {
        perms[screen] = AccessLevel.NONE;
      }
    }
    else perms[screen] = AccessLevel.NONE;
  });
  return perms;
};

export const GlobalStateProvider: React.FC<{ children: React.ReactNode; user: User | null }> = ({ children, user }) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [systemUsers, setSystemUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('online');
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(Date.now());
  const [lastError, setLastError] = useState<{ message: string; type: 'error' | 'warning' } | null>(null);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const [notifications, setNotifications] = useState<{ count: number; items: any[] }>({ count: 0, items: [] });

  const clearError = () => setLastError(null);

  const checkConnection = async () => {
    try {
      const start = Date.now();
      const response = await api.get('/health', { timeout: 5000 });
      const latency = Date.now() - start;

      const dbStatus = response.data.database?.status;

      // Check if database is healthy
      if (dbStatus === 'disconnected' || dbStatus === 'unreachable') {
        setConnectionStatus('offline');
        setLastError({
          message: 'Database connection lost. Some features may not work.',
          type: 'error'
        });
      } else if (dbStatus === 'slow' || latency > 1000) {
        setConnectionStatus('degraded');
        setLastError({
          message: 'Connection is slow. Performance may be affecteded.',
          type: 'warning'
        });
      } else {
        setConnectionStatus('online');
        setLastOnlineAt(Date.now());
        clearError();
      }
    } catch (error: any) {
      if (isDatabaseError(error)) {
        setConnectionStatus('offline');
        setLastError({
          message: 'Database unavailable. Retrying...',
          type: 'error'
        });
      } else if (isNetworkError(error)) {
        setConnectionStatus('offline');
        setLastError({
          message: 'Server offline. You can keep working; changes will not be saved until connection returns.',
          type: 'warning'
        });
      } else if (error.response?.status >= 500) {
        setConnectionStatus('degraded');
        setLastError({
          message: 'Server error. Please try again.',
          type: 'error'
        });
      } else {
        setConnectionStatus('online');
      }
    }
  };

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 60000);
    const handleFocus = () => checkConnection();
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const fetchMembers = async () => {
    try {
      const response = await memberService.getAll();
      const data = response.data || [];
      setMembers(data.map((m: any) => ({ ...m, id: m._id || m.id })));
    } catch (e: any) {
      console.error("Fetch members failed", e);
      if (isDatabaseError(e)) {
        setLastError({ message: 'Unable to load members. Database unavailable.', type: 'error' });
      }
    }
  };

  const fetchSettings = async () => {
    try {
      const data = await settingsService.get();
      setSettings(data);
    } catch (e: any) {
      console.error("Fetch settings failed", e);
      // Don't show error for settings - it's not critical
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await projectService.getAll();
      const data = response.data || [];
      setProjects(data.map((p: any) => ({ ...p, id: p._id || p.id })));
    } catch (e: any) {
      console.error("Fetch projects failed", e);
      if (isDatabaseError(e)) {
        setLastError({ message: 'Unable to load projects. Database unavailable.', type: 'error' });
      }
    }
  };

  const fetchFunds = async () => {
    try {
      const data = await fundService.getAll();
      setFunds(data.map((f: any) => ({ ...f, id: f._id || f.id })));
    } catch (e: any) {
      console.error("Fetch funds failed", e);
      if (isDatabaseError(e)) {
        setLastError({ message: 'Unable to load funds. Database unavailable.', type: 'error' });
      }
    }
  };

  const fetchTransactions = async () => {
    try {
      const response = await financeService.getTransactions({ limit: 1000 });
      const allTransactions = response.data || [];
      const normalized = allTransactions.map((t: any) => ({
        ...t,
        id: t._id || t.id,
        memberDisplayId: t.memberId?.memberId || 'N/A'
      }));
      setTransactions(normalized);

      const depositsList = normalized.filter((t: any) => t.type === 'Deposit').map((t: any) => ({
        id: t.id,
        memberId: t.memberId?._id || t.memberId, // Use Mongo ID for backend operations
        memberDisplayId: t.memberId?.memberId || 'N/A', // Custom ID for display
        memberName: t.memberId?.name || 'Unknown',
        shareNumber: Math.floor(t.amount / 1000),
        amount: t.amount,
        depositMonth: new Date(t.date).toLocaleString('default', { month: 'long' }) + ' ' + new Date(t.date).getFullYear(),
        cashierName: t.handlingOfficer || 'System',
        status: t.status === 'Success' ? 'Completed' : t.status,
        date: t.date,
        fundId: t.fundId?._id || t.fundId, // Ensure fundId is available
        depositMethod: t.depositMethod || 'Cash'
      }));
      setDeposits(depositsList);

      const expensesList = normalized.filter((t: any) => t.type === 'Expense').map((t: any) => ({
        id: t.id,
        memberId: t.memberId?._id || t.memberId,
        memberDisplayId: t.memberId?.memberId || 'N/A',
        memberName: t.memberId?.name || 'Unknown',
        projectId: t.projectId?._id || t.projectId,
        projectName: t.projectId?.title || '',
        amount: t.amount,
        category: t.category || 'Operational',
        reason: t.description || 'No description',
        date: t.date,
        sourceFund: t.fundId?._id || t.fundId
      }));
      setExpenses(expensesList);
    } catch (e: any) {
      console.error("Fetch transactions failed", e);
      if (isDatabaseError(e)) {
        setLastError({ message: 'Unable to load transactions. Database unavailable.', type: 'error' });
      }
    }
  };

  const fetchSystemUsers = async () => {
    if (!user || (user.role !== 'Admin' && user.role !== 'Manager' && user.role !== 'Administrator')) return;
    try {
      const data = await authService.getAllUsers();
      const standardized = data.map((u: any) => ({
        ...u,
        id: u._id || u.id
      }));
      setSystemUsers(standardized);
    } catch (e: any) {
      console.error("Fetch users failed", e);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const data = await analyticsService.getStats();
      setGlobalStats(data);
    } catch (e: any) { console.error("Fetch analytics failed", e); }
  };

  const fetchNotifications = async () => {
    if (!user || (user.role !== 'Admin' && user.role !== 'Administrator')) return;
    try {
      const data = await auditService.getNotifications();
      setNotifications({ count: data.count, items: data.notifications });
    } catch (e: any) { console.error("Fetch notifications failed", e); }
  };

  useEffect(() => {
    if (!user) return;
    if (connectionStatus === 'online') {
      fetchMembers();
      fetchProjects();
      fetchFunds();
      fetchTransactions();
      fetchAnalytics();
      fetchSettings();
      fetchSettings();
      if (user.role === 'Admin' || user.role === 'Manager' || user.role === 'Administrator') {
        fetchSystemUsers();
      }
      if (user.role === 'Admin' || user.role === 'Administrator') {
        fetchNotifications();
      }
    }
  }, [user, connectionStatus]);

  const addMember = async (m: Member) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot add member while offline.', type: 'warning' });
      return;
    }
    try {
      const newItem = await memberService.create(m);
      setMembers(prev => [newItem, ...prev]);
      fetchMembers();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to add member', type: 'error' });
      throw e;
    }
  };

  const updateMember = async (m: Member) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot update member while offline.', type: 'warning' });
      return;
    }
    try {
      const updated = await memberService.update(m.id, m);
      const standardized = { ...updated, id: updated._id || updated.id };
      setMembers(prev => prev.map(item => item.id === m.id ? standardized : item));
      fetchMembers();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to update member', type: 'error' });
      throw e;
    }
  };

  const deleteMember = async (id: string) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot delete member while offline.', type: 'warning' });
      return;
    }
    try {
      await memberService.delete(id);
      setMembers(prev => prev.filter(m => m.id !== id));
      fetchMembers();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to delete member', type: 'error' });
      throw e;
    }
  };

  const onboardMember = async (data: any) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot onboard member while offline.', type: 'warning' });
      return;
    }
    try {
      const newItem = await memberService.onboard(data);
      const standardized = { ...newItem, id: newItem._id || newItem.id };
      setMembers(prev => [standardized, ...prev]);
      fetchMembers();
      fetchAnalytics();
      if (data.systemAccess) {
        fetchSystemUsers();
      }
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to onboard member', type: 'error' });
      throw e;
    }
  };

  const addProject = async (p: Project) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot add project while offline.', type: 'warning' });
      return;
    }
    try {
      const newItem = await projectService.create(p);
      const standardized = { ...newItem, id: newItem._id || newItem.id };
      setProjects(prev => [standardized, ...prev]);
      fetchProjects();
      fetchAnalytics();
      fetchFunds();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to add project', type: 'error' });
    }
  };

  const addDeposit = async (d: Deposit) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot add deposit while offline.', type: 'warning' });
      return;
    }
    try {
      const primaryFund = funds.find(f => f.type === 'Primary');
      if (!primaryFund) throw new Error("Primary Fund not found.");
      const payload = {
        memberId: d.memberId,
        amount: d.amount,
        fundId: (primaryFund as any)._id || primaryFund.id,
        description: `Deposit for ${d.depositMonth}`,
        date: d.date,
        shareNumber: d.shareNumber
      };
      await financeService.addDeposit(payload);
      fetchTransactions();
      fetchAnalytics();
      fetchFunds();
      fetchMembers();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to add deposit', type: 'error' });
      throw e;
    }
  };

  const addExpense = async (e: Expense) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot add expense while offline.', type: 'warning' });
      return;
    }
    try {
      const targetFundId = e.sourceFund || funds.find(f => f.type === 'Primary')?.id;
      const payload = {
        amount: e.amount,
        fundId: targetFundId,
        description: e.reason,
        category: e.category,
        date: e.date,
        memberId: e.memberId,
        projectId: e.projectId
      };
      await financeService.addExpense(payload);
      fetchTransactions();
      fetchAnalytics();
      fetchFunds();
      fetchProjects();
    } catch (err: any) {
      setLastError({ message: err.message || 'Failed to add expense', type: 'error' });
    }
  };

  const editExpense = async (id: string, e: Expense) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot edit expense while offline.', type: 'warning' });
      return;
    }
    try {
      const payload = {
        amount: e.amount,
        fundId: e.sourceFund,
        description: e.reason,
        category: e.category,
        date: e.date,
        memberId: e.memberId,
        projectId: e.projectId
      };
      await financeService.editExpense(id, payload);
      fetchTransactions();
      fetchAnalytics();
      fetchFunds();
      fetchProjects();
    } catch (err: any) {
      setLastError({ message: err.message || 'Failed to edit expense', type: 'error' });
      throw err;
    }
  };

  const updateProject = async (p: Project) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot update project while offline.', type: 'warning' });
      return;
    }
    try {
      const updated = await projectService.update(p.id, p);
      const standardized = { ...updated, id: updated._id || updated.id };
      setProjects(prev => prev.map(item => item.id === p.id ? standardized : item));
      fetchProjects();
      fetchFunds();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to update project', type: 'error' });
    }
  };

  const addProjectUpdate = async (projectId: string, update: any) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot add update while offline.', type: 'warning' });
      return;
    }
    try {
      const updatedProject = await projectService.addUpdate(projectId, update);
      const standardized = { ...updatedProject, id: updatedProject._id || updatedProject.id };
      setProjects(prev => prev.map(item => item.id === projectId ? standardized : item));
      fetchProjects();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to add project update', type: 'error' });
    }
  };

  const editProjectUpdate = async (projectId: string, updateId: string, update: any) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot edit update while offline.', type: 'warning' });
      return;
    }
    try {
      const updatedProject = await projectService.editUpdate(projectId, updateId, update);
      const standardized = { ...updatedProject, id: updatedProject._id || updatedProject.id };
      setProjects(prev => prev.map(item => item.id === projectId ? standardized : item));
      fetchProjects();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to edit project update', type: 'error' });
      throw e;
    }
  };

  const deleteProjectUpdate = async (projectId: string, updateId: string) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot delete update while offline.', type: 'warning' });
      return;
    }
    try {
      const updatedProject = await projectService.deleteUpdate(projectId, updateId);
      const standardized = { ...updatedProject, id: updatedProject._id || updatedProject.id };
      setProjects(prev => prev.map(item => item.id === projectId ? standardized : item));
      fetchProjects();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to delete project update', type: 'error' });
      throw e;
    }
  };

  const deleteProject = async (id: string) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot delete project while offline.', type: 'warning' });
      return;
    }
    try {
      await projectService.delete(id);
      setProjects(prev => prev.filter(p => p.id !== id));
      fetchProjects();
      fetchFunds();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to delete project', type: 'error' });
      throw e;
    }
  };

  const addFund = async (f: Fund) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot create fund while offline.', type: 'warning' });
      return;
    }
    try {
      await fundService.create(f);
      fetchFunds();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to create fund', type: 'error' });
      throw e;
    }
  };

  const updateFund = async (f: Fund) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot update fund while offline.', type: 'warning' });
      return;
    }
    try {
      const updated = await fundService.update(f.id, f);
      const standardized = { ...updated, id: updated._id || updated.id };
      setFunds(prev => prev.map(item => item.id === f.id ? standardized : item));
      fetchFunds();
      fetchAnalytics();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to update fund', type: 'error' });
    }
  };

  const addSystemUser = async (u: User) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot add user while offline.', type: 'warning' });
      return;
    }
    try {
      if (!u.password) throw new Error("Password is required");
      const initialPermissions = u.permissions && Object.keys(u.permissions).length > 0
        ? u.permissions
        : getDefaultPermissions(u.role);

      const payload = {
        name: u.name,
        email: u.email,
        password: u.password,
        role: u.role,
        memberId: u.memberId,
        permissions: initialPermissions
      };

      const newUser = await authService.register(payload);
      const standardized = { ...newUser, id: newUser._id || newUser.id };
      setSystemUsers(prev => [...prev, standardized]);
      fetchSystemUsers();
    } catch (e: any) {
      setLastError({ message: e.message || 'Failed to create user', type: 'error' });
      throw e;
    }
  };

  const updateUser = async (userId: string, data: Partial<User>) => {
    try {
      await authService.updateUser(userId, data);

      setSystemUsers(prev => prev.map(u =>
        u.id === userId ? { ...u, ...data } : u
      ));

      // Background refresh to ensure consistency
      fetchSystemUsers();
    } catch (e: any) {
      setLastError({ message: 'Failed to update user', type: 'error' });
      throw e;
    }
  };

  const updateUserPassword = async (userId: string, newPass: string) => {
    try {
      await authService.updateUserPassword(userId, newPass);
      setLastError({ message: 'Password updated successfully', type: 'warning' });
    } catch (e: any) {
      setLastError({ message: 'Failed to reset password', type: 'error' });
      throw e;
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      await authService.deleteUser(userId);
      setSystemUsers(prev => prev.filter(u => u.id !== userId));
      fetchSystemUsers();
      setLastError({ message: 'User access revoked', type: 'warning' });
    } catch (e: any) {
      setLastError({ message: 'Failed to revoke access', type: 'error' });
    }
  };

  const updateSettings = async (s: Partial<SystemSettings>) => {
    try {
      const updated = await settingsService.update(s);
      setSettings(updated);
      setLastError({ message: 'Settings saved successfully', type: 'warning' });
    } catch (e: any) {
      setLastError({ message: 'Failed to update settings', type: 'error' });
      throw e;
    }
  };

  const distributeDividends = async (data: any) => {
    try {
      await financeService.distributeDividends(data);
      await refreshData();
    } catch (e: any) {
      setLastError({ message: e.response?.data?.message || 'Dividend distribution failed', type: 'error' });
      throw e;
    }
  };

  const transferEquity = async (data: any) => {
    try {
      await financeService.transferEquity(data);
      await refreshData();
    } catch (e: any) {
      setLastError({ message: e.response?.data?.message || 'Equity transfer failed', type: 'error' });
      throw e;
    }
  };

  const transferFunds = async (data: any) => {
    const result = await financeService.transferFunds(data);
    await fetchFunds();
    await fetchTransactions();
    await fetchAnalytics();
    return result;
  };

  const reconcileFund = async (id: string) => {
    const result = await financeService.reconcileFund(id);
    await fetchFunds(); // Refresh fund status (ReconciliationStatus)
    return result;
  };

  const refreshData = async () => {
    await Promise.all([
      fetchMembers(),
      fetchProjects(),
      fetchFunds(),
      fetchTransactions(),
      fetchSystemUsers(),
      fetchAnalytics(),
      fetchSettings(),
      user?.role === 'Admin' || user?.role === 'Administrator' ? fetchNotifications() : Promise.resolve()
    ]);
  };

  return (
    <GlobalStateContext.Provider value={{
      members, projects, deposits, expenses, funds, systemUsers, transactions, currentUser: user,
      settings,
      globalStats,
      addMember, updateMember, deleteMember, addProject, addDeposit, addExpense, editExpense, updateProject, deleteProject, addProjectUpdate, editProjectUpdate, deleteProjectUpdate,
      addFund, updateFund,
      addSystemUser, updateUser, updateUserPassword, deleteUser,
      onboardMember,
      updateSettings,
      connectionStatus, lastOnlineAt, checkConnection, lastError, clearError,
      refreshMembers: fetchMembers, refreshProjects: fetchProjects, refreshFunds: fetchFunds, refreshTransactions: fetchTransactions,
      refreshAnalytics: fetchAnalytics,
      notifications,
      refreshNotifications: fetchNotifications,
      refreshData, distributeDividends, transferEquity, transferFunds, reconcileFund
    }}>
      {children}
    </GlobalStateContext.Provider>
  );
};

export const useGlobalState = () => {
  const context = useContext(GlobalStateContext);
  if (!context) throw new Error('useGlobalState must be used within a GlobalStateProvider');
  return context;
};
