"use client";

import React, { useState } from "react";
import { TopSheet, ERPFormLayout, ERPFormSection, ERPFormGrid, ERPFormField, AppDropdown, DropdownOption, Button } from "@/components/ui";
import { Goal, Project } from "@/types";
import { useLocale } from "@/lib/i18n";

interface GoalFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (goalData: Partial<Goal>) => Promise<void>;
  projects: Project[];
  initialData?: Goal | null;
}

export function GoalFormModal({
  isOpen,
  onClose,
  onSubmit,
  projects,
  initialData,
}: GoalFormModalProps) {
  const { t } = useLocale();

  const [title, setTitle] = useState(initialData?.title || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [targetAmount, setTargetAmount] = useState(
    initialData?.targetAmount ? String(initialData.targetAmount) : ""
  );
  const [currentAmount, setCurrentAmount] = useState(
    initialData?.currentAmount ? String(initialData.currentAmount) : "0"
  );
  const [deadline, setDeadline] = useState(initialData?.deadline || "");
  const [type, setType] = useState<string>(initialData?.type || "Savings");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialData?.linkedProjectId || initialData?.linkedProject || null
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const projectOptions: DropdownOption[] = projects.map((p) => ({
    value: p.id,
    label: p.title,
  }));

  const typeOptions: DropdownOption[] = [
    { value: "Savings", label: t("goals.types.savings", { defaultValue: "Savings Accumulation" }) },
    { value: "Investment", label: t("goals.types.investment", { defaultValue: "Project Investment" }) },
    { value: "Emergency", label: t("goals.types.emergency", { defaultValue: "Emergency Reserve" }) },
    { value: "Other", label: t("goals.types.other", { defaultValue: "Other Target" }) },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage(t("goals.validation.titleRequired", { defaultValue: "Goal title is required." }));
      return;
    }

    const numTarget = parseFloat(targetAmount);
    if (isNaN(numTarget) || numTarget <= 0) {
      setErrorMessage(t("goals.validation.validTarget", { defaultValue: "Target amount must be greater than zero." }));
      return;
    }

    const numCurrent = parseFloat(currentAmount) || 0;
    // Auto status: Achieved if current >= target
    const resolvedStatus = numCurrent >= numTarget ? "Achieved" : "In Progress";

    try {
      setIsSubmitting(true);
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        targetAmount: numTarget,
        currentAmount: numCurrent,
        deadline: deadline || undefined,
        type,
        linkedProjectId: selectedProjectId || undefined,
        status: resolvedStatus,
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || t("common.errors.failedToSaveGoal", { defaultValue: "Failed to save goal." }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? t("goals.editGoal", { defaultValue: "Edit Goal" }) : t("goals.newGoal", { defaultValue: "Define New Goal" })}
      description={t("goals.formDescription", { defaultValue: "Track milestone capital accumulation and tie to active projects." })}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-md">
            {errorMessage}
          </div>
        )}

        <ERPFormSection title={t("goals.goalDetails", { defaultValue: "Goal Target & Scope" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("goals.title", { defaultValue: "Goal Title *" })}>
              <input
                type="text"
                placeholder={t("goals.titlePlaceholder", { defaultValue: "e.g. 2026 Real Estate Acquisition Reserve" })}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("goals.type", { defaultValue: "Goal Category *" })}>
              <AppDropdown
                options={typeOptions}
                value={type}
                onChange={(val) => setType(val || "Savings")}
                placeholder={t("goals.selectCategoryPlaceholder", { defaultValue: "Select category..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormField label={t("goals.description", { defaultValue: "Description & Milestones" })}>
            <textarea
              rows={3}
              placeholder="Outline target milestones and timeline expectations..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
            />
          </ERPFormField>
        </ERPFormSection>

        <ERPFormSection title={t("goals.financialTargets", { defaultValue: "Financial Targets & Deadlines" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("goals.targetAmount", { defaultValue: "Target Amount *" })}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("goals.currentAmount", { defaultValue: "Initial / Current Accumulated" })}>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={currentAmount}
                onChange={(e) => setCurrentAmount(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("goals.deadline", { defaultValue: "Target Deadline" })}>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("goals.linkedProject", { defaultValue: "Linked Project (Optional)" })}>
              <AppDropdown
                options={projectOptions}
                value={selectedProjectId}
                onChange={(val) => setSelectedProjectId(val)}
                placeholder={t("goals.selectProjectPlaceholder", { defaultValue: "Link to active project..." })}
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            {initialData ? t("common.saveChanges", { defaultValue: "Save Changes" }) : t("goals.createButton", { defaultValue: "Create Goal" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
