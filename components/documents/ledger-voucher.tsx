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
import { amountInWords } from "@/lib/amount-in-words";
import {
  DocumentFrame,
  DocBanner,
  DocTitle,
  DocAmount,
  DocRow,
  DocField,
  DocVoidStamp,
  type DocSignature,
} from "./document-frame";
import { useMonthLabel } from "./month-label";

export interface LedgerVoucherData {
  id?: string;
  referenceNumber?: string;
  date?: string;
  type?: string;
  amount?: number | string;
  status?: string;
  category?: string;
  description?: string;
  expenseName?: string | null;
  memberName?: string;
  memberCode?: string;
  fundName?: string;
  /** Deposit rows only: the YYYY-MM period the money is FOR. */
  depositMonth?: string | null;
  projectName?: string;
  depositMethod?: string;
  /** Project Investment legs only: the deposit fund the capital is drawn FROM. */
  sourceFundName?: string | null;
  handlingOfficer?: string;
  authorizerName?: string;
  /** Fund balance immediately before this entry was posted. */
  balanceBefore?: number | string | null;
  /** Fund balance immediately after this entry was posted. */
  balanceAfter?: number | string | null;
  /** When the row was written, as opposed to the value date it is filed under. */
  createdAt?: string;
  isDeleted?: boolean;
  deletedAt?: string | null;
  deletedByName?: string | null;
  deletionReason?: string | null;
  fiscalPeriod?: { year: number; status: string | null; closedAt: string | null } | null;
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
  const monthLabel = useMonthLabel();
  const na = t("common.na", { defaultValue: "—" });

  const title = t("transactions.voucherTitle", { defaultValue: "Financial Voucher" });
  // DB values are English ("Expense", "PENDING") — render them through the same
  // label helpers the ledger table uses so the sheet follows the app language.
  const typeLabel = getTransactionTypeLabel(data.type, t) || na;
  const categoryLabel = getCategoryLabel(data.category, t);
  const voided = Boolean(data.isDeleted);
  const upper = (data.status || "").toUpperCase();
  const pending = !voided && upper === "PENDING";
  const rejected = !voided && upper === "REJECTED";

  // One fund transfer is two rows; from this leg the counterpart is where the
  // money went (out) or where it came from (in). Its reference is printed too:
  // without it the two halves of one transfer cannot be tied together on paper,
  // and one leg printed twice reads as two unrelated movements.
  const counterpartRef = data.transferCounterpart?.referenceNumber;
  const counterpart = data.transferCounterpart?.fundName
    ? {
        label:
          (data.type || "").trim().toLowerCase() === "transfer in"
            ? t("funds.transferModal.source", { defaultValue: "Source Fund" })
            : t("funds.transferModal.destination", { defaultValue: "Destination Fund" }),
        value: counterpartRef
          ? `${data.transferCounterpart.fundName} · ${t("documents.pairedVoucher", { defaultValue: "paired voucher" })} ${counterpartRef}`
          : data.transferCounterpart.fundName,
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
      reference={data.referenceNumber}
      dateLabel={data.date ? formatDate(data.date) : undefined}
      signatures={signatures}
    >
      {voided ? (
        <DocVoidStamp
          label={t("documents.voidStamp", { defaultValue: "Voided entry" })}
          dateLabel={data.deletedAt ? formatDateTime(data.deletedAt, true) : undefined}
          detail={data.deletedByName ? `${t("documents.voidedBy", { defaultValue: "Voided by" })} ${data.deletedByName}` : undefined}
        />
      ) : pending ? (
        <DocBanner label={t("documents.pendingVoucherBanner", { defaultValue: "Not yet authorised — no funds have moved" })} />
      ) : rejected ? (
        <DocBanner label={t("documents.rejectedBanner", { defaultValue: "Rejected request — no funds were received" })} />
      ) : null}

      <DocTitle>{title}</DocTitle>
      <DocAmount
        label={t("transactions.voucherAmount", { type: typeLabel, defaultValue: `${typeLabel} Amount` })}
        words={amountInWords(data.amount)}
        wordsLabel={t("documents.amountInWords", { defaultValue: "In words" })}
      >
        <span style={voided || rejected ? { textDecoration: "line-through" } : undefined}>
          {formatMoney(Number(data.amount || 0))}
        </span>
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
      {data.sourceFundName ? (
        <DocRow label={t("documents.drawnFrom", { defaultValue: "Capital drawn from" })} value={data.sourceFundName} />
      ) : null}
      {counterpart ? <DocRow label={counterpart.label} value={counterpart.value} /> : null}
      {data.projectName ? <DocRow label={t("documents.project", { defaultValue: "Project" })} value={data.projectName} /> : null}
      <DocRow
        label={t("transactions.categoryLabel", { defaultValue: "Category" })}
        value={categoryLabel || t("transactions.generalOperations", { defaultValue: "General Operations" })}
      />
      {data.expenseName ? (
        <DocRow label={t("reports.columns.expenseName", { defaultValue: "Expense" })} value={data.expenseName} />
      ) : null}
      {data.depositMonth ? (
        <DocRow label={t("documents.depositFor", { defaultValue: "Deposit for" })} value={monthLabel(data.depositMonth)} strong />
      ) : null}
      {data.depositMethod ? <DocRow label={t("deposits.columns.method", { defaultValue: "Method" })} value={data.depositMethod} /> : null}
      {data.balanceBefore != null && data.balanceBefore !== "" ? (
        <DocRow
          label={t("documents.openingBalance", { defaultValue: "Fund balance before" })}
          value={formatMoney(Number(data.balanceBefore))}
        />
      ) : null}
      {data.balanceAfter != null && data.balanceAfter !== "" ? (
        <DocRow label={t("reports.summary.closingBalance", { defaultValue: "Closing Balance" })} value={formatMoney(Number(data.balanceAfter))} />
      ) : null}
      {data.fiscalPeriod ? (
        <DocRow
          label={t("documents.fiscalPeriod", { defaultValue: "Fiscal period" })}
          value={`${data.fiscalPeriod.year} · ${
            (data.fiscalPeriod.status || "").toUpperCase() === "CLOSED"
              ? t("documents.periodClosed", { defaultValue: "CLOSED" })
              : t("documents.periodOpen", { defaultValue: "OPEN" })
          }`}
        />
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
