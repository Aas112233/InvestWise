/**
 * InvestWise Domain Types
 * Shared across Next.js App Router components and actions.
 */

export enum AppScreen {
  DASHBOARD = "DASHBOARD",
  MEMBERS = "MEMBERS",
  MEETINGS = "MEETINGS",
  GOVERNANCE = "GOVERNANCE",
  DEPOSITS = "DEPOSITS",
  REQUEST_DEPOSIT = "REQUEST_DEPOSIT",
  TRANSACTIONS = "TRANSACTIONS",
  PROJECT_MANAGEMENT = "PROJECT_MANAGEMENT",
  FUNDS_MANAGEMENT = "FUNDS_MANAGEMENT",
  EXPENSES = "EXPENSES",
  ANALYSIS = "ANALYSIS",
  REPORTS = "REPORTS",
  GOALS = "GOALS",
  DIVIDENDS = "DIVIDENDS",
  SETTINGS = "SETTINGS",
}

export enum AccessLevel {
  NONE = "NONE",
  READ = "READ",
  WRITE = "WRITE",
}

export interface Member {
  id: string;
  memberId: string;
  name: string;
  phone?: string;
  role?: string;
  email?: string;
  shares: number;
  totalContributed?: number;
  totalDeposits?: number | string;
  successfulDepositTotal?: number;
  warningCount?: number;
  performanceScore?: number;
  status: "active" | "pending" | "inactive" | "suspended" | string;
  avatar?: string;
  joinDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectMemberParticipation {
  memberId: string;
  memberName: string;
  sharesInvested: number;
  ownershipPercentage?: number;
}

export interface ProjectUpdateRecord {
  id: string;
  type: "Earning" | "Expense";
  amount: number;
  description: string;
  date: string;
  balanceBefore?: number;
  balanceAfter?: number;
}

export interface Project {
  id: string;
  title: string;
  category: string;
  description: string;
  initialInvestment: number;
  budget: number;
  expectedRoi: number;
  totalShares: number;
  involvedMembers?: ProjectMemberParticipation[];
  status: "In Progress" | "Completed" | "Review" | string;
  health: "Stable" | "At Risk" | "Critical" | string;
  startDate: string;
  completionDate?: string;
  projectFundHandler?: string;
  manager?: string;
  linkedFundId?: string;
  currentFundBalance: number;
  totalEarnings: number;
  totalExpenses: number;
  updates?: ProjectUpdateRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MeetingAttendee {
  id: string;
  meetingId?: string;
  memberId: string;
  attendanceStatus: "PRESENT" | "ABSENT" | "EXCUSED";
  depositStatus: "PAID_ON_TIME" | "PAID_LATE" | "PENDING";
  notes?: string;
  name?: string;
  displayId?: string;
  email?: string;
  role?: string;
  shares?: number;
  avatar?: string;
  warningCount?: number;
  performanceScore?: number;
}

export interface Meeting {
  id: string;
  title: string;
  meetingDate: string;
  meetingType: "FOUNDING_MEMBER" | "SHAREHOLDER" | "INVESTOR" | "GENERAL" | string;
  location?: string;
  agenda?: string;
  notes?: string;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  conductedBy?: string;
  startedAt?: string;
  completedAt?: string;
  totalAttendees?: number;
  presentCount?: number;
  absentCount?: number;
  excusedCount?: number;
  attendees?: MeetingAttendee[];
  penalties?: MemberPenalty[];
  stats?: {
    total: number;
    present: number;
    absent: number;
    excused: number;
    attendanceRate: number;
    penaltiesIssuedCount: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface MemberPenalty {
  id: string;
  memberId: string;
  meetingId?: string;
  tier: 1 | 2 | 3 | 4;
  title: string;
  type: "VERBAL_WARNING" | "FUND_DEDUCTION" | "SUSPENSION";
  deductionAmount: number;
  isPercentage: boolean;
  calculatedDeduction: number;
  transactionId?: string;
  fundId?: string;
  status: "ACTIVE" | "WAIVED" | "RESOLVED";
  reason: string;
  issuedBy?: string;
  issuedAt: string;
  waivedBy?: string;
  waivedAt?: string;
  waiveReason?: string;
  memberName?: string;
  memberDisplayId?: string;
  memberEmail?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Goal {
  id: string;
  _id?: string;
  user?: string;
  userId?: string;
  title: string;
  description?: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  status: "In Progress" | "Achieved" | "Cancelled";
  type: "Savings" | "Investment" | "Other" | string;
  linkedProject?: string;
  linkedProjectId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  memberId: string;
  email: string;
  role: string;
  shares: number;
  avatar?: string;
  warningCount: number;
  performanceScore: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  status: string;
}

export interface AnalyticsStats {
  totalAssets: number;
  totalMembers: number;
  activeProjects: number;
  totalDividendsDistributed: number;
  monthlyGrowthRate: number;
  totalDeposits: number;
  totalExpenses: number;
  netReserveBalance: number;
  recentActivities?: Array<{
    id: string;
    type: string;
    description: string;
    amount?: number;
    timestamp: string;
  }>;
}

export interface AnalysisData {
  metrics: {
    totalInvested: number;
    totalAssetValue: number;
    netProfit: number;
    roi: number;
    totalDividends: number;
    activeProjects: number;
    collectionEfficiency: number;
  };
  monthlyTrends: Array<{
    month: string;
    monthKey: string;
    inflow: number;
    outflow: number;
    net: number;
  }>;
  sectorAllocations: Array<{
    name: string;
    value: number;
    count: number;
    percentage: number;
  }>;
  riskDistribution: Array<{
    health: string;
    count: number;
    value: number;
  }>;
  paymentMatrix: Array<{
    id: string;
    memberId: string;
    name: string;
    avatar?: string;
    months: Record<string, "PAID" | "PENDING" | "MISSED">;
    punctualityScore: number;
  }>;
  leaderboard: Array<{
    rank: number;
    id: string;
    memberId: string;
    name: string;
    avatar?: string;
    shares: number;
    totalContributed: number;
    equitySharePercent: number;
  }>;
}

export interface Transaction {
  id: string;
  referenceNumber?: string;
  date: string | Date;
  type: string;
  category?: string;
  amount: number | string;
  status?: string;
  description?: string;
  memberId?: string | null;
  memberName?: string | null;
  memberCode?: string | null;
  fundId?: string | null;
  fundName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  depositMethod?: string | null;
  handlingOfficer?: string | null;
  createdAt?: string | Date;
}
