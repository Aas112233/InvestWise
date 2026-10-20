"use client";

import React from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDate, useFormatDateOnly, useFormatMoney } from "@/lib/use-tenant-settings";
import { translateLedgerDescription } from "@/lib/ledger-description";
import {
  getTransactionTypeLabel,
  getTransactionStatusLabel,
  getCategoryLabel,
} from "@/lib/transaction-labels";
import { DocumentFrame, DocTitle, DocAmount, DocRow, DocField, DocVoidStamp, type DocSignature } from "./document-frame";

export interface LedgerVoucherData {
  id?: string;
  referenceNumber?: string;
  date?: string;
  type?: string;
  amount?: number | string;
  status?: string;
  category?: string;
  description?: string;
  memberName?: string;
  memberCode?: string;
  fundName?: string;
  projectName?: string;
  depositMethod?: string;
  handlingOfficer?: string;
  authorizerName?: string;
  /** Fund balance immediately after this entry was posted. */
  balanceAfter?: number | string | null;
  /** When the row was written, as opposed to the value date it is filed under. */
  createdAt?: string;
  isDeleted?: boolean;
  deletedAt?: string | null;
  deletionReason?: string | null;
  /** The other leg of a fund transfer, which shares this row's transferGroupId. */
  transferCounterpart?: {
    type?: string | null;
    fundName?: string | null;
    referenceNumber?: string | null;
  } | null;
}

/**
 * Ledger voucher — any transaction row printed from the transactions screen.
 *
 * The on-screen voucher it replaced was emerald/rose on a card surface; that
 * palette survives neither the browser's default "no background colours" print
 * setting nor a mono printer, so the sheet states flow direction through the
 * type label and keeps the house monochrome.
 */
export function LedgerVoucher({ data, orgName, orgTagline }: { data: LedgerVoucherData; orgName?: string; orgTagline?: string }) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  const formatDate = useFormatDateOnly();
  const formatDateTime = useFormatDate();
  const na = t("common.na", { defaultValue: "—" });

  const title = t("transactions.voucherTitle", { defaultValue: "Financial Voucher" });
  // DB values are English ("Expense", "PENDING") — render them through the same
  // label helpers the ledger table uses so the sheet follows the app language.
  const typeLabel = getTransactionTypeLabel(data.type, t) || na;
  const categoryLabel = getCategoryLabel(data.category, t);
  const voided = Boolean(data.isDeleted);

  // One fund transfer is two rows; from this leg the counterpart is where the
  // money went (out) or where it came from (in).
  const counterpart = data.transferCounterpart?.fundName
    ? {
        label:
          (data.type || "").trim().toLowerCase() === "transfer in"
            ? t("funds.transferModal.source", { defaultValue: "Source Fund" })
            : t("funds.transferModal.destination", { defaultValue: "Destination Fund" }),
        value: data.transferCounterpart.fundName,
      }
    : null;

  const signatures: DocSignature[] = [
    { label: t("documents.receivedBy", { defaultValue: "Received By" }), name: data.memberName },
    { label: t("documents.preparedBy", { defaultValue: "Prepared By" }), name: data.handlingOfficer },
    { label: t("documents.approvedBy", { defaultValue: "Approved By" }), name: data.authorizerName },
  ];

  return (
    <DocumentFrame
      orgName={orgName}
      orgTagline={orgTagline}
      docType={t("transactions.voucherSubtitle", { defaultValue: "Official Financial Voucher" })}
      reference={data.referenceNumber || data.id}
      dateLabel={data.date ? formatDate(data.date) : undefined}
      signatures={signatures}
    >
      {voided ? (
        <DocVoidStamp
          label={t("documents.voidStamp", { defaultValue: "Voided entry" })}
          dateLabel={data.deletedAt ? formatDateTime(data.deletedAt, true) : undefined}
        />
      ) : null}

      <DocTitle>{title}</DocTitle>
      <DocAmount label={t("transactions.voucherAmount", { type: typeLabel, defaultValue: `${typeLabel} Amount` })}>
        <span style={voided ? { textDecoration: "line-through" } : undefined}>{formatMoney(Number(data.amount || 0))}</span>
      </DocAmount>

      <DocRow label={t("documents.type", { defaultValue: "Type" })} value={typeLabel} strong />
      <DocRow label={t("common.status", { defaultValue: "Status" })} value={getTransactionStatusLabel(data.status, t)} strong />
      <DocRow
        label={t("transactions.beneficiaryMember", { defaultValue: "Beneficiary / Member" })}
        value={data.memberName ? `${data.memberName}${data.memberCode ? ` (${data.memberCode})` : ""}` : na}
      />
      <DocRow
        label={t("transactions.associatedFund", { defaultValue: "Associated Portfolio / Fund" })}
        value={data.fundName || t("transactions.generalTreasury", { defaultValue: "General Treasury" })}
      />
      {counterpart ? <DocRow label={counterpart.label} value={counterpart.value} /> : null}
      {data.projectName ? <DocRow label={t("documents.project", { defaultValue: "Project" })} value={data.projectName} /> : null}
      <DocRow
        label={t("transactions.categoryLabel", { defaultValue: "Category" })}
        value={categoryLabel || t("transactions.generalOperations", { defaultValue: "General Operations" })}
      />
      {data.depositMethod ? <DocRow label={t("deposits.columns.method", { defaultValue: "Method" })} value={data.depositMethod} /> : null}
      {data.balanceAfter != null && data.balanceAfter !== "" ? (
        <DocRow label={t("reports.summary.closingBalance", { defaultValue: "Closing Balance" })} value={formatMoney(Number(data.balanceAfter))} />
      ) : null}
      {data.createdAt ? (
        <DocRow label={t("documents.recordedOn", { defaultValue: "Recorded on" })} value={formatDateTime(data.createdAt, true)} />
      ) : null}
      {voided && data.deletionReason ? (
        <DocField label={t("transactions.deleted.reason", { defaultValue: "Deletion Reason" })}>{data.deletionReason}</DocField>
      ) : null}

      <DocField label={t("documents.remarks", { defaultValue: "Remarks" })}>
        {translateLedgerDescription(data.description, t) ||
          t("transactions.defaultNarration", { defaultValue: "Official ledger transaction spending." })}
      </DocField>
    </DocumentFrame>
  );
}
