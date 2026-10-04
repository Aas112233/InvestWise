"use client";

import React, { useState } from "react";
import { TopSheet, ERPFormLayout, ERPFormSection, ERPFormGrid, ERPFormField, AppDropdown, DropdownOption, Button } from "@/components/ui";
import { Member, MemberPenalty } from "@/types";
import { useLocale } from "@/lib/i18n";
import { useTenantPenaltyRules, useTenantCurrency } from "@/lib/use-tenant-settings";

interface IssuePenaltyModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  onIssuePenalty: (payload: {
    memberId: string;
    tier: 1 | 2 | 3 | 4;
    title: string;
    type: "VERBAL_WARNING" | "FUND_DEDUCTION" | "SUSPENSION";
    deductionAmount?: number;
    reason: string;
  }) => Promise<void>;
}

export function IssuePenaltyModal({
  isOpen,
  onClose,
  members,
  onIssuePenalty,
}: IssuePenaltyModalProps) {
  const { t } = useLocale();
  const penaltyRules = useTenantPenaltyRules();
  const currency = useTenantCurrency();

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [tier, setTier] = useState<1 | 2 | 3 | 4>(1);
  const [title, setTitle] = useState("Verbal Warning for Non-Compliance");
  const [type, setType] = useState<"VERBAL_WARNING" | "FUND_DEDUCTION" | "SUSPENSION">("VERBAL_WARNING");
  const [deductionAmount, setDeductionAmount] = useState("");
  const [reason, setReason] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const memberOptions: DropdownOption[] = members.map((m) => ({
    value: m.id,
    label: `${m.name} (${m.memberId})`,
  }));

  const tierOptions: DropdownOption[] = [
    { value: "1", label: t("governance.tiers.tier1", { defaultValue: "Tier 1 - Verbal Warning" }) },
    { value: "2", label: t("governance.tiers.tier2", { defaultValue: "Tier 2 - Minor Fund Deduction" }) },
    { value: "3", label: t("governance.tiers.tier3", { defaultValue: "Tier 3 - Major Fund Deduction" }) },
    { value: "4", label: t("governance.tiers.tier4", { defaultValue: "Tier 4 - Membership Suspension" }) },
  ];

  const typeOptions: DropdownOption[] = [
    { value: "VERBAL_WARNING", label: t("governance.penaltyTypes.verbalWarning", { defaultValue: "Verbal Warning" }) },
    { value: "FUND_DEDUCTION", label: t("governance.penaltyTypes.fundDeduction", { defaultValue: "Fund Deduction" }) },
    { value: "SUSPENSION", label: t("governance.penaltyTypes.suspension", { defaultValue: "Membership Suspension" }) },
  ];

  const handleTierChange = (val: string | null) => {
    const numTier = Number(val) as 1 | 2 | 3 | 4;
    setTier(numTier);
    const rule = penaltyRules.find((r) => r.tier === numTier);
    if (rule) {
      setType((rule.type as any) || "VERBAL_WARNING");
      setTitle(rule.title);
      if (rule.deductionAmount) {
        setDeductionAmount(String(rule.deductionAmount));
      } else {
        setDeductionAmount("");
      }
    } else {
      if (numTier === 1) {
        setType("VERBAL_WARNING");
        setTitle("Verbal Warning for Non-Compliance");
        setDeductionAmount("");
      } else if (numTier === 2 || numTier === 3) {
        setType("FUND_DEDUCTION");
        setTitle(numTier === 2 ? "Tier 2 Governance Deduction" : "Tier 3 Escalated Deduction");
        setDeductionAmount(numTier === 2 ? "50" : "200");
      } else if (numTier === 4) {
        setType("SUSPENSION");
        setTitle("Tier 4 Membership Suspension");
        setDeductionAmount("500");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedMemberId) {
      setErrorMessage(t("governance.validation.selectMember", { defaultValue: "Please select a member." }));
      return;
    }
    if (!title.trim()) {
      setErrorMessage(t("governance.validation.titleRequired", { defaultValue: "Penalty title is required." }));
      return;
    }
    if (!reason.trim()) {
      setErrorMessage(t("governance.validation.reasonRequired", { defaultValue: "Violation reason is required." }));
      return;
    }

    try {
      setIsSubmitting(true);
      await onIssuePenalty({
        memberId: selectedMemberId,
        tier,
        title: title.trim(),
        type,
        deductionAmount: type === "FUND_DEDUCTION" ? parseFloat(deductionAmount) || 0 : 0,
        reason: reason.trim(),
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to issue penalty.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("governance.issuePenalty", { defaultValue: "Issue Governance Penalty" })}
      description={t("governance.issueDescription", { defaultValue: "Issue a tier 1-4 escalation penalty with mandatory violation documentation." })}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-md">
            {errorMessage}
          </div>
        )}

        <ERPFormSection title={t("governance.penaltySpecification", { defaultValue: "Target & Escalation Tier" })}>
          <ERPFormGrid cols={2}>
            <ERPFormField label={t("governance.selectTargetMember", { defaultValue: "Target Member *" })}>
              <AppDropdown
                options={memberOptions}
                value={selectedMemberId}
                onChange={(val) => setSelectedMemberId(val)}
                placeholder={t("governance.selectMemberPlaceholder", { defaultValue: "Select member..." })}
              />
            </ERPFormField>

            <ERPFormField label={t("governance.escalationTier", { defaultValue: "Escalation Tier *" })}>
              <AppDropdown
                options={tierOptions}
                value={String(tier)}
                onChange={handleTierChange}
                placeholder={t("governance.selectTierPlaceholder", { defaultValue: "Select tier..." })}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid cols={2}>
            <ERPFormField label={t("governance.penaltyType", { defaultValue: "Action Type *" })}>
              <AppDropdown
                options={typeOptions}
                value={type}
                onChange={(val) => setType((val as any) || "VERBAL_WARNING")}
                placeholder={t("governance.selectActionTypePlaceholder", { defaultValue: "Select action type..." })}
              />
            </ERPFormField>

            {type === "FUND_DEDUCTION" && (
              <ERPFormField label={t("governance.deductionAmount", { defaultValue: "Deduction Amount *" })}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="500.00"
                  value={deductionAmount}
                  onChange={(e) => setDeductionAmount(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </ERPFormField>
            )}
          </ERPFormGrid>
        </ERPFormSection>

        <ERPFormSection title={t("governance.documentation", { defaultValue: "Violation Documentation" })}>
          <ERPFormField label={t("governance.penaltyTitle", { defaultValue: "Penalty Notice Title *" })}>
            <input
              type="text"
              placeholder="e.g. Unexcused absence from mandatory Q3 AGM"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </ERPFormField>

          <ERPFormField label={t("governance.violationReason", { defaultValue: "Detailed Reason & Incident Report *" })}>
            <textarea
              rows={4}
              placeholder="Document the exact circumstances and committee resolution..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </ERPFormField>
        </ERPFormSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="destructive" size="sm" type="submit" loading={isSubmitting}>
            {t("governance.confirmIssue", { defaultValue: "Issue Penalty" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
