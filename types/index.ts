/**
 * InvestWise Domain Types
 * Shared across Next.js App Router components and actions.
 */


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
  /**
   * WHY the member is not active (lib/governance/status-rules.ts
   * MEMBER_STATUS_REASON): DEPOSIT_NON_COMPLIANCE | EQUITY_TRANSFERRED_OUT |
   * ADMIN_MANUAL. Null/absent when active.
   */
  statusReason?:
    | "DEPOSIT_NON_COMPLIANCE"
    | "EQUITY_TRANSFERRED_OUT"
    | "ADMIN_MANUAL"
    | null;
  avatar?: string;
  joinDate?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Auth-user link (present on full records; omitted on masked list rows). */
  userId?: string | null;
  /** True when the server hid the KYC/nominee fields from this viewer. */
  piiMasked?: boolean;
  /** True when the server hid the governance review metrics from this viewer. */
  reviewMasked?: boolean;
  /** True when any ledger transaction references this member — Delete is
   *  disabled in the directory and refused by the API (suspend instead). */
  hasTransactions?: boolean;
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
  /** Deposit fund this shareholder's capital was drawn from (ledger recorded). */
  sourceFundId?: string | null;
  sourceFundName?: string | null;
}

export interface ProjectUpdateRecord {
  id: string;
  type: "Earning" | "Expense";
  amount: number;
  description: string;
  date: string;
  balanceBefore?: number;
  balanceAfter?: number;
  /** Ledger row this posting created — the printable receipt is keyed on it. */
  transactionId?: string | null;
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
  /** True once the project has earnings/expenses: capital structure is history. */
  capitalLocked?: boolean;
  /** Settled & closed: one-way permanent lock, set by a "Distribute Complete Project" run. */
  isLocked?: boolean;
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
  /**
   * #48 — provenance of `currentAmount`. `Manual` = hand-typed, not backed by a
   * fund balance (rendered as "Manual — unverified"). `Allocation` reserved.
   */
  progressSource?: "Manual" | "Allocation" | string;
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
  /**
   * null when the member has not been scored yet. Callers must render "—" for
   * null: the API used to substitute 100 for a missing score, which ranked an
   * unscored member first on the board and labelled them A+.
   */
  performanceScore: number | null;
  grade: "A+" | "A" | "B" | "C" | "D" | "F" | null;
  /** True when no score exists yet (see `performanceScore`). */
  unrated?: boolean;
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
  /** All-time Earning ledger total — the mirror of totalExpenses. */
  totalIncome: number;
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
    /** null = no slot was due to be evaluated (future FY / no monthly members). */
    collectionEfficiency: number | null;
    /** Full roster size, so the view can say "Top 15 of N" when truncated. */
    totalShareholders?: number;
  };
  /**
   * H9 — whether deposit obligations were measured at all this period.
   *
   * A blank payment matrix and a "—" efficiency score mean "money is owed" for a
   * monthly organisation and "nothing was ever due" for a flexible one. The view uses
   * this to say which, so an unmeasured value is never read as compliance. Optional
   * because cached responses produced before this field existed omit it; absence is
   * treated as monthly (the measured, stricter reading).
   */
  depositModel?: {
    schedule: "monthly" | "flexible";
    obligationMeasured: boolean;
  };
  monthlyTrends: Array<{
    month: string;
    monthKey: string;
    /** Absolute calendar month of the slot ('YYYY-MM') — server-authoritative. */
    monthSlot?: string;
    /** Calendar year the slot falls in — server-authoritative. */
    calYear?: number;
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
    /** null = nothing was due to be evaluated for this member in this FY. */
    punctualityScore: number | null;
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
  /** Server-derived FY label ("2025-26") — the client must not re-derive it. */
  fiscalYearLabel?: string;
  /**
   * Which scope the response covers. When `memberScoped`, the cash-flow chart,
   * the regularity matrix, "Total Capital Invested" and "Total Dividends" are
   * member-scoped while the treasury / net-return / ROI KPIs and the sector,
   * risk and leaderboard tabs remain tenant-wide — the view must badge those
   * so a tenant-wide figure is never misread as the member's.
   */
  scope?: {
    memberScoped: boolean;
    memberName: string | null;
  };
}

export interface Transaction {
  id: string;
  /**
   * Client-facing reference, e.g. `DEP-2026-00042`. Assigned by the database
   * (migration 0026) and the only value that should be rendered or printed.
   * Use `ledgerRef()` from `@/lib/doc-number` rather than reading this directly,
   * so the fallback policy stays in one place.
   */
  docNumber?: string | null;
  /**
   * Internal idempotency token and the clerk's own bank/challan number. Do not
   * render as the row's reference — see `lib/doc-number.ts`.
   */
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
