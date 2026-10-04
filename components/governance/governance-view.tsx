"use client";

import React, { useState, useMemo } from "react";
import {
  Award,
  ShieldAlert,
  ShieldCheck,
  Search,
  RefreshCw,
  Plus,
  Undo2,
  Eye,
  AlertTriangle,
  UserCheck,
  UserX,
  TrendingUp,
} from "lucide-react";
import { LeaderboardEntry, MemberPenalty, Member } from "@/types";
import {
  ERPDataTable,
  ERPColumn,
  ERPMetricCard,
  StatusBadge,
  Button,
  AppDropdown,
  DropdownOption,
  StatusTone,
} from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency } from "@/lib/use-tenant-settings";

interface GovernanceViewProps {
  leaderboard: LeaderboardEntry[];
  penalties: MemberPenalty[];
  members: Member[];
  isLoading: boolean;
  onOpenIssuePenalty: () => void;
  onOpenWaivePenalty: (penalty: MemberPenalty) => void;
  onRecalculateScores: () => Promise<void>;
}

export function GovernanceView({
  leaderboard,
  penalties,
  members,
  isLoading,
  onOpenIssuePenalty,
  onOpenWaivePenalty,
  onRecalculateScores,
}: GovernanceViewProps) {
  const { t } = useLocale();
  const currency = useTenantCurrency();

  const [activeTab, setActiveTab] = useState<"LEADERBOARD" | "PENALTIES">("PENALTIES");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isRecalculating, setIsRecalculating] = useState(false);

  // Metrics
  const metrics = useMemo(() => {
    let activeCount = 0;
    let waivedCount = 0;
    let tier4Count = 0;
    let totalDeductions = 0;

    penalties.forEach((p) => {
      if (p.status === "ACTIVE") activeCount++;
      if (p.status === "WAIVED") waivedCount++;
      if (p.tier === 4 && p.status === "ACTIVE") tier4Count++;
      totalDeductions += Number(p.calculatedDeduction || p.deductionAmount || 0);
    });

    return { activeCount, waivedCount, tier4Count, totalDeductions };
  }, [penalties]);

  const mapTierTone = (tier: number): StatusTone => {
    switch (tier) {
      case 1:
        return "slate";
      case 2:
        return "cyan";
      case 3:
        return "amber";
      case 4:
        return "rose";
      default:
        return "slate";
    }
  };

  const mapGradeTone = (grade: string): StatusTone => {
    if (grade.startsWith("A")) return "emerald";
    if (grade.startsWith("B")) return "cyan";
    if (grade.startsWith("C")) return "amber";
    return "rose";
  };

  // Penalties filtered
  const filteredPenalties = useMemo(() => {
    return penalties.filter((p) => {
      const matchSearch =
        !searchQuery ||
        (p.memberName && p.memberName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (p.title && p.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (p.reason && p.reason.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchTier =
        selectedTier === "ALL" || String(p.tier) === selectedTier;

      const matchStatus =
        selectedStatus === "ALL" || p.status === selectedStatus;

      return matchSearch && matchTier && matchStatus;
    });
  }, [penalties, searchQuery, selectedTier, selectedStatus]);

  // Leaderboard filtered
  const filteredLeaderboard = useMemo(() => {
    return leaderboard.filter((l) => {
      return (
        !searchQuery ||
        l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.memberId.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [leaderboard, searchQuery]);

  // Penalty columns
  const penaltyColumns: ERPColumn<MemberPenalty>[] = [
    {
      key: "memberName",
      header: t("governance.columns.member", { defaultValue: "MEMBER" }),
      sortable: true,
      render: (p) => (
        <div className="flex flex-col py-1">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {p.memberName || p.memberId}
          </span>
          {p.memberDisplayId && (
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              ID: {p.memberDisplayId}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "tier",
      header: t("governance.columns.escalationTier", { defaultValue: "TIER & ACTION" }),
      render: (p) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={mapTierTone(p.tier)} label={`Tier ${p.tier}`} />
          <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
            {p.type?.replace(/_/g, " ")}
          </span>
        </div>
      ),
    },
    {
      key: "reason",
      header: t("governance.columns.violationReason", { defaultValue: "VIOLATION REASON" }),
      render: (p) => (
        <div className="flex flex-col">
          <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
            {p.title}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 max-w-sm truncate">
            {p.reason}
          </span>
        </div>
      ),
    },
    {
      key: "deductionAmount",
      header: t("governance.columns.deduction", { defaultValue: "DEDUCTION" }),
      align: "right",
      render: (p) => {
        const amt = Number(p.calculatedDeduction || p.deductionAmount || 0);
        return (
          <span className="font-mono text-xs text-rose-600 dark:text-rose-400">
            {amt > 0 ? `-${formatMoney(amt, currency)}` : "-"}
          </span>
        );
      },
    },
    {
      key: "status",
      header: t("governance.columns.status", { defaultValue: "STATUS" }),
      render: (p) => (
        <StatusBadge
          tone={p.status === "ACTIVE" ? "rose" : p.status === "WAIVED" ? "amber" : "emerald"}
          label={p.status}
        />
      ),
    },
    {
      key: "issuedAt",
      header: t("governance.columns.issuedAt", { defaultValue: "ISSUED DATE" }),
      render: (p) => (
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {formatDate(p.issuedAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("common.actions", { defaultValue: "ACTIONS" }),
      align: "right",
      render: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          {p.status === "ACTIVE" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenWaivePenalty(p)}
              icon={Undo2}
              title={t("governance.waivePenalty", { defaultValue: "Waive Penalty" })}
            >
              {t("governance.waive", { defaultValue: "Waive" })}
            </Button>
          )}
        </div>
      ),
    },
  ];

  // Leaderboard columns
  const leaderboardColumns: ERPColumn<LeaderboardEntry>[] = [
    {
      key: "rank",
      header: t("governance.columns.rank", { defaultValue: "RANK" }),
      render: (l) => (
        <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
          #{l.rank}
        </span>
      ),
    },
    {
      key: "name",
      header: t("governance.columns.member", { defaultValue: "MEMBER" }),
      sortable: true,
      render: (l) => (
        <div className="flex flex-col py-1">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {l.name}
          </span>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            ID: {l.memberId} • {l.shares} Shares
          </span>
        </div>
      ),
    },
    {
      key: "grade",
      header: t("governance.columns.grade", { defaultValue: "GRADE" }),
      render: (l) => (
        <StatusBadge tone={mapGradeTone(l.grade)} label={l.grade} />
      ),
    },
    {
      key: "performanceScore",
      header: t("governance.columns.score", { defaultValue: "SCORE" }),
      align: "right",
      sortable: true,
      render: (l) => (
        <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
          {l.performanceScore}%
        </span>
      ),
    },
    {
      key: "warningCount",
      header: t("governance.columns.warnings", { defaultValue: "WARNINGS" }),
      align: "right",
      render: (l) => (
        <span
          className={`font-mono text-xs font-medium ${
            l.warningCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-400"
          }`}
        >
          {l.warningCount}
        </span>
      ),
    },
  ];

  const handleRecalculate = async () => {
    setIsRecalculating(true);
    try {
      await onRecalculateScores();
    } finally {
      setIsRecalculating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("governance.metrics.activePenalties", { defaultValue: "Active Penalties" })}
          value={metrics.activeCount}
          icon={ShieldAlert}
          tone="rose"
        />
        <ERPMetricCard
          label={t("governance.metrics.tier4Suspensions", { defaultValue: "Tier 4 Suspensions" })}
          value={metrics.tier4Count}
          icon={AlertTriangle}
          tone="amber"
        />
        <ERPMetricCard
          label={t("governance.metrics.waivedPenalties", { defaultValue: "Waived with Audit" })}
          value={metrics.waivedCount}
          icon={ShieldCheck}
          tone="slate"
        />
        <ERPMetricCard
          label={t("governance.metrics.totalDeductions", { defaultValue: "Total Deductions" })}
          value={formatMoney(metrics.totalDeductions, currency)}
          icon={TrendingUp}
          tone="cyan"
        />
      </div>

      {/* Tabs and Actions Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-card border border-border/80 rounded-xl shadow-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("PENALTIES")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === "PENALTIES"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
          >
            {t("governance.tabs.penaltyHub", { defaultValue: "Penalty Escalations" })} ({penalties.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("LEADERBOARD")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === "LEADERBOARD"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
          >
            {t("governance.tabs.leaderboard", { defaultValue: "Performance Leaderboard" })}
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecalculate}
            loading={isRecalculating}
            icon={RefreshCw}
          >
            {t("governance.recalculateAll", { defaultValue: "Recalculate Scores" })}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onOpenIssuePenalty}
            icon={Plus}
          >
            {t("governance.issuePenalty", { defaultValue: "Issue Penalty" })}
          </Button>
        </div>
      </div>

      {/* Active Tab View */}
      {activeTab === "PENALTIES" ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder={t("governance.searchPenalties", { defaultValue: "Search by member, reason..." })}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            <div className="w-48">
              <AppDropdown
                options={[
                  { value: "ALL", label: t("governance.allTiers", { defaultValue: "All Tiers" }) },
                  { value: "1", label: t("governance.tiers.tier1", { defaultValue: "Tier 1 - Verbal Warning" }) },
                  { value: "2", label: t("governance.tiers.tier2", { defaultValue: "Tier 2 - Minor Deduction" }) },
                  { value: "3", label: t("governance.tiers.tier3", { defaultValue: "Tier 3 - Major Deduction" }) },
                  { value: "4", label: t("governance.tiers.tier4", { defaultValue: "Tier 4 - Suspension" }) },
                ]}
                value={selectedTier}
                onChange={(val) => setSelectedTier(val || "ALL")}
                clearable={false}
              />
            </div>

            <div className="w-36">
              <AppDropdown
                options={[
                  { value: "ALL", label: t("common.allStatuses", { defaultValue: "All Statuses" }) },
                  { value: "ACTIVE", label: t("governance.statuses.active", { defaultValue: "ACTIVE" }) },
                  { value: "WAIVED", label: t("governance.statuses.waived", { defaultValue: "WAIVED" }) },
                  { value: "RESOLVED", label: t("governance.statuses.resolved", { defaultValue: "RESOLVED" }) },
                ]}
                value={selectedStatus}
                onChange={(val) => setSelectedStatus(val || "ALL")}
                clearable={false}
              />
            </div>
          </div>

          <ERPDataTable
            data={filteredPenalties}
            columns={penaltyColumns}
            isLoading={isLoading}
            page={currentPage}
            pageSize={pageSize}
            totalCount={filteredPenalties.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            emptyMessage={t("governance.noPenaltiesRecorded", { defaultValue: "No penalty records match criteria." })}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <ERPDataTable
            data={filteredLeaderboard}
            columns={leaderboardColumns}
            isLoading={isLoading}
            page={currentPage}
            pageSize={pageSize}
            totalCount={filteredLeaderboard.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            emptyMessage={t("governance.noLeaderboardData", { defaultValue: "No leaderboard data available." })}
          />
        </div>
      )}
    </div>
  );
}
