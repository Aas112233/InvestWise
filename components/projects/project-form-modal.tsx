"use client";

import React, { useState } from "react";
import { TopSheet, ERPFormLayout, ERPFormSection, ERPFormGrid, ERPFormField, AppDropdown, DropdownOption, Button } from "@/components/ui";
import { useLocale } from "@/lib/i18n";
import { Project } from "@/types";

interface ProjectFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (projectData: Partial<Project>) => Promise<void>;
  funds: Array<{ id: string; name: string; balance: number }>;
  initialData?: Project | null;
}

export function ProjectFormModal({
  isOpen,
  onClose,
  onSubmit,
  funds,
  initialData,
}: ProjectFormModalProps) {
  const { t } = useLocale();

  // Explicit User Choice - Rules §15: Starts empty with null/""
  const [title, setTitle] = useState(initialData?.title || "");
  const [category, setCategory] = useState(initialData?.category || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [budget, setBudget] = useState(initialData?.budget ? String(initialData.budget) : "");
  const [initialInvestment, setInitialInvestment] = useState(
    initialData?.initialInvestment ? String(initialData.initialInvestment) : ""
  );
  const [expectedRoi, setExpectedRoi] = useState(
    initialData?.expectedRoi !== undefined ? String(initialData.expectedRoi) : ""
  );
  const [startDate, setStartDate] = useState(initialData?.startDate || "");
  const [completionDate, setCompletionDate] = useState(initialData?.completionDate || "");
  const [selectedFundId, setSelectedFundId] = useState<string | null>(initialData?.linkedFundId || null);
  const [status, setStatus] = useState<string>(initialData?.status || "In Progress");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fundOptions: DropdownOption[] = funds.map((f) => ({
    value: f.id,
    label: `${f.name} (Bal: ${f.balance.toLocaleString()})`,
  }));

  const categoryOptions: DropdownOption[] = [
    { value: "Real Estate", label: t("projects.sectors.realEstate", { defaultValue: "Real Estate" }) },
    { value: "Agriculture", label: t("projects.sectors.agriculture", { defaultValue: "Agriculture" }) },
    { value: "Technology", label: t("projects.sectors.technology", { defaultValue: "Technology" }) },
    { value: "Retail", label: t("projects.sectors.retail", { defaultValue: "Retail" }) },
    { value: "Manufacturing", label: t("projects.sectors.manufacturing", { defaultValue: "Manufacturing" }) },
    { value: "Other", label: t("projects.sectors.other", { defaultValue: "Other" }) },
  ];

  const statusOptions: DropdownOption[] = [
    { value: "In Progress", label: t("projects.statuses.inProgress", { defaultValue: "In Progress" }) },
    { value: "Review", label: t("projects.statuses.review", { defaultValue: "Review" }) },
    { value: "Completed", label: t("projects.statuses.completed", { defaultValue: "Completed" }) },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage(t("projects.validation.titleRequired", { defaultValue: "Project title is required." }));
      return;
    }
    if (!category) {
      setErrorMessage(t("projects.validation.categoryRequired", { defaultValue: "Category is required." }));
      return;
    }
    if (!startDate) {
      setErrorMessage(t("projects.validation.startDateRequired", { defaultValue: "Start date is required." }));
      return;
    }

    const numBudget = parseFloat(budget);
    if (isNaN(numBudget) || numBudget < 0) {
      setErrorMessage(t("projects.validation.validBudget", { defaultValue: "Valid budget is required." }));
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        title: title.trim(),
        category,
        description: description.trim(),
        budget: numBudget,
        initialInvestment: parseFloat(initialInvestment) || 0,
        expectedRoi: parseFloat(expectedRoi) || 0,
        startDate,
        completionDate: completionDate || undefined,
        linkedFundId: selectedFundId || undefined,
        status,
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || t("common.errors.failedToCreateProject", { defaultValue: "Failed to save project" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? t("projects.editProject", { defaultValue: "Edit Project" }) : t("projects.newProject", { defaultValue: "New Project Master" })}
      description={t("projects.formDescription", { defaultValue: "Define project capital requirements, linked fund, and expected ROI." })}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-md">
            {errorMessage}
          </div>
        )}

        <ERPFormSection title={t("projects.basicDetails", { defaultValue: "General Information" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("projects.title", { defaultValue: "Project Title *" })}>
              <input
                type="text"
                placeholder={t("projects.titlePlaceholder", { defaultValue: "e.g. Dhaka Commercial Plaza" })}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("projects.category", { defaultValue: "Category *" })}>
              <AppDropdown
                options={categoryOptions}
                value={category}
                onChange={(val) => setCategory(val || "")}
                placeholder={t("projects.selectCategory", { defaultValue: "Select category..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormField label={t("projects.description", { defaultValue: "Project Description" })}>
            <textarea
              rows={3}
              placeholder={t("projects.descriptionPlaceholder", { defaultValue: "Comprehensive project scope, objectives and deliverables..." })}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
            />
          </ERPFormField>
        </ERPFormSection>

        <ERPFormSection title={t("projects.financials", { defaultValue: "Capital & Fund Allocation" })}>
          <ERPFormGrid cols={3}>
            <ERPFormField label={t("projects.budget", { defaultValue: "Total Budget *" })}>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("projects.initialInvestment", { defaultValue: "Initial Investment" })}>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={initialInvestment}
                onChange={(e) => setInitialInvestment(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("projects.expectedRoi", { defaultValue: "Expected ROI (%)" })}>
              <input
                type="number"
                step="0.1"
                min="0"
                placeholder="15.0"
                value={expectedRoi}
                onChange={(e) => setExpectedRoi(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("projects.linkedFund", { defaultValue: "Source / Linked Fund" })}>
              <AppDropdown
                options={fundOptions}
                value={selectedFundId}
                onChange={(val) => setSelectedFundId(val)}
                placeholder={t("projects.selectFund", { defaultValue: "Select fund to link..." })}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.status", { defaultValue: "Lifecycle Status" })}>
              <AppDropdown
                options={statusOptions}
                value={status}
                onChange={(val) => setStatus(val || "In Progress")}
                placeholder={t("projects.selectStatusPlaceholder", { defaultValue: "Select status..." })}
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        <ERPFormSection title={t("projects.timeline", { defaultValue: "Timeline & Dates" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("projects.startDate", { defaultValue: "Start Date *" })}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>

            <ERPFormField label={t("projects.completionDate", { defaultValue: "Estimated Completion Date" })}>
              <input
                type="date"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={isSubmitting}>
            {initialData ? t("common.saveChanges", { defaultValue: "Save Changes" }) : t("projects.createButton", { defaultValue: "Create Project" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
