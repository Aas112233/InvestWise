
import React, { createContext, useContext, useState, useEffect } from 'react';
import { Member, Project, Deposit, Expense, Fund, User, AccessLevel, AppScreen, Transaction } from '../types';
import api, { memberService, projectService, fundService, financeService, authService, isNetworkError } from '../services/api';

export type ConnectionStatus = 'online' | 'offline' | 'degraded';

interface GlobalState {
  members: Member[];
  projects: Project[];
  deposits: Deposit[];
  expenses: Expense[];
  funds: Fund[];
  systemUsers: User[];
  currentUser: User | null;
  addDescription?: string; // Optional
  addMember: (m: Member) => void;
  updateMember: (m: Member) => Promise<void>;
  addProject: (p: Project) => void;
  addDeposit: (d: Deposit) => void;
  addExpense: (e: Expense) => void;
  updateProject: (p: Project) => void;
  deleteProject: (id: string) => void;
  addProjectUpdate: (projectId: string, update: any) => void;
  addFund: (f: Fund) => Promise<void>;
  updateFund: (f: Fund) => Promise<void>;
  addSystemUser: (u: User) => void;
  updateUserPermissions: (userId: string, screen: AppScreen, level: AccessLevel) => void;
  updateUserPassword: (userId: string, newPass: string) => void;
  deleteUser: (userId: string) => void;
  deleteMember: (id: string) => Promise<void>;
  connectionStatus: ConnectionStatus;
  lastOnlineAt: number | null;
  checkConnection: () => Promise<void>;
  lastError: { message: string; type: 'error' | 'warning' } | null;
  clearError: () => void;
  refreshMembers: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshFunds: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  transactions: Transaction[];
}

const GlobalStateContext = createContext<GlobalState | undefined>(undefined);

const getDefaultPermissions = (role: User['role']) => {
  const perms: any = {};
  Object.values(AppScreen).forEach(screen => {
    if (role === 'Administrator') perms[screen] = AccessLevel.WRITE;
    else if (role === 'Manager') perms[screen] = screen.includes('SETTINGS') ? AccessLevel.NONE : AccessLevel.WRITE;
    else if (role === 'Investor') {
      if ([AppScreen.DASHBOARD, AppScreen.DEPOSITS, AppScreen.PROJECT_MANAGEMENT, AppScreen.ANALYSIS].includes(screen)) {
        perms[screen] = AccessLevel.READ;
      } else {
        perms[screen] = AccessLevel.NONE;
      }
    }
    else perms[screen] = AccessLevel.READ;
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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('online');
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(Date.now());
  const [lastError, setLastError] = useState<{ message: string; type: 'error' | 'warning' } | null>(null);

  const clearError = () => setLastError(null);

  const checkConnection = async () => {
    try {
      const start = Date.now();
      await api.get('/health');
      const latency = Date.now() - start;

      if (connectionStatus !== 'online') {
        // We just came back online
        setConnectionStatus('online');
        // We could trigger a refetch here if needed
      }
      setLastOnlineAt(Date.now());
      if (latency > 1000) setConnectionStatus('degraded');
      else setConnectionStatus('online');
    } catch (error: any) {
      if (isNetworkError(error)) {
        setConnectionStatus('offline');
      } else if (error.response?.status >= 500) {
        setConnectionStatus('degraded');
      } else {
        // 404 or other errors might still mean we are connected but endpoint is wrong?
        // Assume online if we got a response (even 404), but maybe degraded logic?
        setConnectionStatus('online');
      }
    }
  };

  useEffect(() => {
    checkConnection(); // Initial check
    const interval = setInterval(checkConnection, 60000);

    // Also check on window focus
    const handleFocus = () => checkConnection();
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const fetchMembers = async () => {
    try {
      const data = await memberService.getAll();
      setMembers(data.map((m: any) => ({ ...m, id: m._id || m.id })));
    } catch (e: any) { console.error("Fetch members failed", e); }
  };

  const fetchProjects = async () => {
    try {
      const data = await projectService.getAll();
      setProjects(data.map((p: any) => ({ ...p, id: p._id || p.id })));
    } catch (e: any) { console.error("Fetch projects failed", e); }
  };

  const fetchFunds = async () => {
    try {
      const data = await fundService.getAll();
      setFunds(data.map((f: any) => ({ ...f, id: f._id || f.id })));
    } catch (e: any) { console.error("Fetch funds failed", e); }
  };

  const fetchTransactions = async () => {
    try {
      const allTransactions = await financeService.getTransactions();
      const normalized = allTransactions.map((t: any) => ({
        ...t,
        id: t._id || t.id
      }));
      setTransactions(normalized);

      const depositsList = normalized.filter((t: any) => t.type === 'Deposit').map((t: any) => ({
        id: t.id,
        memberId: t.memberId?._id || t.memberId,
        memberName: t.memberId?.name || 'Unknown',
        shareNumber: Math.floor(t.amount / 1000),
        amount: t.amount,
        depositMonth: new Date(t.date).toLocaleString('default', { month: 'long' }) + ' ' + new Date(t.date).getFullYear(),
        cashierName: t.handlingOfficer || 'System',
        status: t.status === 'Success' ? 'Completed' : t.status,
        date: t.date
      }));
      setDeposits(depositsList);

      const expensesList = normalized.filter((t: any) => t.type === 'Expense');
      setExpenses(expensesList);
    } catch (e: any) { console.error("Fetch transactions failed", e); }
  };

  // Initial Fetch
  useEffect(() => {
    if (!user) return;
    if (connectionStatus === 'online') {
      fetchMembers();
      fetchProjects();
      fetchFunds();
      fetchTransactions();
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
      fetchMembers(); // Revalidate
    } catch (e: any) {
      console.error(e);
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
      // @ts-ignore
      const standardized = { ...updated, id: updated._id || updated.id };
      setMembers(prev => prev.map(item => item.id === m.id ? standardized : item));
      fetchMembers();
    } catch (e: any) {
      console.error(e);
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
    } catch (e: any) {
      console.error(e);
      setLastError({ message: e.message || 'Failed to delete member', type: 'error' });
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
      // @ts-ignore
      const standardized = { ...newItem, id: newItem._id || newItem.id };
      setProjects(prev => [standardized, ...prev]);
      fetchProjects();
      fetchFunds(); // Refresh funds as a new Project Fund is auto-created
    } catch (e: any) {
      console.error(e);
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

      if (!primaryFund) {
        throw new Error("Primary Fund not found. Cannot process deposit.");
      }

      const payload = {
        memberId: d.memberId,
        amount: d.amount,
        fundId: (primaryFund as any)._id || primaryFund.id,
        description: `Deposit for ${d.depositMonth}`,
        date: d.date,
        shareNumber: d.shareNumber
      };

      await financeService.addDeposit(payload);
      const newItem = { ...d, status: 'Completed' };
      setDeposits(prev => [newItem as Deposit, ...prev]);
      fetchTransactions();
      fetchFunds(); // Deposits update funds
      fetchMembers(); // Deposits update member contributions
    } catch (e: any) {
      console.error(e);
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
      // Use provided sourceFund as ID, or fallback to Primary Fund
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
      fetchFunds(); // Expenses reduce funds
      fetchProjects(); // Expenses update project balances
    } catch (err: any) {
      console.error(err);
      setLastError({ message: err.message || 'Failed to add expense', type: 'error' });
    }
  };

  const updateProject = async (p: Project) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot update project while offline.', type: 'warning' });
      return;
    }
    try {
      const updated = await projectService.update(p.id, p);
      // @ts-ignore
      const standardized = { ...updated, id: updated._id || updated.id };
      setProjects(prev => prev.map(item => item.id === p.id ? standardized : item));
      fetchProjects();
    } catch (e: any) {
      console.error(e);
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
      // @ts-ignore
      const standardized = { ...updatedProject, id: updatedProject._id || updatedProject.id };
      setProjects(prev => prev.map(item => item.id === projectId ? standardized : item));
      fetchProjects();
    } catch (e: any) {
      console.error(e);
      setLastError({ message: e.message || 'Failed to add project update', type: 'error' });
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
    } catch (e: any) {
      console.error(e);
      setLastError({ message: e.message || 'Failed to delete project', type: 'error' });
    }
  };

  const addFund = async (f: Fund) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot create fund while offline.', type: 'warning' });
      return;
    }
    try {
      // @ts-ignore - Backend expects specific fields, frontend Fund interface might have extra/less
      await fundService.create(f);
      fetchFunds();
    } catch (e: any) {
      console.error(e);
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
      // @ts-ignore
      const standardized = { ...updated, id: updated._id || updated.id };
      setFunds(prev => prev.map(item => item.id === f.id ? standardized : item));
      fetchFunds();
    } catch (e: any) {
      console.error(e);
      setLastError({ message: e.message || 'Failed to update fund', type: 'error' });
    }
  };

  const addSystemUser = async (u: User) => {
    if (connectionStatus === 'offline') {
      setLastError({ message: 'Cannot add user while offline.', type: 'warning' });
      return;
    }
    try {
      if (!u.password) {
        throw new Error("Password is required for system user creation");
      }
      const payload = {
        name: u.name,
        email: u.email,
        password: u.password,
        role: u.role
      };
      const newUser = await authService.register(payload);
      const userWithPermissions = {
        ...newUser,
        permissions: getDefaultPermissions(u.role)
      };
      setSystemUsers(prev => [...prev, userWithPermissions]);
    } catch (e: any) {
      console.error('Failed to create system user:', e);
      setLastError({ message: e.message || 'Failed to create user', type: 'error' });
      throw e;
    }
  };

  const updateUserPermissions = (userId: string, screen: AppScreen, level: AccessLevel) => {
    // This looks local only too in original code?
    setSystemUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, permissions: { ...u.permissions, [screen]: level } } : u
    ));
  };

  const updateUserPassword = (userId: string, newPass: string) => {
    setSystemUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, password: newPass } : u
    ));
  };

  const deleteUser = (userId: string) => setSystemUsers(prev => prev.filter(u => u.id !== userId));

  return (
    <GlobalStateContext.Provider value={{
      members, projects, deposits, expenses, funds, systemUsers, transactions, currentUser: user,
      addMember, updateMember, deleteMember, addProject, addDeposit, addExpense, updateProject, deleteProject, addProjectUpdate,
      addFund, updateFund,
      addSystemUser, updateUserPermissions, updateUserPassword, deleteUser,
      connectionStatus, lastOnlineAt, checkConnection, lastError, clearError,
      refreshMembers: fetchMembers, refreshProjects: fetchProjects, refreshFunds: fetchFunds, refreshTransactions: fetchTransactions
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
