"use client";

import React, { useState, useEffect } from "react";
import {
  TopSheet,
  ERPFormLayout,
  ERPFormSection,
  ERPFormGrid,
  ERPFormField,
  AppDropdown,
  DropdownOption,
  Button,
  ERPDatePicker,
  StatusBadge,
} from "@/components/ui";
import { Plus, Trash2, AlertCircle, Info, Landmark, Layers } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { Project, Member } from "@/types";
import { formatMoney } from "@/lib/formatters";

interface ShareholderInputRow {
  memberId: string;
  shares: number;
}

interface ProjectFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (projectData: any) => Promise<void>;
  funds: Array<{ id: string; name: string; balance: number }>;
  members?: Member[];
  tenantShareValue?: number;
  initialData?: Project | null;
}

export function ProjectFormModal({
  isOpen,
  onClose,
  onSubmit,
  funds,
  members = [],
  tenantShareValue = 1000,
  initialData,
}: ProjectFormModalProps) {
  const { t } = useLocale();

  // Basic Information
  const [title, setTitle] = useState(initialData?.title || "");
  const [category, setCategory] = useState(initialData?.category || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [status, setStatus] = useState<string>(initialData?.status || "In Progress");

  // Financials & ROI
  const [budget, setBudget] = useState(initialData?.budget ? String(initialData.budget) : "");
  const [initialInvestment, setInitialInvestment] = useState(
    initialData?.initialInvestment ? String(initialData.initialInvestment) : ""
  );
  const [expectedRoi, setExpectedRoi] = useState(
    initialData?.expectedRoi !== undefined ? String(initialData.expectedRoi) : ""
  );

  // Fund Strategy: link existing vs create dedicated
  const [fundStrategy, setFundStrategy] = useState<"linkExisting" | "createNew">(
    initialData?.linkedFundId ? "linkExisting" : "linkExisting"
  );
  const [selectedFundId, setSelectedFundId] = useState<string | null>(initialData?.linkedFundId || null);
  const [newFundName, setNewFundName] = useState("");

  // Timeline & Dates
  const [startDate, setStartDate] = useState(initialData?.startDate || "");
  const [completionDate, setCompletionDate] = useState(initialData?.completionDate || "");

  // Shareholders & Equity Allocation (Option A)
  const [shareholders, setShareholders] = useState<ShareholderInputRow[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset form when modal opens with initialData
  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || "");
      setCategory(initialData.category || "");
      setDescription(initialData.description || "");
      setBudget(initialData.budget ? String(initialData.budget) : "");
      setInitialInvestment(initialData.initialInvestment ? String(initialData.initialInvestment) : "");
      setExpectedRoi(initialData.expectedRoi !== undefined ? String(initialData.expectedRoi) : "");
      setStartDate(initialData.startDate || "");
      setCompletionDate(initialData.completionDate || "");
      setSelectedFundId(initialData.linkedFundId || null);
      setStatus(initialData.status || "In Progress");
      setFundStrategy("linkExisting");
      setShareholders([]);
    } else {
      setTitle("");
      setCategory("");
      setDescription("");
      setBudget("");
      setInitialInvestment("");
      setExpectedRoi("");
      setStartDate("");
      setCompletionDate("");
      setSelectedFundId(null);
      setNewFundName("");
      setStatus("In Progress");
      setFundStrategy("linkExisting");
      setShareholders([]);
    }
    setErrorMessage(null);
  }, [initialData, isOpen]);

  const fundOptions: DropdownOption[] = funds.map((f) => ({
    value: f.id,
    label: `${f.name} (Bal: ${formatMoney(f.balance)})`,
  }));

  const memberOptions: DropdownOption[] = members.map((m) => {
    const depositBal = Number(m.totalContributed || 0);
    return {
      value: m.id,
      label: `${m.name} (${m.memberId}) — Bal: ${formatMoney(depositBal)}`,
    };
  });

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

  // Helper calculations for shareholders
  const totalShares = shareholders.reduce((acc, s) => acc + (Number(s.shares) || 0), 0);
  const totalShareholderCapital = totalShares * tenantShareValue;

  const handleAddShareholder = () => {
    setShareholders((prev) => [...prev, { memberId: "", shares: 1 }]);
  };

  const handleRemoveShareholder = (index: number) => {
    setShareholders((prev) => prev.filter((_, i) => i !== index));
  };

  const handleShareholderChange = (index: number, field: "memberId" | "shares", value: any) => {
    setShareholders((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (field === "memberId") {
          return { ...row, memberId: String(value || "") };
        }
        return { ...row, shares: Number(value) || 1 };
      })
    );
  };

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

    if (fundStrategy === "createNew" && !newFundName.trim() && !title.trim()) {
      setErrorMessage(t("projects.validation.fundNameRequired", { defaultValue: "Dedicated fund name is required." }));
      return;
    }

    // Validate shareholders
    const validShareholders: Array<{ memberId: string; shares: number }> = [];
    const seenIds = new Set<string>();

    for (const sh of shareholders) {
      if (!sh.memberId) continue;
      if (seenIds.has(sh.memberId)) {
        setErrorMessage(t("projects.validation.duplicateShareholder", { defaultValue: "Each member can only be added once as a shareholder." }));
        return;
      }
      seenIds.add(sh.memberId);

      const shares = Number(sh.shares);
      if (isNaN(shares) || shares < 1) {
        setErrorMessage(t("projects.validation.invalidShares", { defaultValue: "Shares must be at least 1." }));
        return;
      }

      // Check deposit balance
      const member = members.find((m) => m.id === sh.memberId);
      const memberBalance = Number(member?.totalContributed || 0);
      const requiredCapital = shares * tenantShareValue;

      if (memberBalance < requiredCapital) {
        setErrorMessage(
          `${member?.name || "Member"} has insufficient deposit balance (Available: ${formatMoney(memberBalance)}, Required: ${formatMoney(requiredCapital)})`
        );
        return;
      }

      validShareholders.push({ memberId: sh.memberId, shares });
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
        linkedFundId: fundStrategy === "linkExisting" ? (selectedFundId || undefined) : undefined,
        createNewFund: fundStrategy === "createNew",
        newFundName: fundStrategy === "createNew" ? (newFundName.trim() || `${title.trim()} Fund`) : undefined,
        status,
        shareholders: validShareholders,
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
      description={t("projects.formDescription", { defaultValue: "Define project capital requirements, linked fund, and shareholder equity allocations." })}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Section 1: General Details */}
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

        {/* Section 2: Financials & Budget */}
        <ERPFormSection title={t("projects.financials", { defaultValue: "Capital & ROI Projection" })}>
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
        </ERPFormSection>

        {/* Section 3: Fund Management (Link vs Create Dedicated) */}
        <ERPFormSection title={t("projects.fundStrategy", { defaultValue: "Fund Management" })}>
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-xs font-medium">
              <label className="flex items-center gap-2 cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="fundStrategy"
                  checked={fundStrategy === "linkExisting"}
                  onChange={() => setFundStrategy("linkExisting")}
                  className="text-primary focus:ring-primary h-3.5 w-3.5"
                />
                <span>{t("projects.funds.linkExisting", { defaultValue: "Link Existing Fund" })}</span>
              </label>

              {!initialData && (
                <label className="flex items-center gap-2 cursor-pointer text-foreground">
                  <input
                    type="radio"
                    name="fundStrategy"
                    checked={fundStrategy === "createNew"}
                    onChange={() => setFundStrategy("createNew")}
                    className="text-primary focus:ring-primary h-3.5 w-3.5"
                  />
                  <span>{t("projects.funds.createDedicated", { defaultValue: "Create New Dedicated Fund" })}</span>
                </label>
              )}
            </div>

            {fundStrategy === "linkExisting" ? (
              <ERPFormField label={t("projects.linkedFund", { defaultValue: "Source / Linked Fund" })}>
                <AppDropdown
                  options={fundOptions}
                  value={selectedFundId}
                  onChange={(val) => setSelectedFundId(val)}
                  placeholder={t("projects.selectFund", { defaultValue: "Select fund to link..." })}
                />
              </ERPFormField>
            ) : (
              <ERPFormField label={t("projects.funds.newFundName", { defaultValue: "Dedicated Fund Name *" })}>
                <div className="relative">
                  <input
                    type="text"
                    placeholder={title ? `${title} Fund` : t("projects.funds.newFundPlaceholder", { defaultValue: "e.g. Commercial Plaza Fund" })}
                    value={newFundName}
                    onChange={(e) => setNewFundName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card border border-border/80 text-foreground rounded-xl placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors"
                  />
                </div>
              </ERPFormField>
            )}
          </div>
        </ERPFormSection>

        {/* Section 4: Timeline & Dates */}
        <ERPFormSection title={t("projects.timeline", { defaultValue: "Timeline & Dates" })}>
          <ERPFormGrid cols={3}>
            <ERPFormField label={t("projects.startDate", { defaultValue: "Start Date *" })}>
              <ERPDatePicker
                value={startDate || null}
                onChange={(iso) => setStartDate(iso || "")}
                placeholder={t("projects.startDate", { defaultValue: "Start Date" })}
              />
            </ERPFormField>

            <ERPFormField label={t("projects.completionDate", { defaultValue: "Estimated Completion Date" })}>
              <ERPDatePicker
                value={completionDate || null}
                onChange={(iso) => setCompletionDate(iso || "")}
                placeholder={t("projects.completionDate", { defaultValue: "Estimated Completion Date" })}
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

        {/* Section 5: Project Shareholders & Equity Allocation (Option A) */}
        {!initialData && (
          <ERPFormSection title={t("projects.shareholders.title", { defaultValue: "Project Shareholders & Equity Ownership" })}>
            <div className="space-y-3">
              {/* Option A Policy Banner */}
              <div className="p-3 bg-muted/40 border border-border/80 rounded-xl flex items-start gap-2.5 text-xs text-muted-foreground">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    {t("projects.shareholders.tenantShareValue", {
                      value: formatMoney(tenantShareValue),
                      defaultValue: `Tenant Share Value: ${formatMoney(tenantShareValue)} per share`,
                    })}
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    {t("projects.shareholders.optionANote", {
                      defaultValue:
                        "Option A Active: On project creation, this capital will be deducted from each member's existing deposit account and transferred into the project fund.",
                    })}
                  </p>
                </div>
              </div>

              {/* Shareholder Rows */}
              {shareholders.length === 0 ? (
                <div className="p-4 border border-dashed border-border/80 rounded-xl text-center text-xs text-muted-foreground">
                  <p>{t("projects.shareholders.noShareholders", { defaultValue: "No shareholders assigned to this project yet." })}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("projects.shareholders.addMembersHint", {
                      defaultValue: "Add members to distribute project shares and auto-deduct required capital from their deposit balance.",
                    })}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {shareholders.map((row, index) => {
                    const selectedMember = members.find((m) => m.id === row.memberId);
                    const memberDeposit = Number(selectedMember?.totalContributed || 0);
                    const requiredCapital = (row.shares || 0) * tenantShareValue;
                    const isInsufficient = selectedMember && memberDeposit < requiredCapital;

                    return (
                      <div
                        key={index}
                        className={`p-3 bg-card border rounded-xl space-y-2 transition-colors ${
                          isInsufficient ? "border-rose-300 dark:border-rose-900 bg-rose-50/20" : "border-border/80"
                        }`}
                      >
                        <div className="grid grid-cols-12 gap-3 items-center">
                          <div className="col-span-6">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.shareholderMember", { defaultValue: "Member" })}
                            </label>
                            <AppDropdown
                              options={memberOptions}
                              value={row.memberId || null}
                              onChange={(val) => handleShareholderChange(index, "memberId", val || "")}
                              placeholder={t("projects.shareholders.selectMember", { defaultValue: "Select member..." })}
                            />
                          </div>

                          <div className="col-span-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.sharesLabel", { defaultValue: "Shares" })}
                            </label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={row.shares}
                              onChange={(e) =>
                                handleShareholderChange(index, "shares", Math.max(1, parseInt(e.target.value) || 1))
                              }
                              className="w-full px-2.5 py-2 text-xs font-mono bg-card border border-border/80 text-foreground rounded-xl outline-none focus:border-primary"
                            />
                          </div>

                          <div className="col-span-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                              {t("projects.shareholders.capital", { defaultValue: "Required Capital" })}
                            </label>
                            <div className="px-2.5 py-2 text-xs font-mono font-semibold text-foreground bg-muted/30 border border-border/60 rounded-xl">
                              {formatMoney(requiredCapital)}
                            </div>
                          </div>

                          <div className="col-span-1 flex justify-end pt-5">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Trash2}
                              onClick={() => handleRemoveShareholder(index)}
                              className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 h-8 w-8 p-0"
                            />
                          </div>
                        </div>

                        {/* Balance Warning / Status */}
                        {isInsufficient && (
                          <div className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium pt-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>
                              {t("projects.shareholders.insufficientDeposit", {
                                available: formatMoney(memberDeposit),
                                defaultValue: `Insufficient deposit balance (Available: ${formatMoney(memberDeposit)})`,
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  icon={Plus}
                  type="button"
                  onClick={handleAddShareholder}
                >
                  {t("projects.shareholders.add", { defaultValue: "Add Shareholder" })}
                </Button>

                {shareholders.length > 0 && (
                  <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                    <span>
                      {t("projects.shareholders.totalProjectShares", { defaultValue: "Total Shares" })}:{" "}
                      <strong className="text-foreground">{totalShares}</strong>
                    </span>
                    <span>
                      {t("projects.shareholders.totalMemberCapital", { defaultValue: "Total Capital" })}:{" "}
                      <strong className="text-foreground">{formatMoney(totalShareholderCapital)}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </ERPFormSection>
        )}

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
