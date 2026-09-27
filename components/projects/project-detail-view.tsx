"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import { Project, ProjectUpdateRecord } from "@/types";
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

interface ProjectDetailViewProps {
  project: Project;
  onBack: () => void;
  onOpenAddUpdate: () => void;
}

export function ProjectDetailView({
  project,
  onBack,
  onOpenAddUpdate,
}: ProjectDetailViewProps) {
  const { t } = useLocale();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const updates = project.updates || [];

  const updateColumns: ERPColumn<ProjectUpdateRecord>[] = [
    {
      key: "date",
      header: t("common.date", { defaultValue: "DATE" }),
      sortable: true,
      render: (u) => (
        <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
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
        <span className="text-xs text-slate-700 dark:text-slate-300">
          {u.description}
        </span>
      ),
    },
    {
      key: "balanceAfter",
      header: t("finance.balanceAfter", { defaultValue: "BALANCE SNAPSHOT" }),
      align: "right",
      render: (u) => (
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
          {u.balanceAfter !== undefined ? formatMoney(u.balanceAfter) : "-"}
        </span>
      ),
    },
  ];

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

  return (
    <div className="space-y-6">
      {/* Header and Back navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} icon={ArrowLeft}>
          {t("common.backToProjects", { defaultValue: "Back to Projects" })}
        </Button>
        <Button variant="primary" size="sm" onClick={onOpenAddUpdate} icon={Plus}>
          {t("projects.addUpdate", { defaultValue: "Post Disbursement / Earning" })}
        </Button>
      </div>

      {/* Hero Card */}
      <div className="p-6 bg-card border border-border/80 rounded-xl shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {project.category}
              </span>
              <StatusBadge tone={mapStatusTone(project.status)} label={project.status} />
              <StatusBadge
                tone={project.health === "Stable" ? "emerald" : "amber"}
                label={project.health || "Stable"}
              />
            </div>
            <h1 className="text-xl font-bold text-foreground">
              {project.title}
            </h1>
            <p className="mt-2 text-xs text-muted-foreground max-w-2xl leading-relaxed">
              {project.description || "No description provided."}
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-1 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>
                {formatDate(project.startDate)}
                {project.completionDate && ` → ${formatDate(project.completionDate)}`}
              </span>
            </div>
            {project.projectFundHandler && (
              <span className="text-slate-400 font-mono text-[11px]">
                Handler: {project.projectFundHandler}
              </span>
            )}
          </div>
        </div>

        {/* Budget utilization bar */}
        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {t("projects.budgetUtilization", { defaultValue: "Budget Utilization" })}
            </span>
            <span className="font-mono text-slate-500 dark:text-slate-400">
              {budgetUsedPercent}% ({formatMoney(project.totalExpenses || 0)} of {formatMoney(project.budget)})
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
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

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("projects.columns.budget", { defaultValue: "Allocated Budget" })}
          value={formatMoney(project.budget)}
          icon={DollarSign}
          tone="slate"
        />
        <ERPMetricCard
          label={t("projects.columns.balance", { defaultValue: "Available Fund Balance" })}
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
      </div>

      {/* Updates / Disbursements Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            {t("projects.disbursementsLedger", { defaultValue: "Disbursements & Earnings History" })}
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {updates.length} {t("common.entries", { defaultValue: "entries" })}
          </span>
        </div>

        <ERPDataTable
          data={updates}
          columns={updateColumns}
          page={currentPage}
          pageSize={pageSize}
          totalCount={updates.length}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          emptyMessage={t("projects.noUpdatesRecorded", { defaultValue: "No disbursement or earning records for this project." })}
        />
      </div>
    </div>
  );
}
