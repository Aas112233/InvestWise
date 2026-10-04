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
  /** Stored member equity: deposits plus reinvested dividends. String decimal. */
  totalContributed?: number | string;
  totalDeposits?: number | string;
  /** Deposits only, summed from the ledger by the list service. Null when the
   *  caller did not ask for aggregates (`withTotals`). */
  totalDeposited?: string | null;
  /** YYYY-MM of the latest completed deposit, derived from the ledger. */
  lastDepositMonth?: string | null;
  /** shares x the last declared per-share rate. Null until a dividend run. */
  expectedDividend?: string | null;
  successfulDepositTotal?: number;
  warningCount?: number;
  performanceScore?: number;
  status: "active" | "pending" | "inactive" | "suspended" | string;
  avatar?: string;
  joinDate?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Auth-user link (present on full records; omitted on masked list rows). */
  userId?: string | null;
  /** True when the server hid the KYC/nominee fields from this viewer. */
  piiMasked?: boolean;
  /** KYC/nominee fields — only present on unmasked (full) records. */
  nidOrPassport?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  spouseName?: string | null;
  address?: string | null;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  nomineeNidOrPassport?: string | null;
  nomineePhone?: string | null;
}

export interface ProjectMemberParticipation {
  memberId: string;
  memberName: string;
  memberCode?: string;
  memberPhone?: string;
  memberStatus?: string;
  sharesInvested: number;
  ownershipPercentage?: number;
  tenantShareValue?: number;
  totalInvested?: number;
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
  status: "In Progress" | "Completed" | "Review" | "Cancelled" | string;
  health: "Stable" | "At Risk" | "Critical" | string;
  startDate: string;
  completionDate?: string;
  projectFundHandler?: string;
  manager?: string;
  linkedFundId?: string;
  linkedFundName?: string;
  linkedFundBalance?: number;
  currentFundBalance: number;
  totalEarnings: number;
  totalExpenses: number;
  updates?: ProjectUpdateRecord[];
  tenantShareValue?: number;
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

export type FundsHealthStatus = "Good" | "Stable" | "At Risk" | "Critical";

export interface MonthlyDepositPoint {
  /** 'YYYY-MM' bucket key (UTC). */
  month: string;
  amount: number;
  count: number;
  submittingMembers: number;
  /** % of active members who made >=1 completed deposit this month; null when no active members. */
  submissionRate: number | null;
}

export interface ProjectIncomeVsExpenses {
  id: string;
  title: string;
  income: number;
  expenses: number;
}

export interface FundsHealth {
  reserves: number;
  /** Average monthly expenses over the trailing 3 calendar months. */
  monthlyBurn: number;
  /** reserves ÷ monthlyBurn; null when nothing is burning. */
  runwayMonths: number | null;
  status: FundsHealthStatus;
}

export interface AnalyticsStats {
  totalAssets: number;
  totalMembers: number;
  activeMembers: number;
  activeProjects: number;
  /** Sum of budgets across ongoing (In Progress) projects. */
  ongoingBudget: number;
  totalDividendsDistributed: number;
  /** null = not computable yet (no historical period data exists). Never fake a number here. */
  monthlyGrowthRate: number | null;
  totalDeposits: number;
  /** Count of deposit transactions (lifetime). */
  depositCount: number;
  totalExpenses: number;
  netReserveBalance: number;
  /** Total shares distributed across members, split founding vs normal (members.role). */
  totalShares: number;
  foundingShares: number;
  normalShares: number;
  foundingMembers: number;
  normalMembers: number;
  /** SUM(projects.initialInvestment) across all projects + project count. */
  investmentsTotal: number;
  investmentsCount: number;
  /** Last 12 calendar months (oldest first), gaps filled with zeros. */
  monthlyDeposits: MonthlyDepositPoint[];
  ongoingProjectFinance: ProjectIncomeVsExpenses[];
  fundsHealth: FundsHealth;
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
