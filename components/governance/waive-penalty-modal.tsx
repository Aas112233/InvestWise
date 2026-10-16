"use client";

import React, { useState } from "react";
import { TopSheet, ERPFormLayout, ERPFormSection, ERPFormField, Button } from "@/components/ui";
import { MemberPenalty } from "@/types";
import { useLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/formatters";

/** Stored enum -> message key. Unknown values fall back to the raw enum. */
const PENALTY_TYPE_KEYS: Record<string, string> = {
  VERBAL_WARNING: "governance.penaltyTypes.verbalWarning",
  FUND_DEDUCTION: "governance.penaltyTypes.fundDeduction",
  SUSPENSION: "governance.penaltyTypes.suspension",
};

interface WaivePenaltyModalProps {
  isOpen: boolean;
  onClose: () => void;
  penalty: MemberPenalty | null;
  onWaive: (penaltyId: string, waiveReason: string) => Promise<void>;
}

export function WaivePenaltyModal({
  isOpen,
  onClose,
  penalty,
  onWaive,
}: WaivePenaltyModalProps) {
  const { t } = useLocale();
  const [waiveReason, setWaiveReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!penalty) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!waiveReason.trim() || waiveReason.trim().length < 5) {
      setErrorMessage(t("governance.validation.waiveReasonLength", { defaultValue: "Please provide a detailed justification for waiving this penalty (min 5 characters)." }));
      return;
    }

    try {
      setIsSubmitting(true);
      await onWaive(penalty.id, waiveReason.trim());
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || t("common.errors.failedToWaivePenalty", { defaultValue: "Failed to waive penalty" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("governance.waivePenaltyTitle", { defaultValue: "Waive Escalated Penalty" })}
      description={t("governance.waiveAuditNotice", { defaultValue: "Waiving leaves an immutable audit trail with your timestamp and justification." })}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-md">
            {errorMessage}
          </div>
        )}

        {/* Penalty Summary Card */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-input rounded-lg text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("governance.columns.member", { defaultValue: "Member:" })}</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{penalty.memberName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t("governance.columns.tier", { defaultValue: "Tier:" })}</span>
            <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
              {t("governance.tierLabel", { tier: penalty.tier, defaultValue: "Tier {tier}" })} •{" "}
              {(() => {
                const key = PENALTY_TYPE_KEYS[penalty.type ?? ""];
                return key ? t(key) : (penalty.type ?? "").replace(/_/g, " ");
              })()}
            </span>
          </div>
          {Number(penalty.calculatedDeduction || penalty.deductionAmount || 0) > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">{t("governance.columns.deduction", { defaultValue: "Deduction Amount:" })}</span>
              <span className="font-mono text-rose-600 dark:text-rose-400">
                {formatMoney(Number(penalty.calculatedDeduction || penalty.deductionAmount || 0))}
              </span>
            </div>
          )}
          <div className="pt-2 border-t border-slate-200 dark:border-input">
            <span className="text-slate-500 dark:text-slate-400 block mb-0.5">{t("governance.originalReason", { defaultValue: "Original Violation:" })}</span>
            <span className="text-slate-700 dark:text-slate-300 italic">{penalty.reason}</span>
          </div>
        </div>

        <ERPFormSection title={t("governance.auditJustification", { defaultValue: "Administrative Justification" })}>
          <ERPFormField label={t("governance.waiveReasonLabel", { defaultValue: "Audit Justification / Waiver Reason *" })}>
            <textarea
              rows={4}
              placeholder={t("governance.waiveReasonPlaceholder", { defaultValue: "Explain why this penalty is being waived (e.g., Medical exemption verified, Board unanimous resolution)..." })}
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-input rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </ERPFormField>
        </ERPFormSection>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-border">
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button variant="destructive" size="sm" type="submit" loading={isSubmitting}>
            {t("governance.confirmWaive", { defaultValue: "Confirm Waiver" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
