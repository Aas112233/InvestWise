
export enum AppScreen {
  DASHBOARD = 'DASHBOARD',
  MEMBERS = 'MEMBERS',
  DEPOSITS = 'DEPOSITS',
  REQUEST_DEPOSIT = 'REQUEST_DEPOSIT',
  TRANSACTIONS = 'TRANSACTIONS',
  PROJECT_MANAGEMENT = 'PROJECT_MANAGEMENT',
  FUNDS_MANAGEMENT = 'FUNDS_MANAGEMENT',
  EXPENSES = 'EXPENSES',
  ANALYSIS = 'ANALYSIS',
  REPORTS = 'REPORTS',
  GOALS = 'GOALS',
  SETTINGS = 'SETTINGS'
}

export enum AccessLevel {
  NONE = 'NONE',
  READ = 'READ',
  WRITE = 'WRITE'
}

export interface UserPermissions {
  [key: string]: AccessLevel; // Maps AppScreen to AccessLevel
}

export interface User {
  id: string;
  memberId?: string; // Optional link to a member record
  name: string;
  email: string;
  role: 'Administrator' | 'Manager' | 'Auditor' | 'Investor';
  avatar: string;
  lastLogin: string;
  permissions: UserPermissions;
  password?: string; // Only used for mock auth simulation
}

export interface Member {
  id: string;
  memberId: string;
  name: string;
  phone: string;
  role: string;
  email: string;
  shares: number;
  totalContributed: number;
  lastActive: string;
  avatar: string;
  status: 'active' | 'pending' | 'inactive';
  hasUserAccess?: boolean;
}

export interface ProjectMemberParticipation {
  memberId: string;
  memberName: string;
  sharesInvested: number;
}

export interface ProjectUpdateRecord {
  id: string;
  type: 'Earning' | 'Expense';
  amount: number;
  description: string;
  date: string;
}

export interface Project {
  id: string;
  title: string;
  category: string;
  description: string;
  initialInvestment: number;
  totalShares: number;
  involvedMembers: ProjectMemberParticipation[];
  status: 'In Progress' | 'Completed' | 'Review';
  startDate: string;
  completionDate?: string;
  projectFundHandler: string;
  linkedFundId?: string;
  currentFundBalance: number;
  updates: ProjectUpdateRecord[];
  projectedReturn?: string;
}

export interface Fund {
  id: string;
  name: string;
  type: 'DEPOSIT' | 'PROJECT' | 'OTHER' | 'Primary' | 'Reserve';
  status: 'ACTIVE' | 'ARCHIVED';
  balance: number;
  currency: string;
  linkedProjectId?: string;
  description: string;
  handlingOfficer?: string;
  lastUpdated: string;
}

export interface FundTransfer {
  id: string;
  sourceFundId: string;
  targetFundId: string;
  amount: number;
  date: string;
  reason: string;
  authorizedBy: string;
}

export interface Deposit {
  id: string;
  memberId: string;
  memberName: string;
  shareNumber: number;
  amount: number;
  depositMonth: string;
  cashierName: string;
  status: 'Completed' | 'Pending' | 'Flagged' | 'Processing';
  date: string;
}

export interface Transaction {
  id: string;
  date: string;
  type: 'Deposit' | 'Withdrawal' | 'Investment' | 'Expense' | 'Earning';
  amount: number;
  member?: string;
  projectId?: string;
  description: string;
  status: 'Success' | 'Processing' | 'Failed';
}

export interface Expense {
  id: string;
  memberId: string;
  memberName: string;
  projectId?: string;
  projectName?: string;
  amount: number;
  category: string;
  reason: string;
  date: string;
  sourceFund: string;
}

export interface InsightData {
  title: string;
  message: string;
  type: 'positive' | 'warning' | 'info';
}
