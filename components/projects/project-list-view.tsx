"use client";

import React, { useState, useMemo } from "react";
import {
  Briefcase,
  Plus,
  TrendingUp,
  Activity,
  DollarSign,
  Search,
  Filter,
  Eye,
  FileEdit,
  Trash2,
  Calendar,
  Layers,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Project, ProjectUpdateRecord } from "@/types";
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
import { formatMoney, formatDate } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { usePermissions } from "@/lib/use-permissions";

interface ProjectListViewProps {
  projects: Project[];
  isLoading: boolean;
  onOpenCreate: () => void;
  onSelectProject: (project: Project) => void;
  onOpenEdit?: (project: Project) => void;
  onOpenAddUpdate?: (project: Project) => void;
  onDeleteProject?: (projectId: string) => void;
}

export function ProjectListView({
  projects,
  isLoading,
  onOpenCreate,
  onSelectProject,
  onOpenEdit,
  onOpenAddUpdate,
  onDeleteProject,
}: ProjectListViewProps) {
  const { t } = useLocale();
  const { can } = usePermissions();
  const canWrite = can("PROJECT_MANAGEMENT", "WRITE");

  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  // Compute Metrics
  const metrics = useMemo(() => {
    let totalBudget = 0;
    let totalBalance = 0;
    let activeCount = 0;
    let totalEarnings = 0;

    projects.forEach((p) => {
      totalBudget += Number(p.budget || 0);
      totalBalance += Number(p.currentFundBalance || 0);
      totalEarnings += Number(p.totalEarnings || 0);
      if (p.status === "In Progress" || p.status === "ACTIVE") {
        activeCount += 1;
      }
    });

    return { totalBudget, totalBalance, activeCount, totalEarnings };
  }, [projects]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [projects]);

  // Filtered dataset
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchSearch =
        !searchQuery ||
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchStatus =
        selectedStatus === "ALL" || p.status === selectedStatus;

      const matchCategory =
        selectedCategory === "ALL" || p.category === selectedCategory;

      return matchSearch && matchStatus && matchCategory;
    });
  }, [projects, searchQuery, selectedStatus, selectedCategory]);

  const mapStatusTone = (status: string): StatusTone => {
    const s = status?.toLowerCase() || "";
    if (s.includes("progress") || s.includes("active")) return "cyan";
    if (s.includes("complete")) return "emerald";
    if (s.includes("risk") || s.includes("review")) return "amber";
    if (s.includes("critical") || s.includes("cancel")) return "rose";
    return "slate";
  };

  const mapHealthTone = (health: string): StatusTone => {
    const h = health?.toLowerCase() || "";
    if (h.includes("stable")) return "emerald";
    if (h.includes("risk")) return "amber";
    if (h.includes("critical")) return "rose";
    return "slate";
  };

  // ERP Columns configuration
  const columns: ERPColumn<Project>[] = [
    {
      key: "title",
      header: t("projects.columns.project", { defaultValue: "PROJECT" }),
      sortable: true,
      render: (p) => (
        <div className="flex flex-col py-1">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {p.title}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {p.category}
          </span>
        </div>
      ),
    },
    {
      key: "budget",
      header: t("projects.columns.budget", { defaultValue: "BUDGET" }),
      align: "right",
      sortable: true,
      render: (p) => (
        <span className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
          {formatMoney(p.budget)}
        </span>
      ),
    },
    {
      key: "currentFundBalance",
      header: t("projects.columns.balance", { defaultValue: "FUND BALANCE" }),
      align: "right",
      sortable: true,
      render: (p) => (
        <span className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          {formatMoney(p.currentFundBalance)}
        </span>
      ),
    },
    {
      key: "expectedRoi",
      header: t("projects.columns.roi", { defaultValue: "EXP. ROI" }),
      align: "right",
      sortable: true,
      render: (p) => (
        <span className="font-mono text-sm text-slate-700 dark:text-slate-300">
          {p.expectedRoi}%
        </span>
      ),
    },
    {
      key: "status",
      header: t("projects.columns.status", { defaultValue: "STATUS" }),
      render: (p) => (
        <StatusBadge tone={mapStatusTone(p.status)} label={p.status} />
      ),
    },
    {
      key: "health",
      header: t("projects.columns.health", { defaultValue: "HEALTH" }),
      render: (p) => (
        <StatusBadge tone={mapHealthTone(p.health)} label={p.health || "Stable"} />
      ),
    },
    {
      key: "startDate",
      header: t("projects.columns.timeline", { defaultValue: "TIMELINE" }),
      render: (p) => (
        <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
          <span>{formatDate(p.startDate)}</span>
          {p.completionDate && (
            <span className="text-slate-400"> → {formatDate(p.completionDate)}</span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: t("common.actions", { defaultValue: "ACTIONS" }),
      align: "right",
      render: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onSelectProject(p);
            }}
            title={t("common.view", { defaultValue: "View Details" })}
          >
            <Eye className="w-3.5 h-3.5" />
          </Button>

          {canWrite && onOpenEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenEdit(p);
              }}
              title={t("common.edit", { defaultValue: "Edit" })}
            >
              <FileEdit className="w-3.5 h-3.5" />
            </Button>
          )}

          {canWrite && onOpenAddUpdate && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenAddUpdate(p);
              }}
              title={t("projects.addUpdate", { defaultValue: "Add Update" })}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}

          {canWrite && onDeleteProject && (
            <Button
              variant="destructive"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete(p);
              }}
              title={t("common.delete", { defaultValue: "Delete" })}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("projects.metrics.activeProjects", { defaultValue: "Active Projects" })}
          value={metrics.activeCount}
          icon={Briefcase}
          tone="cyan"
          helperText={t("projects.registeredCount", { count: projects.length, defaultValue: "{count} total projects registered" })}
        />
        <ERPMetricCard
          label={t("projects.metrics.allocatedBudget", { defaultValue: "Allocated Budget" })}
          value={formatMoney(metrics.totalBudget)}
          icon={DollarSign}
          tone="slate"
        />
        <ERPMetricCard
          label={t("projects.metrics.currentBalance", { defaultValue: "Available Balance" })}
          value={formatMoney(metrics.totalBalance)}
          icon={TrendingUp}
          tone="emerald"
        />
        <ERPMetricCard
          label={t("projects.metrics.totalEarnings", { defaultValue: "Disbursed Earnings" })}
          value={formatMoney(metrics.totalEarnings)}
          icon={Activity}
          tone="amber"
        />
      </div>

      {/* Control Bar: Search, Filters & Action Button */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-card border border-border/80 rounded-xl shadow-sm">
        <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("projects.searchPlaceholder", { defaultValue: "Search projects by title, category..." })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-card border border-border/80 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Status Filter */}
          <div className="w-36">
            <AppDropdown
              options={[
                { value: "ALL", label: t("common.allStatuses", { defaultValue: "All Statuses" }) },
                { value: "In Progress", label: "In Progress" },
                { value: "Completed", label: "Completed" },
                { value: "Review", label: "Review" },
              ]}
              value={selectedStatus}
              onChange={(val) => setSelectedStatus(val || "ALL")}
              clearable={false}
            />
          </div>

          {/* Category Filter */}
          {categories.length > 0 && (
            <div className="w-40">
              <AppDropdown
                options={[
                  { value: "ALL", label: t("common.allCategories", { defaultValue: "All Categories" }) },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
                value={selectedCategory}
                onChange={(val) => setSelectedCategory(val || "ALL")}
                clearable={false}
              />
            </div>
          )}
        </div>

        {canWrite && (
          <Button variant="primary" size="sm" onClick={onOpenCreate} icon={Plus}>
            {t("projects.createButton", { defaultValue: "New Project" })}
          </Button>
        )}
      </div>

      {/* Main ERP Data Table */}
      <ERPDataTable<Project>
        data={filteredProjects}
        columns={columns}
        isLoading={isLoading}
        page={currentPage}
        pageSize={pageSize}
        totalCount={filteredProjects.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        emptyMessage={t("projects.noProjectsFound", { defaultValue: "No projects match the criteria." })}
        emptyActionLabel={canWrite ? t("projects.createButton", { defaultValue: "New Project" }) : undefined}
        onEmptyAction={canWrite ? onOpenCreate : undefined}
      />

      <ERPConfirmDialog
        isOpen={pendingDelete !== null}
        title={t("projects.deleteTitle", { defaultValue: "Cancel this project?" })}
        description={t("projects.confirmDelete", { defaultValue: "This marks the project as Cancelled. Financial history is retained." })}
        confirmLabel={t("common.delete", { defaultValue: "Delete" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="destructive"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDeleteProject?.(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
