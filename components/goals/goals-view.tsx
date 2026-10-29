"use client";

import React, { useState, useMemo } from "react";
import {
  Target,
  Plus,
  Calendar,
  DollarSign,
  TrendingUp,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  Trash2,
  Edit2,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { Goal, Project } from "@/types";
import {
  ERPDataTable,
  ERPColumn,
  ERPMetricCard,
  StatusBadge,
  Button,
  AppDropdown,
  DropdownOption,
  StatusTone,
  ERPConfirmDialog,
} from "@/components/ui";
import { formatMoney, formatDateOnly } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency } from "@/lib/use-tenant-settings";

interface GoalsViewProps {
  goals: Goal[];
  projects: Project[];
  isLoading: boolean;
  onOpenCreate: () => void;
  onOpenEdit: (goal: Goal) => void;
  onDeleteGoal: (goalId: string) => Promise<void>;
  onUpdateProgress: (goalId: string, newAmount: number) => Promise<void>;
}

export function GoalsView({
  goals,
  projects,
  isLoading,
  onOpenCreate,
  onOpenEdit,
  onDeleteGoal,
  onUpdateProgress,
}: GoalsViewProps) {
  const { t } = useLocale();
  const currency = useTenantCurrency();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Deletion is destructive — confirm through the app dialog, not window.confirm.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Compute Metrics
  const metrics = useMemo(() => {
    let totalTarget = 0;
    let totalCurrent = 0;
    let achievedCount = 0;

    goals.forEach((g) => {
      totalTarget += Number(g.targetAmount || 0);
      totalCurrent += Number(g.currentAmount || 0);
      if (g.status === "Achieved") achievedCount++;
    });

    const completionRate = totalTarget > 0 ? Math.round((totalCurrent / totalTarget) * 100) : 0;
    return { totalTarget, totalCurrent, achievedCount, completionRate, count: goals.length };
  }, [goals]);

  // Project map for quick lookup
  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => map.set(p.id, p.title));
    return map;
  }, [projects]);

  // Type labels are translated per locale; fall back to the raw value for
  // unknown/legacy types so nothing renders blank.
  const typeLabel = (type: string) => {
    const key =
      type === "Savings"
        ? "goals.form.types.savings"
        : type === "Investment"
          ? "goals.form.types.investment"
          : type === "Emergency"
            ? "goals.form.types.emergency"
            : type === "Other"
              ? "goals.form.types.other"
              : null;
    return key ? t(key, { defaultValue: type }) : type;
  };

  const filteredGoals = useMemo(() => {
    return goals.filter((g) => {
      const matchSearch =
        !searchQuery ||
        g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (g.description && g.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchStatus =
        selectedStatus === "ALL" || g.status === selectedStatus;

      const matchType =
        selectedType === "ALL" || g.type === selectedType;

      return matchSearch && matchStatus && matchType;
    });
  }, [goals, searchQuery, selectedStatus, selectedType]);

  const mapStatusTone = (status: string): StatusTone => {
    if (status === "Achieved") return "emerald";
    if (status === "In Progress") return "cyan";
    if (status === "Cancelled") return "rose";
    return "slate";
  };

  const columns: ERPColumn<Goal>[] = [
    {
      key: "title",
      header: t("goals.columns.goal", { defaultValue: "GOAL & TARGET" }),
      sortable: true,
      render: (g) => {
        const linkedId = g.linkedProjectId || g.linkedProject;
        const linkedTitle = linkedId ? projectMap.get(linkedId) : null;
        return (
          <div className="flex flex-col py-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {g.title}
            </span>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span>{typeLabel(g.type)}</span>
              {linkedTitle && (
                <>
                  <span>•</span>
                  <span className="truncate max-w-[180px] text-slate-400">
                    {t("goals.linkedProjectLabel", { defaultValue: "Project" })}: {linkedTitle}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "targetAmount",
      header: t("goals.columns.target", { defaultValue: "TARGET AMOUNT" }),
      align: "right",
      sortable: true,
      render: (g) => (
        <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
          {formatMoney(g.targetAmount, currency)}
        </span>
      ),
    },
    {
      key: "currentAmount",
      header: t("goals.columns.saved", { defaultValue: "CURRENT SAVED" }),
      align: "right",
      sortable: true,
      render: (g) => (
        <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          {formatMoney(g.currentAmount, currency)}
        </span>
      ),
    },
    {
      key: "progress",
      header: t("goals.columns.progress", { defaultValue: "PROGRESS" }),
      render: (g) => {
        const pct =
          g.targetAmount > 0
            ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100))
            : 0;
        // #48 — progress is hand-typed unless a fund allocation backs it, so it
        // is labelled as unverified rather than presented as an audited balance.
        const isManual = (g.progressSource ?? "Manual") === "Manual";

        return (
          <div className="w-36 space-y-1">
            <div className="flex justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
              <span>{pct}%</span>
              <span>
                {pct >= 100
                  ? t("goals.progressComplete", { defaultValue: "Complete" })
                  : t("goals.progressRemaining", { defaultValue: "{pct}% left", pct: 100 - pct })}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  pct >= 100 ? "bg-emerald-500" : "bg-cyan-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {isManual && (
              <span
                className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400"
                title={t("goals.progressManualHint", {
                  defaultValue:
                    "This figure was entered by hand and is not backed by a fund balance.",
                })}
              >
                <AlertTriangle className="h-3 w-3" />
                {t("goals.progressManual", { defaultValue: "Manual · unverified" })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "deadline",
      header: t("goals.columns.deadline", { defaultValue: "DEADLINE" }),
      render: (g) => (
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {g.deadline ? formatDateOnly(g.deadline) : t("goals.noDeadline", { defaultValue: "No deadline" })}
        </span>
      ),
    },
    {
      key: "status",
      header: t("goals.columns.status", { defaultValue: "STATUS" }),
      render: (g) => (
        <StatusBadge tone={mapStatusTone(g.status)} label={g.status} />
      ),
    },
    {
      key: "actions",
      header: t("common.actions", { defaultValue: "ACTIONS" }),
      align: "right",
      render: (g) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpenEdit(g);
            }}
            icon={Edit2}
            title={t("common.edit", { defaultValue: "Edit" })}
          />
          <Button
            variant="destructive"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setPendingDeleteId(g.id || g._id || "");
            }}
            icon={Trash2}
            title={t("common.delete", { defaultValue: "Delete" })}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("goals.metrics.totalTarget", { defaultValue: "Total Capital Target" })}
          value={formatMoney(metrics.totalTarget, currency)}
          icon={Target}
          tone="slate"
        />
        <ERPMetricCard
          label={t("goals.metrics.currentAccumulated", { defaultValue: "Accumulated Savings" })}
          value={formatMoney(metrics.totalCurrent, currency)}
          icon={DollarSign}
          tone="emerald"
          // #48 — the sum is only as trustworthy as its source; say so.
          description={t("goals.metrics.currentAccumulatedHint", {
            defaultValue: "Manual entries — not backed by fund balances",
          })}
        />
        <ERPMetricCard
          label={t("goals.metrics.overallProgress", { defaultValue: "Overall Progress" })}
          value={`${metrics.completionRate}%`}
          icon={TrendingUp}
          tone="cyan"
        />
        <ERPMetricCard
          label={t("goals.metrics.achievedGoals", { defaultValue: "Achieved Goals" })}
          value={`${metrics.achievedCount} / ${metrics.count}`}
          icon={CheckCircle2}
          tone="amber"
        />
      </div>

      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-card border border-border/80 rounded-xl shadow-sm">
        <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("goals.searchPlaceholder", { defaultValue: "Search goals..." })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-card border border-border/80 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="w-36">
            <AppDropdown
              options={[
                { value: "ALL", label: t("common.allStatuses", { defaultValue: "All Statuses" }) },
                { value: "In Progress", label: t("goals.form.statuses.inProgress", { defaultValue: "In Progress" }) },
                { value: "Achieved", label: t("goals.form.statuses.achieved", { defaultValue: "Achieved" }) },
                { value: "Cancelled", label: t("goals.form.statuses.cancelled", { defaultValue: "Cancelled" }) },
              ]}
              value={selectedStatus}
              onChange={(val) => setSelectedStatus(val || "ALL")}
              clearable={false}
            />
          </div>

          <div className="w-36">
            <AppDropdown
              options={[
                { value: "ALL", label: t("goals.allTypes", { defaultValue: "All Types" }) },
                { value: "Savings", label: t("goals.form.types.savings", { defaultValue: "Savings" }) },
                { value: "Investment", label: t("goals.form.types.investment", { defaultValue: "Investment" }) },
                { value: "Emergency", label: t("goals.form.types.emergency", { defaultValue: "Emergency" }) },
                { value: "Other", label: t("goals.form.types.other", { defaultValue: "Other" }) },
              ]}
              value={selectedType}
              onChange={(val) => setSelectedType(val || "ALL")}
              clearable={false}
            />
          </div>
        </div>

        <Button variant="primary" size="sm" onClick={onOpenCreate} icon={Plus}>
          {t("goals.createButton", { defaultValue: "New Goal" })}
        </Button>
      </div>

      {/* Main ERP Data Table */}
      <ERPDataTable
        data={filteredGoals}
        columns={columns}
        isLoading={isLoading}
        page={currentPage}
        pageSize={pageSize}
        totalCount={filteredGoals.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        emptyMessage={t("goals.noGoalsFound", { defaultValue: "No goals match the criteria." })}
        emptyActionLabel={t("goals.createButton", { defaultValue: "New Goal" })}
        onEmptyAction={onOpenCreate}
      />

      <ERPConfirmDialog
        isOpen={!!pendingDeleteId}
        title={t("common.delete", { defaultValue: "Delete" })}
        description={t("goals.confirmDelete", { defaultValue: "Delete this goal?" })}
        confirmLabel={t("common.delete", { defaultValue: "Delete" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="destructive"
        onConfirm={() => {
          const target = pendingDeleteId;
          setPendingDeleteId(null);
          if (target) void onDeleteGoal(target);
        }}
        onClose={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
