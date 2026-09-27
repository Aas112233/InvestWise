"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import {
  ProjectListView,
  ProjectFormModal,
  ProjectUpdateModal,
  ProjectDetailView,
} from "@/components/projects";
import { apiClient } from "@/lib/api-client";
import { Project } from "@/types";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

export default function ProjectsPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [projectForUpdate, setProjectForUpdate] = useState<Project | null>(null);

  // TanStack Query v5 - Query key: ["projects"] (AGENTS.md §7)
  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: Project[] } | Project[]>("/projects");
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
    },
  });

  const { data: funds = [] } = useQuery<Array<{ id: string; name: string; balance: number }>>({
    queryKey: ["funds"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: any[] } | any[]>("/funds");
        const list = Array.isArray(res) ? res : res?.data || [];
        return list.map((f: any) => ({
          id: f.id,
          name: f.name,
          balance: Number(f.balance || 0),
        }));
      } catch {
        return [];
      }
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (newProject: Partial<Project>) => {
      return await apiClient("/projects", {
        method: "POST",
        body: JSON.stringify(newProject),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("projects.savedSuccess", { defaultValue: "Project created successfully" }));
      setIsCreateOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToCreateProject", { defaultValue: "Failed to create project" }));
    },
  });

  const updateDisbursementMutation = useMutation({
    mutationFn: async ({
      projectId,
      updateData,
    }: {
      projectId: string;
      updateData: { type: "Earning" | "Expense"; amount: number; description: string };
    }) => {
      return await apiClient(`/projects/${projectId}/updates`, {
        method: "POST",
        body: JSON.stringify(updateData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("projects.updatePosted", { defaultValue: "Project disbursement recorded" }));
      setIsUpdateOpen(false);
      setProjectForUpdate(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToPostDisbursement", { defaultValue: "Failed to post disbursement" }));
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

  return (
    <AppShell>
      <div className="space-y-6">
        {selectedProject ? (
          <ProjectDetailView
            project={selectedProject}
            onBack={() => setSelectedProject(null)}
            onOpenAddUpdate={() => {
              setProjectForUpdate(selectedProject);
              setIsUpdateOpen(true);
            }}
          />
        ) : (
          <ProjectListView
            projects={projects}
            isLoading={isLoading}
            onOpenCreate={() => setIsCreateOpen(true)}
            onSelectProject={(p) => setSelectedProject(p)}
            onOpenAddUpdate={(p) => {
              setProjectForUpdate(p);
              setIsUpdateOpen(true);
            }}
            onDeleteProject={(id) => deleteMutation.mutate(id)}
          />
        )}

        {/* Create Project Modal */}
        <ProjectFormModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={async (data) => {
            await createMutation.mutateAsync(data);
          }}
          funds={funds}
        />

        {/* Add Disbursement / Update Modal */}
        <ProjectUpdateModal
          isOpen={isUpdateOpen}
          onClose={() => {
            setIsUpdateOpen(false);
            setProjectForUpdate(null);
          }}
          onSubmit={async (data) => {
            if (projectForUpdate) {
              await updateDisbursementMutation.mutateAsync({
                projectId: projectForUpdate.id,
                updateData: data,
              });
            }
          }}
          project={projectForUpdate}
        />
      </div>
    </AppShell>
  );
}
