"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { GoalsView, GoalFormModal } from "@/components/goals";
import { apiClient } from "@/lib/api-client";
import { Goal, Project } from "@/types";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

export default function GoalsPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  // TanStack Query v5 - Query key: ["goals"]
  const { data: goals = [], isLoading } = useQuery<Goal[]>({
    queryKey: ["goals"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: Goal[] } | Goal[]>("/goals");
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
    },
  });

  const { data: projects = [] } = useQuery<Project[]>({
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

  // Mutations
  const saveGoalMutation = useMutation({
    mutationFn: async (goalData: Partial<Goal>) => {
      if (editingGoal) {
        const id = editingGoal.id || editingGoal._id;
        return await apiClient(`/goals/${id}`, {
          method: "PUT",
          body: JSON.stringify(goalData),
        });
      }
      return await apiClient("/goals", {
        method: "POST",
        body: JSON.stringify(goalData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      toast.success(
        editingGoal
          ? t("goals.updatedSuccess", { defaultValue: "Goal updated successfully" })
          : t("goals.createdSuccess", { defaultValue: "Goal created successfully" })
      );
      setIsFormOpen(false);
      setEditingGoal(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToSaveGoal", { defaultValue: "Failed to save goal" }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (goalId: string) => {
      return await apiClient(`/goals/${goalId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      toast.success(t("goals.deletedSuccess", { defaultValue: "Goal removed" }));
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToDeleteGoal", { defaultValue: "Failed to delete goal" }));
    },
  });

  const updateProgressMutation = useMutation({
    mutationFn: async ({ goalId, newAmount }: { goalId: string; newAmount: number }) => {
      return await apiClient(`/goals/${goalId}`, {
        method: "PUT",
        body: JSON.stringify({ currentAmount: newAmount }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      toast.success(t("goals.progressUpdated", { defaultValue: "Progress updated" }));
    },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <GoalsView
          goals={goals}
          projects={projects}
          isLoading={isLoading}
          onOpenCreate={() => {
            setEditingGoal(null);
            setIsFormOpen(true);
          }}
          onOpenEdit={(goal) => {
            setEditingGoal(goal);
            setIsFormOpen(true);
          }}
          onDeleteGoal={async (id) => {
            await deleteMutation.mutateAsync(id);
          }}
          onUpdateProgress={async (id, amt) => {
            await updateProgressMutation.mutateAsync({ goalId: id, newAmount: amt });
          }}
        />

        {/* Create / Edit Goal Modal */}
        <GoalFormModal
          isOpen={isFormOpen}
          onClose={() => {
            setIsFormOpen(false);
            setEditingGoal(null);
          }}
          onSubmit={async (data) => {
            await saveGoalMutation.mutateAsync(data);
          }}
          projects={projects}
          initialData={editingGoal}
        />
      </div>
    </AppShell>
  );
}
