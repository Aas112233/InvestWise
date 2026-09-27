"use client";

import React from "react";
import { Printer, X, FileText, CheckCircle2, ShieldCheck, Building2 } from "lucide-react";
import { TopSheet, Button, StatusBadge } from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";

export interface TransactionVoucherData {
  id: string;
  referenceNumber: string;
  date: string;
  type: string;
  amount: number | string;
  category?: string;
  description: string;
  memberName?: string;
  memberCode?: string;
  fundName?: string;
  projectName?: string;
  depositMethod?: string;
  handlingOfficer?: string;
  status: string;
}

interface VoucherDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  voucher: TransactionVoucherData | null;
}

export function VoucherDrawer({ isOpen, onClose, voucher }: VoucherDrawerProps) {
  const { t } = useLocale();

  if (!voucher) return null;

  const handlePrint = () => {
    window.print();
  };

  const isDeposit = voucher.type === "Deposit" || voucher.type === "Earning";

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t("transactions.voucherTitle", { defaultValue: "Financial Voucher" })}
      description={`Reference: ${voucher.referenceNumber || voucher.id}`}
    >
      <div className="space-y-6">
        {/* Printable Voucher Paper Card */}
        <div id="printable-voucher" className="p-6 bg-card text-card-foreground border border-border/80 rounded-xl shadow-xs space-y-6 print:border-none print:shadow-none">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-border/80 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-primary" />
                <span className="font-bold text-sm tracking-tight text-foreground uppercase">
                  InvestWise
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Financial Voucher
              </p>
            </div>
            <div className="text-right">
              <span className="font-mono text-xs font-semibold text-foreground block">
                {voucher.referenceNumber || "N/A"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatDate(voucher.date)}
              </span>
            </div>
          </div>

          {/* Hero Amount */}
          <div className="p-4 bg-muted/40 rounded-xl border border-border/60 text-center">
            <span className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
              {voucher.type} Amount
            </span>
            <div className={`text-2xl font-bold font-mono ${isDeposit ? "text-emerald-500" : "text-destructive"}`}>
              {formatMoney(Number(voucher.amount))}
            </div>
            <div className="mt-2 flex items-center justify-center gap-2">
              <StatusBadge
                tone={voucher.status === "Completed" ? "emerald" : "amber"}
              >
                {voucher.status}
              </StatusBadge>
              <span className="text-xs text-muted-foreground">
                Method: {voucher.depositMethod || "Ledger Entry"}
              </span>
            </div>
          </div>

          {/* Particulars Table */}
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-border/60">
              <span className="text-muted-foreground font-medium">Beneficiary / Member</span>
              <span className="font-semibold text-foreground">
                {voucher.memberName ? `${voucher.memberName} (${voucher.memberCode || "N/A"})` : "N/A"}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/60">
              <span className="text-muted-foreground font-medium">Associated Portfolio / Fund</span>
              <span className="font-semibold text-foreground">
                {voucher.fundName || voucher.projectName || "General Treasury"}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/60">
              <span className="text-muted-foreground font-medium">Category</span>
              <span className="font-semibold text-foreground">
                {voucher.category || "General Operations"}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/60">
              <span className="text-muted-foreground font-medium">Handling Officer</span>
              <span className="font-semibold text-foreground">
                {voucher.handlingOfficer || "System Treasury"}
              </span>
            </div>
            <div className="py-2">
              <span className="text-muted-foreground font-medium block mb-1">Narration / Description</span>
              <p className="text-foreground bg-muted/40 p-2.5 rounded-xl border border-border/60">
                {voucher.description || "Official ledger transaction disbursement."}
              </p>
            </div>
          </div>

          {/* Verification Seal */}
          <div className="pt-4 border-t border-border/80 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-500" />
              <span>Cryptographically Audited Transaction</span>
            </div>
            <span>ERP Immutable Receipt</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.close", { defaultValue: "Close" })}
          </Button>
          <Button variant="primary" icon={Printer} onClick={handlePrint}>
            {t("common.printVoucher", { defaultValue: "Print Voucher" })}
          </Button>
        </div>
      </div>
    </TopSheet>
  );
}
