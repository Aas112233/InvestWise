"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import {
  ProjectListView,
  ProjectFormModal,
  ProjectUpdateModal,
  ProjectDetailView,
  DistributeReturnsModal,
} from "@/components/projects";
import { apiClient } from "@/lib/api-client";
import { Project, Member, ProjectUpdateRecord } from "@/types";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import { useTenantShareValue, useTenantCurrency } from "@/lib/use-tenant-settings";
import {
  Briefcase,
  Layers,
  Clock,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign,
  TrendingUp,
  Activity,
  Filter,
} from "lucide-react";
import {
  Button,
  ERPDataTable,
  ERPColumn,
  ERPMetricCard,
  AppDropdown,
  DropdownOption,
  StatusBadge,
} from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/formatters";
import { usePermissions } from "@/lib/use-permissions";

export default function ProjectsPage() {
  const { t } = useLocale();
  const { can } = usePermissions();
  const canWrite = can("PROJECT_MANAGEMENT", "WRITE");
  const queryClient = useQueryClient();

  // §11: query failures surface the real server message — never fail silent
  // into an empty table. The fallback keeps the table renderable.
  const loadListOrToast = async (url: string): Promise<any[]> => {
    try {
      const res = await apiClient<{ data: any[] } | any[]>(url);
      return Array.isArray(res) ? res : res?.data || [];
    } catch (err: any) {
      toast.error(err?.message || t("projects.loadFailed", { defaultValue: "Failed to load projects data" }));
      return [];
    }
  };

  // Top-level Navigation Tabs for the Project Module
  const [mainTab, setMainTab] = useState<"projects" | "updates" | "timeline">("projects");

  // Filter by project in Tab 2 and Tab 3
  const [filterProjectId, setFilterProjectId] = useState<string>("");

  // Pagination for Tab 2 and Tab 3
  const [updatesPage, setUpdatesPage] = useState(1);
  const [updatesPageSize, setUpdatesPageSize] = useState(10);
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelinePageSize, setTimelinePageSize] = useState(10);

  // Modal and Selection States
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [projectForUpdate, setProjectForUpdate] = useState<Project | null>(null);
  const [isDistributeOpen, setIsDistributeOpen] = useState(false);
  const [projectForDistribute, setProjectForDistribute] = useState<Project | null>(null);

  // TanStack Query v5 - Projects List
  const { data: projects = [], isLoading: isLoadingProjects } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => loadListOrToast("/projects"),
  });

  // Detailed single project query when selected
  const { data: activeProject = null } = useQuery<Project | null>({
    queryKey: ["projects", selectedProjectId],
    queryFn: async () => {
      if (!selectedProjectId) return null;
      try {
        const res = await apiClient<{ data: Project } | Project>(`/projects/${selectedProjectId}`);
        return (res as any)?.data || res;
      } catch (err: any) {
        toast.error(err?.message || t("projects.loadFailed", { defaultValue: "Failed to load projects data" }));
        return null;
      }
    },
    enabled: !!selectedProjectId,
  });

  // Funds list
  const { data: funds = [] } = useQuery<Array<{ id: string; name: string; balance: number }>>({
    queryKey: ["funds"],
    queryFn: async () => {
      const list = await loadListOrToast("/funds");
      return list.map((f: any) => ({
        id: f.id,
        name: f.name,
        balance: Number(f.balance || 0),
      }));
    },
  });

  // Members list for shareholder selection (dropdown feed ceiling: 500)
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["members"],
    queryFn: () => loadListOrToast("/members?limit=500"),
  });

  // Tenant settings for share value and base currency
  const tenantShareValue = useTenantShareValue();
  const tenantCurrency = useTenantCurrency();

  // Tab 2: Server-paginated project updates (5 years of disbursements is
  // tens of thousands of rows — never fetch them all for one table page).
  const { data: updatesResult, isLoading: isLoadingUpdates } = useQuery<{
    data: any[];
    meta?: { total: number };
  }>({
    queryKey: [
      "projects",
      "updates",
      { projectId: filterProjectId || undefined, page: updatesPage, pageSize: updatesPageSize },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(updatesPage), pageSize: String(updatesPageSize) });
      if (filterProjectId) params.set("projectId", filterProjectId);
      try {
        return await apiClient<{ data: any[]; meta?: { total: number } }>(`/projects/updates?${params.toString()}`);
      } catch (err: any) {
        toast.error(err?.message || t("projects.loadFailed", { defaultValue: "Failed to load projects data" }));
        return { data: [], meta: { total: 0 } };
      }
    },
    enabled: mainTab === "updates",
  });
  const allUpdates = updatesResult?.data ?? [];
  const updatesTotal = updatesResult?.meta?.total ?? 0;

  // Tab 3: Server-paginated project transactions
  const { data: timelineResult, isLoading: isLoadingTransactions } = useQuery<{
    data: any[];
    pagination?: { total: number };
  }>({
    queryKey: [
      "transactions",
      { hasProject: true, projectId: filterProjectId || undefined, page: timelinePage, pageSize: timelinePageSize },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(timelinePage), limit: String(timelinePageSize) });
      if (filterProjectId) params.set("projectId", filterProjectId);
      else params.set("hasProject", "true");
      try {
        return await apiClient<{ data: any[]; pagination?: { total: number } }>(`/transactions?${params.toString()}`);
      } catch (err: any) {
        toast.error(err?.message || t("projects.loadFailed", { defaultValue: "Failed to load projects data" }));
        return { data: [], pagination: { total: 0 } };
      }
    },
    enabled: mainTab === "timeline",
  });
  const allProjectTransactions = timelineResult?.data ?? [];
  const timelineTotal = timelineResult?.pagination?.total ?? 0;

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async (payload: { data: Partial<Project>; id?: string }) => {
      if (payload.id) {
        return await apiClient(`/projects/${payload.id}`, {
          method: "PUT",
          body: JSON.stringify(payload.data),
        });
      }
      return await apiClient("/projects", {
        method: "POST",
        body: JSON.stringify(payload.data),
      });
    },
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(
        variables.id
          ? t("projects.updatedSuccess", { defaultValue: "Project updated successfully" })
          : t("projects.savedSuccess", { defaultValue: "Project created successfully with shareholder allocations" }),
      );
      setIsCreateOpen(false);
      setEditingProject(null);
    },
    onError: (err: any) => {
      toast.error(
        err?.message ||
          t("common.errors.failedToCreateProject", { defaultValue: "Failed to save project" }),
      );
    },
  });

  const updateDisbursementMutation = useMutation({
    mutationFn: async ({
      projectId,
      updateData,
    }: {
      projectId: string;
      updateData: { type: "Earning" | "Expense"; amount: number; description: string; referenceNumber: string };
    }) => {
      return await apiClient(`/projects/${projectId}/updates`, {
        method: "POST",
        body: JSON.stringify(updateData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(t("projects.updatePosted", { defaultValue: "Project disbursement recorded" }));
      setIsUpdateOpen(false);
      setProjectForUpdate(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToPostDisbursement", { defaultValue: "Failed to post disbursement" }));
    },
  });

  const distributeReturnsMutation = useMutation({
    mutationFn: async ({
      projectId,
      payload,
    }: {
      projectId: string;
      payload: { type: "Profit" | "Loss"; amount: number; description: string; referenceNumber: string };
    }) => {
      return await apiClient(`/projects/${projectId}/distribute-returns`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(res?.message || t("projects.returns.success", { defaultValue: "Project returns distributed successfully" }));
      setIsDistributeOpen(false);
      setProjectForDistribute(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to distribute returns");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (projectId: string) => {
      return await apiClient(`/projects/${projectId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("projects.deletedSuccess", { defaultValue: "Project deleted" }));
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToDeleteProject", { defaultValue: "Failed to delete project" }));
    },
  });

  // Project options for dropdown filter
  const projectFilterOptions: DropdownOption[] = [
    { value: "", label: t("common.allProjects", { defaultValue: "All Projects" }) },
    ...projects.map((p) => ({ value: p.id, label: p.title })),
  ];

  // Tab 2 Columns (All Project Updates)
  const allUpdatesColumns: ERPColumn<any>[] = [
    {
      key: "projectTitle",
      header: t("projects.targetEntity", { defaultValue: "PROJECT" }),
      sortable: true,
      render: (u) => (
        <div>
          <div className="font-semibold text-foreground text-xs">{u.projectTitle}</div>
          {u.projectCategory && (
            <div className="text-[10px] text-muted-foreground">{u.projectCategory}</div>
          )}
        </div>
      ),
    },
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

  // Tab 3 Columns (All Project Transactions Timeline)
  const allTransactionsColumns: ERPColumn<any>[] = [
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
      key: "projectName",
      header: t("projects.targetEntity", { defaultValue: "PROJECT" }),
      render: (tx) => (
        <span className="text-xs font-semibold text-foreground block">
          {tx.projectName || "-"}
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

  // If a single project is clicked to drill-down, render the full ProjectDetailView
  if (selectedProjectId && activeProject) {
    return (
      <AppShell>
        <div className="space-y-6">
          <ProjectDetailView
            project={activeProject}
            onBack={() => setSelectedProjectId(null)}
            onOpenEdit={() => {
              setEditingProject(activeProject);
              setIsCreateOpen(true);
            }}
            onOpenAddUpdate={() => {
              setProjectForUpdate(activeProject);
              setIsUpdateOpen(true);
            }}
            onOpenDistributeReturns={() => {
              setProjectForDistribute(activeProject);
              setIsDistributeOpen(true);
            }}
          />

          <ProjectFormModal
            isOpen={isCreateOpen}
            initialData={editingProject}
            onClose={() => {
              setIsCreateOpen(false);
              setEditingProject(null);
            }}
            onSubmit={async (data) => {
              await saveMutation.mutateAsync({ data, id: editingProject?.id });
            }}
            funds={funds}
            members={members}
            tenantShareValue={tenantShareValue}
          />

          <ProjectUpdateModal
            isOpen={isUpdateOpen}
            onClose={() => {
              setIsUpdateOpen(false);
              setProjectForUpdate(null);
            }}
            onSubmit={async (data) => {
              const targetId = data.projectId || projectForUpdate?.id;
              if (targetId) {
                await updateDisbursementMutation.mutateAsync({
                  projectId: targetId,
                  updateData: data,
                });
              }
            }}
            project={projectForUpdate}
            projects={projects}
          />

          <DistributeReturnsModal
            isOpen={isDistributeOpen}
            onClose={() => {
              setIsDistributeOpen(false);
              setProjectForDistribute(null);
            }}
            project={projectForDistribute}
            onSubmit={async (payload) => {
              if (projectForDistribute) {
                await distributeReturnsMutation.mutateAsync({
                  projectId: projectForDistribute.id,
                  payload,
                });
              }
            }}
          />
        </div>
      </AppShell>
    );
  }

  // MAIN PROJECT MANAGEMENT SCREEN (3 TABS)
  return (
    <AppShell>
      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {t("projects.portfolio", { defaultValue: "Projects Management" })}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("projects.managementSubtitle", {
                defaultValue: "Manage commercial projects, track shareholder equity, post updates, and view transactions.",
              })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canWrite && mainTab === "updates" && (
              <Button
                variant="primary"
                size="sm"
                icon={Plus}
                onClick={() => {
                  setProjectForUpdate(null);
                  setIsUpdateOpen(true);
                }}
              >
                {t("projects.addUpdate", { defaultValue: "Post Disbursement / Earning" })}
              </Button>
            )}

            {canWrite && mainTab === "projects" && (
              <Button
                variant="primary"
                size="sm"
                icon={Plus}
                onClick={() => {
                  setEditingProject(null);
                  setIsCreateOpen(true);
                }}
              >
                {t("projects.launchVenture", { defaultValue: "Create Project" })}
              </Button>
            )}
          </div>
        </div>

        {/* 3 Main Screen Tabs */}
        <div className="flex items-center border-b border-border/80 gap-2">
          <button
            type="button"
            onClick={() => setMainTab("projects")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              mainTab === "projects"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Briefcase className="w-4 h-4" />
            <span>{t("projects.tabs.overview", { defaultValue: "Projects & Overview" })}</span>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-foreground">
              {projects.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab("updates")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              mainTab === "updates"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>{t("projects.tabs.updates", { defaultValue: "Project Updates (Incomes & Expenses)" })}</span>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono text-foreground">
              {updatesTotal}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab("timeline")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              mainTab === "timeline"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>{t("projects.tabs.timeline", { defaultValue: "Project Timelines & Transactions" })}</span>
          </button>
        </div>

        {/* TAB 1: PROJECTS & OVERVIEW */}
        {mainTab === "projects" && (
          <ProjectListView
            projects={projects}
            isLoading={isLoadingProjects}
            onOpenCreate={() => {
              setEditingProject(null);
              setIsCreateOpen(true);
            }}
            onSelectProject={(p) => setSelectedProjectId(p.id)}
            onOpenEdit={(p) => {
              setEditingProject(p);
              setIsCreateOpen(true);
            }}
            onOpenAddUpdate={(p) => {
              setProjectForUpdate(p);
              setIsUpdateOpen(true);
            }}
            onDeleteProject={(id) => deleteMutation.mutate(id)}
          />
        )}

        {/* TAB 2: PROJECT UPDATES (INCOMES & EXPENSES) */}
        {mainTab === "updates" && (
          <div className="space-y-6">
            {/* Filter and Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-card border border-border/80 rounded-xl">
              <div className="flex items-center gap-3 w-full sm:w-72">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  {t("projects.filterProject", { defaultValue: "Filter:" })}
                </span>
                <AppDropdown
                  options={projectFilterOptions}
                  value={filterProjectId}
                  onChange={(val) => {
                    setFilterProjectId(val || "");
                    setUpdatesPage(1);
                  }}
                  placeholder={t("projects.selectProject", { defaultValue: "All Projects" })}
                />
              </div>

              {canWrite && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={Plus}
                  onClick={() => {
                    const found = projects.find((p) => p.id === filterProjectId) || null;
                    setProjectForUpdate(found);
                    setIsUpdateOpen(true);
                  }}
                >
                  {t("projects.addUpdate", { defaultValue: "Post Disbursement / Earning" })}
                </Button>
              )}
            </div>

            {/* Updates Data Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  {t("projects.disbursementsLedger", { defaultValue: "Project Updates & Disbursements History" })}
                </h2>
                <span className="text-xs text-muted-foreground font-mono">
                  {updatesTotal} {t("common.entries", { defaultValue: "records" })}
                </span>
              </div>

              <ERPDataTable
                data={allUpdates}
                columns={allUpdatesColumns}
                page={updatesPage}
                pageSize={updatesPageSize}
                totalCount={updatesTotal}
                onPageChange={setUpdatesPage}
                onPageSizeChange={(size) => {
                  setUpdatesPageSize(size);
                  setUpdatesPage(1);
                }}
                emptyMessage={t("projects.noUpdatesRecorded", { defaultValue: "No disbursement or earning records for this selection." })}
              />
            </div>
          </div>
        )}

        {/* TAB 3: PROJECT TIMELINES & TRANSACTIONS */}
        {mainTab === "timeline" && (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex items-center gap-3 p-4 bg-card border border-border/80 rounded-xl w-full sm:w-80">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                {t("projects.filterProject", { defaultValue: "Filter:" })}
              </span>
              <AppDropdown
                options={projectFilterOptions}
                value={filterProjectId}
                onChange={(val) => {
                  setFilterProjectId(val || "");
                  setTimelinePage(1);
                }}
                placeholder={t("projects.selectProject", { defaultValue: "All Projects" })}
              />
            </div>

            {/* Transactions Timeline Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  {t("projects.timeline.title", { defaultValue: "Project Lifecycle & Financial Timelines" })}
                </h2>
                <span className="text-xs text-muted-foreground font-mono">
                  {timelineTotal} {t("common.entries", { defaultValue: "events" })}
                </span>
              </div>

              <ERPDataTable
                data={allProjectTransactions}
                columns={allTransactionsColumns}
                page={timelinePage}
                pageSize={timelinePageSize}
                totalCount={timelineTotal}
                onPageChange={setTimelinePage}
                onPageSizeChange={(size) => {
                  setTimelinePageSize(size);
                  setTimelinePage(1);
                }}
                emptyMessage={t("projects.timeline.empty", { defaultValue: "No transactions or ledger events recorded for this selection." })}
              />
            </div>
          </div>
        )}

        {/* Create / Edit Project Modal */}
        <ProjectFormModal
          isOpen={isCreateOpen}
          initialData={editingProject}
          onClose={() => {
            setIsCreateOpen(false);
            setEditingProject(null);
          }}
          onSubmit={async (data) => {
            await saveMutation.mutateAsync({ data, id: editingProject?.id });
          }}
          funds={funds}
          members={members}
          tenantShareValue={tenantShareValue}
        />

        {/* Add Disbursement / Update Modal */}
        <ProjectUpdateModal
          isOpen={isUpdateOpen}
          onClose={() => {
            setIsUpdateOpen(false);
            setProjectForUpdate(null);
          }}
          onSubmit={async (data) => {
            const targetId = data.projectId || projectForUpdate?.id;
            if (targetId) {
              await updateDisbursementMutation.mutateAsync({
                projectId: targetId,
                updateData: data,
              });
            }
          }}
          project={projectForUpdate}
          projects={projects}
        />

        {/* Distribute Returns Modal */}
        <DistributeReturnsModal
          isOpen={isDistributeOpen}
          onClose={() => {
            setIsDistributeOpen(false);
            setProjectForDistribute(null);
          }}
          project={projectForDistribute}
          onSubmit={async (payload) => {
            if (projectForDistribute) {
              await distributeReturnsMutation.mutateAsync({
                projectId: projectForDistribute.id,
                payload,
              });
            }
          }}
        />
      </div>
    </AppShell>
  );
}
