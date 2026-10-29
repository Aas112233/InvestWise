"use client";

import React, { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { TopSheet, Button } from "@/components/ui";
import { useFormatMoney } from "@/lib/use-tenant-settings";
import { useLocale } from "@/lib/i18n";
import { translateLedgerDescription } from "@/lib/ledger-description";
import { getTransactionTypeLabel } from "./shared";
import { ledgerRef } from "@/lib/doc-number";

interface SoftDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: {
    id: string;
    referenceNumber?: string;
    type: string;
    amount: number | string;
    description: string;
  } | null;
  onConfirm: (transactionId: string, reason: string) => Promise<void>;
  isDeleting: boolean;
}

export function SoftDeleteModal({
  isOpen,
  onClose,
  transaction,
  onConfirm,
  isDeleting,
}: SoftDeleteModalProps) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!transaction) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError(t("transactions.reasonRequired", { defaultValue: "A deletion reason is mandatory for financial auditing." }));
      return;
    }
    setError(null);
    await onConfirm(transaction.id, reason.trim());
    setReason("");
  };

  const typeLabel = getTransactionTypeLabel(transaction.type, t);

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("transactions.softDeleteTitle", { defaultValue: "Soft Delete Transaction" })}
      description={t("transactions.voucherReference", {
        // Never fall back to the raw primary key: this string is echoed into the
        // deletion audit reason, where a 36-char UUID is unreadable.
        ref: ledgerRef(transaction),
        defaultValue: `Reference: ${ledgerRef(transaction)}`,
      })}
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-2.5">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-300">
            <span className="font-semibold block mb-0.5">
              {t("transactions.auditWarningTitle", { defaultValue: "Financial Compliance Audit Warning (Rule §12)" })}
            </span>
            {t("transactions.auditWarningText", {
              defaultValue:
                "Transactions are never permanently expunged. This record will be marked as soft-deleted, excluded from ledger totals, and stamped with your user ID and audit reason.",
            })}
          </div>
        </div>

        <div className="p-3 bg-muted/40 rounded-xl border border-border/80 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("transactions.type", { defaultValue: "Type" })}</span>
            <span className="font-semibold text-foreground">{typeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("transactions.amount", { defaultValue: "Amount" })}</span>
            <span className="font-bold font-mono text-destructive">
              {formatMoney(Number(transaction.amount))}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("transactions.description", { defaultValue: "Description" })}</span>
            <span className="text-foreground truncate max-w-[200px]">
              {translateLedgerDescription(transaction.description, t) || transaction.description}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground">
            {t("transactions.auditReasonLabel", { defaultValue: "Audit Reason for Deletion" })}{" "}
            <span className="text-destructive">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("transactions.auditReasonPlaceholder", {
              defaultValue: "Explain why this transaction is being retracted (e.g. duplicate voucher, incorrect bank reference)...",
            })}
            className="w-full text-xs p-2.5 rounded-xl border border-border/80 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/80">
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            icon={Trash2}
            loading={isDeleting}
            loadingLabel={t("common.deleting", { defaultValue: "Soft Deleting..." })}
          >
            {t("transactions.confirmSoftDelete", { defaultValue: "Confirm Soft Delete" })}
          </Button>
        </div>
      </form>
    </TopSheet>
  );
}
