"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  DollarSign,
  TrendingUp,
  Activity,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Layers,
  Clock,
  Pencil,
  Users,
  PieChart,
  Landmark,
  ShieldCheck,
  History,
  FileText,
} from "lucide-react";
import { Project, ProjectUpdateRecord, ProjectMemberParticipation } from "@/types";
import {
  ERPMetricCard,
  StatusBadge,
  Button,
  ERPDataTable,
  ERPColumn,
  StatusTone,
} from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { usePermissions } from "@/lib/use-permissions";
import { apiClient } from "@/lib/api-client";

interface ProjectDetailViewProps {
  project: Project;
  onBack: () => void;
  onOpenAddUpdate: () => void;
  onOpenEdit?: () => void;
  onOpenDistributeReturns?: () => void;
}

interface ProjectTransaction {
  id: string;
  referenceNumber: string;
  date: string;
  type: string;
  category?: string;
  amount: number | string;
  status: string;
  description: string;
  memberId?: string;
  memberName?: string;
  memberCode?: string;
  fundId?: string;
  fundName?: string;
  handlingOfficer?: string;
  createdAt: string;
}

export function ProjectDetailView({
  project,
  onBack,
  onOpenAddUpdate,
  onOpenEdit,
  onOpenDistributeReturns,
}: ProjectDetailViewProps) {
  const { t } = useLocale();
  const { can } = usePermissions();
  const canWrite = can("PROJECT_MANAGEMENT", "WRITE");

  // 3-Tab Architecture
  const [activeTab, setActiveTab] = useState<"overview" | "updates" | "timeline">("overview");

  // Pagination states
  const [updatesPage, setUpdatesPage] = useState(1);
  const [updatesPageSize, setUpdatesPageSize] = useState(10);
  const [shareholdersPage, setShareholdersPage] = useState(1);
  const [shareholdersPageSize, setShareholdersPageSize] = useState(10);
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelinePageSize, setTimelinePageSize] = useState(10);

  const updates = project.updates || [];
  const shareholders = project.involvedMembers || [];
  const tenantShareValue = project.tenantShareValue || 1000;

  // Query transactions for Tab 3 (Timeline & Ledger)
  const { data: transactionsData = [], isLoading: isLoadingTransactions } = useQuery<ProjectTransaction[]>({
    queryKey: ["transactions", { projectId: project.id }],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: ProjectTransaction[] } | ProjectTransaction[]>(
          `/projects/${project.id}/transactions`
        );
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
    },
    enabled: activeTab === "timeline",
  });

  const mapStatusTone = (status: string): StatusTone => {
    const s = status?.toLowerCase() || "";
    if (s.includes("progress") || s.includes("active")) return "cyan";
    if (s.includes("complete")) return "emerald";
    if (s.includes("risk") || s.includes("review")) return "amber";
    if (s.includes("critical") || s.includes("cancel")) return "rose";
    return "slate";
  };

  const budgetUsedPercent =
    project.budget > 0
      ? Math.min(100, Math.round(((project.totalExpenses || 0) / project.budget) * 100))
      : 0;

  const totalCapitalContributed = shareholders.reduce((acc, s) => {
    const invested = s.totalInvested !== undefined ? s.totalInvested : (s.sharesInvested || 0) * tenantShareValue;
    return acc + invested;
  }, 0);

  const netOperationalMargin = (project.totalEarnings || 0) - (project.totalExpenses || 0);

  // Tab 1: Shareholders Table Columns
  const shareholderColumns: ERPColumn<ProjectMemberParticipation>[] = [
    {
      key: "memberName",
      header: t("projects.memberLabel", { defaultValue: "MEMBER" }),
      sortable: true,
      render: (m) => (
        <div>
          <div className="font-semibold text-foreground text-xs">{m.memberName}</div>
          {m.memberCode && (
            <div className="text-[10px] font-mono text-muted-foreground">{m.memberCode}</div>
          )}
        </div>
      ),
    },
    {
      key: "sharesInvested",
      header: t("projects.sharesLabel", { defaultValue: "SHARES" }),
      align: "center",
      sortable: true,
      render: (m) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-muted text-foreground">
          {m.sharesInvested} {m.sharesInvested === 1 ? "share" : "shares"}
        </span>
      ),
    },
    {
      key: "tenantShareValue",
      header: t("projects.shareValue", { defaultValue: "UNIT SHARE VALUE" }),
      align: "right",
      render: (m) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatMoney(m.tenantShareValue || tenantShareValue)}
        </span>
      ),
    },
    {
      key: "totalInvested",
      header: t("projects.shareholders.capital", { defaultValue: "INVESTED CAPITAL" }),
      align: "right",
      sortable: true,
      render: (m) => {
        const capital = m.totalInvested !== undefined ? m.totalInvested : (m.sharesInvested || 0) * tenantShareValue;
        return (
          <span className="font-mono text-xs font-semibold text-foreground">
            {formatMoney(capital)}
          </span>
        );
      },
    },
    {
      key: "ownershipPercentage",
      header: t("projects.shareholders.ownership", { defaultValue: "OWNERSHIP" }),
      align: "center",
      sortable: true,
      render: (m) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-primary/10 text-primary">
          {m.ownershipPercentage ? `${Number(m.ownershipPercentage).toFixed(1)}%` : "0.0%"}
        </span>
      ),
    },
    {
      key: "memberStatus",
      header: t("common.status", { defaultValue: "STATUS" }),
      align: "center",
      render: (m) => (
        <StatusBadge tone={m.memberStatus === "inactive" ? "rose" : "emerald"} label={m.memberStatus || "active"} />
      ),
    },
  ];

  // Tab 2: Financial Updates Table Columns
  const updateColumns: ERPColumn<ProjectUpdateRecord>[] = [
    {
      key: "date",
      header: t("common.date", { defaultValue: "DATE" }),
      sortable: true,
      render: (u) => (
        <span className="text-xs font-mono text-muted-foreground">
          {formatDate(u.date, true)}
        </span>
      ),
    },
    {
      key: "type",
      header: t("common.type", { defaultValue: "TYPE" }),
      render: (u) => (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
            u.type === "Earning"
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
              : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
          }`}
        >
          {u.type === "Earning" ? (
            <ArrowUpRight className="w-3 h-3" />
          ) : (
            <ArrowDownLeft className="w-3 h-3" />
          )}
          {u.type}
        </span>
      ),
    },
    {
      key: "amount",
      header: t("finance.amount", { defaultValue: "AMOUNT" }),
      align: "right",
      sortable: true,
      render: (u) => (
        <span
          className={`font-mono text-xs font-semibold ${
            u.type === "Earning"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {u.type === "Earning" ? "+" : "-"}
          {formatMoney(u.amount)}
        </span>
      ),
    },
    {
      key: "description",
      header: t("finance.description", { defaultValue: "DESCRIPTION" }),
      render: (u) => (
        <span className="text-xs text-foreground">
          {u.description}
        </span>
      ),
    },
    {
      key: "balanceAfter",
      header: t("finance.balanceAfter", { defaultValue: "BALANCE SNAPSHOT" }),
      align: "right",
      render: (u) => (
        <span className="font-mono text-xs text-muted-foreground">
          {u.balanceAfter !== undefined ? formatMoney(u.balanceAfter) : "-"}
        </span>
      ),
    },
  ];

  // Tab 3: Timeline Table Columns
  const transactionColumns: ERPColumn<ProjectTransaction>[] = [
    {
      key: "date",
      header: t("common.date", { defaultValue: "DATE" }),
      sortable: true,
      render: (tx) => (
        <span className="text-xs font-mono text-muted-foreground">
          {formatDate(tx.date, true)}
        </span>
      ),
    },
    {
      key: "referenceNumber",
      header: t("transactions.reference", { defaultValue: "REF #" }),
      render: (tx) => (
        <span className="text-[11px] font-mono font-medium text-foreground bg-muted/60 px-1.5 py-0.5 rounded">
          {tx.referenceNumber}
        </span>
      ),
    },
    {
      key: "type",
      header: t("common.type", { defaultValue: "TYPE" }),
      render: (tx) => {
        const isPositive = ["Project Investment", "Deposit", "Earning", "Investment"].includes(tx.type);
        return (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
              isPositive
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
            }`}
          >
            {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
            {tx.type}
          </span>
        );
      },
    },
    {
      key: "description",
      header: t("finance.description", { defaultValue: "DESCRIPTION" }),
      render: (tx) => (
        <div>
          <span className="text-xs text-foreground block">{tx.description}</span>
          {tx.memberName && (
            <span className="text-[10px] text-muted-foreground block">
              Member: {tx.memberName} {tx.memberCode ? `(${tx.memberCode})` : ""}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: t("finance.amount", { defaultValue: "AMOUNT" }),
      align: "right",
      sortable: true,
      render: (tx) => {
        const isPositive = ["Project Investment", "Deposit", "Earning", "Investment"].includes(tx.type);
        return (
          <span
            className={`font-mono text-xs font-semibold ${
              isPositive
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {isPositive ? "+" : "-"}
            {formatMoney(tx.amount)}
          </span>
        );
      },
    },
    {
      key: "handlingOfficer",
      header: t("projects.officer", { defaultValue: "OFFICER" }),
      render: (tx) => (
        <span className="text-[11px] text-muted-foreground font-mono">
          {tx.handlingOfficer || "-"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Navigation & Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} icon={ArrowLeft}>
          {t("common.backToProjects", { defaultValue: "Back to Projects" })}
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          {canWrite && onOpenDistributeReturns && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenDistributeReturns}
              icon={TrendingUp}
            >
              {t("projects.shareholders.distributeReturns", { defaultValue: "Distribute Returns" })}
            </Button>
          )}

          {canWrite && onOpenEdit && (
            <Button variant="outline" size="sm" onClick={onOpenEdit} icon={Pencil}>
              {t("common.edit", { defaultValue: "Edit" })}
            </Button>
          )}

          {canWrite && (
            <Button variant="primary" size="sm" onClick={onOpenAddUpdate} icon={Plus}>
              {t("projects.addUpdate", { defaultValue: "Post Disbursement / Earning" })}
            </Button>
          )}
        </div>
      </div>

      {/* Hero Card */}
      <div className="p-6 bg-card border border-border/80 rounded-xl shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {project.category}
              </span>
              <StatusBadge tone={mapStatusTone(project.status)} label={project.status} />
              <StatusBadge
                tone={project.health === "Stable" ? "emerald" : "amber"}
                label={project.health || "Stable"}
              />
              {project.linkedFundName && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                  <Landmark className="w-3 h-3" />
                  {project.linkedFundName}
                </span>
              )}
            </div>

            <h1 className="text-xl font-bold text-foreground">
              {project.title}
            </h1>
            <p className="mt-2 text-xs text-muted-foreground max-w-2xl leading-relaxed">
              {project.description || t("projects.noDescription", { defaultValue: "No description provided." })}
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span>
                {formatDate(project.startDate)}
                {project.completionDate && ` → ${formatDate(project.completionDate)}`}
              </span>
            </div>
            {project.projectFundHandler && (
              <span className="font-mono text-[11px]">
                {t("projects.handlerLabel", { name: project.projectFundHandler, defaultValue: `Handler: ${project.projectFundHandler}` })}
              </span>
            )}
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span>{t("projects.expectedRoi", { defaultValue: "Target ROI" })}: <strong>{project.expectedRoi}%</strong></span>
              <span>•</span>
              <span>{t("projects.totalShares", { defaultValue: "Total Shares" })}: <strong>{project.totalShares}</strong></span>
            </div>
          </div>
        </div>

        {/* Budget utilization bar */}
        <div className="mt-6 pt-4 border-t border-border/80">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-foreground">
              {t("projects.budgetUtilization", { defaultValue: "Budget Utilization" })}
            </span>
            <span className="font-mono text-muted-foreground">
              {budgetUsedPercent}% ({formatMoney(project.totalExpenses || 0)} of {formatMoney(project.budget)})
            </span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                budgetUsedPercent > 90
                  ? "bg-rose-500"
                  : budgetUsedPercent > 70
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
              style={{ width: `${budgetUsedPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 3-Tab Bar */}
      <div className="flex items-center border-b border-border/80 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>{t("projects.tabs.overview", { defaultValue: "Overview & Shareholders" })}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("updates")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === "updates"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>{t("projects.tabs.updates", { defaultValue: "Financial Updates" })}</span>
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-foreground">
            {updates.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("timeline")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === "timeline"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>{t("projects.tabs.timeline", { defaultValue: "Timelines & Transactions" })}</span>
        </button>
      </div>

      {/* TAB 1: OVERVIEW & SHAREHOLDERS */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <ERPMetricCard
              label={t("projects.columns.budget", { defaultValue: "Total Budget" })}
              value={formatMoney(project.budget)}
              icon={DollarSign}
              tone="slate"
            />
            <ERPMetricCard
              label={t("projects.columns.balance", { defaultValue: "Available Balance" })}
              value={formatMoney(project.currentFundBalance)}
              icon={TrendingUp}
              tone="emerald"
            />
            <ERPMetricCard
              label={t("projects.columns.earnings", { defaultValue: "Total Earnings" })}
              value={formatMoney(project.totalEarnings)}
              icon={Activity}
              tone="cyan"
            />
            <ERPMetricCard
              label={t("projects.columns.expenses", { defaultValue: "Total Expenses" })}
              value={formatMoney(project.totalExpenses)}
              icon={DollarSign}
              tone="rose"
            />
            <ERPMetricCard
              label={t("projects.totalShares", { defaultValue: "Total Shares" })}
              value={project.totalShares}
              icon={PieChart}
              tone="slate"
            />
            <ERPMetricCard
              label={t("projects.shareholders.capital", { defaultValue: "Capitalized Equity" })}
              value={formatMoney(totalCapitalContributed)}
              icon={Users}
              tone="emerald"
            />
          </div>

          {/* Shareholders Registry Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  {t("projects.shareholders.title", { defaultValue: "Project Shareholders & Equity Ownership" })}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {t("projects.shareholders.tenantShareValue", {
                    value: formatMoney(tenantShareValue),
                    defaultValue: `Valuation: ${formatMoney(tenantShareValue)} per unit share`,
                  })}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {canWrite && onOpenDistributeReturns && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenDistributeReturns}
                    icon={TrendingUp}
                  >
                    {t("projects.shareholders.distributeReturns", { defaultValue: "Distribute Returns" })}
                  </Button>
                )}
                <span className="text-xs text-muted-foreground font-mono">
                  {shareholders.length} {t("common.members", { defaultValue: "shareholders" })}
                </span>
              </div>
            </div>

            <ERPDataTable
              data={shareholders}
              columns={shareholderColumns}
              page={shareholdersPage}
              pageSize={shareholdersPageSize}
              totalCount={shareholders.length}
              onPageChange={setShareholdersPage}
              onPageSizeChange={setShareholdersPageSize}
              emptyMessage={t("projects.shareholders.noShareholders", { defaultValue: "No shareholders assigned to this project." })}
            />
          </div>
        </div>
      )}

      {/* TAB 2: FINANCIAL UPDATES (INCOMES & EXPENSES) */}
      {activeTab === "updates" && (
        <div className="space-y-6">
          {/* Summary Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-card border border-border/80 rounded-xl">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                {t("projects.cumulativeRevenue", { defaultValue: "Cumulative Earnings" })}
              </span>
              <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                +{formatMoney(project.totalEarnings || 0)}
              </span>
            </div>

            <div className="p-4 bg-card border border-border/80 rounded-xl">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                {t("projects.operatingOverhead", { defaultValue: "Cumulative Expenses" })}
              </span>
              <span className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400">
                -{formatMoney(project.totalExpenses || 0)}
              </span>
            </div>

            <div className="p-4 bg-card border border-border/80 rounded-xl">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                {t("projects.netOperationalMargin", { defaultValue: "Net Operational Margin" })}
              </span>
              <span
                className={`text-lg font-bold font-mono ${
                  netOperationalMargin >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {netOperationalMargin >= 0 ? "+" : ""}
                {formatMoney(netOperationalMargin)}
              </span>
            </div>
          </div>

          {/* Disbursements & Earnings History Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  {t("projects.disbursementsLedger", { defaultValue: "Disbursements & Earnings History" })}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {t("projects.auditTrailDesc", { defaultValue: "All income and expense entries for this project" })}
                </p>
              </div>

              {canWrite && (
                <Button variant="primary" size="sm" onClick={onOpenAddUpdate} icon={Plus}>
                  {t("projects.addUpdate", { defaultValue: "Post Disbursement / Earning" })}
                </Button>
              )}
            </div>

            <ERPDataTable
              data={updates}
              columns={updateColumns}
              page={updatesPage}
              pageSize={updatesPageSize}
              totalCount={updates.length}
              onPageChange={setUpdatesPage}
              onPageSizeChange={setUpdatesPageSize}
              emptyMessage={t("projects.noUpdatesRecorded", { defaultValue: "No disbursement or earning records for this project." })}
            />
          </div>
        </div>
      )}

      {/* TAB 3: TIMELINES & TRANSACTIONS */}
      {activeTab === "timeline" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                {t("projects.timeline.title", { defaultValue: "Project Lifecycle & Financial Timeline" })}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {t("projects.timeline.totalEvents", { count: transactionsData.length, defaultValue: `${transactionsData.length} ledger events recorded` })}
              </p>
            </div>
          </div>

          <ERPDataTable
            data={transactionsData}
            columns={transactionColumns}
            page={timelinePage}
            pageSize={timelinePageSize}
            totalCount={transactionsData.length}
            onPageChange={setTimelinePage}
            onPageSizeChange={setTimelinePageSize}
            emptyMessage={t("projects.timeline.empty", { defaultValue: "No transactions or ledger events recorded for this project yet." })}
          />
        </div>
      )}
    </div>
  );
}
