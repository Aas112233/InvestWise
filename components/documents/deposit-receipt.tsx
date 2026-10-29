"use client";

import React from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDate, useFormatDateOnly, useFormatMoney, useTenantCurrency } from "@/lib/use-tenant-settings";
import { translateLedgerDescription } from "@/lib/ledger-description";
import { monthKeyOf } from "@/components/deposits/shared";
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
import { ledgerRef } from "@/lib/doc-number";

export interface DepositReceiptData {
  id?: string;
  /** Printed reference (DEP-2026-00042). See lib/doc-number.ts. */
  docNumber?: string | null;
  referenceNumber?: string;
  date?: string;
  amount?: number | string;
  memberName?: string;
  memberCode?: string;
  /** The member's contribution balance after this deposit — what payouts measure. */
  memberTotalContributed?: number | string | null;
  fundName?: string;
  depositMethod?: string;
  /** YYYY-MM: the month this deposit is FOR. Distinct from the collected date. */
  depositMonth?: string | null;
  status?: string;
  handlingOfficer?: string;
  authorizerName?: string;
  description?: string;
  balanceBefore?: number | string | null;
  balanceAfter?: number | string | null;
  submittedDate?: string | null;
  createdAt?: string;
  isDeleted?: boolean;
  deletedAt?: string | null;
  deletedByName?: string | null;
  fiscalPeriod?: { year: number; status: string | null; closedAt: string | null } | null;
}

/** Deposit receipt — opened after a deposit is approved. */
export function DepositReceipt({ data, orgName, orgTagline }: { data: DepositReceiptData; orgName?: string; orgTagline?: string }) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  // The words line is the tamper evidence on this document, so it has to name the
  // currency the figures above it are in.
  const currency = useTenantCurrency();
  const formatDate = useFormatDateOnly();
  const formatDateTime = useFormatDate();
  const monthLabel = useMonthLabel();
  const na = t("common.na", { defaultValue: "—" });

  const title = t("deposits.receiptTitle", { defaultValue: "Deposit Receipt" });
  // The DB stores English status values; render them through the same labels
  // the deposits screen uses so the document follows the app language.
  const upper = (data.status || "").toUpperCase();
  const pending = upper === "PENDING";
  const rejected = upper === "REJECTED";
  const status = pending
    ? t("deposits.statusPending", { defaultValue: "Pending" })
    : rejected
      ? t("deposits.statusRejected", { defaultValue: "Rejected" })
      : t("deposits.statusVerified", { defaultValue: "Verified" });

  // The month the money discharges. This is the assessment period the society's
  // own duplicate-month rule keys on, so a receipt without it cannot rebut an
  // arrears claim — and on back-entry the collected date points elsewhere.
  const monthKey = data.depositMonth || monthKeyOf(data.date);

  // Written-down date matters separately from collected date: a deposit
  // collected on the 5th and entered on the 7th is a back-entry.
  const bookedOn = data.submittedDate && data.createdAt
    ? formatDate(data.submittedDate) !== formatDate(data.createdAt)
      ? data.submittedDate
      : null
    : null;

  const signatures: DocSignature[] = [
    { label: t("documents.receivedBy", { defaultValue: "Received By" }), name: data.memberName },
    { label: t("documents.preparedBy", { defaultValue: "Prepared By" }), name: data.handlingOfficer },
    { label: t("documents.approvedBy", { defaultValue: "Approved By" }), name: data.authorizerName },
  ];

  const words = amountInWords(data.amount, currency);

  return (
    <DocumentFrame
      orgName={orgName}
      orgTagline={orgTagline}
      docType={title}
      reference={ledgerRef(data, "") || undefined}
      dateLabel={data.date ? formatDate(data.date) : undefined}
      signatures={signatures}
    >
      {data.isDeleted ? (
        <DocVoidStamp
          label={t("documents.voidStamp", { defaultValue: "Voided entry" })}
          dateLabel={data.deletedAt ? formatDateTime(data.deletedAt, true) : undefined}
          detail={data.deletedByName ? `${t("documents.voidedBy", { defaultValue: "Voided by" })} ${data.deletedByName}` : undefined}
        />
      ) : pending ? (
        <DocBanner
          label={t("documents.pendingBanner", { defaultValue: "Subject to verification — not yet a receipt of funds" })}
          detail={t("documents.pendingBannerHint", { defaultValue: "This deposit has not been verified by an officer, and the funds are not yet held." })}
        />
      ) : rejected ? (
        <DocBanner
          label={t("documents.rejectedBanner", { defaultValue: "Rejected request — no funds were received" })}
        />
      ) : null}

      <DocTitle>{title}</DocTitle>
      <DocAmount
        label={t("deposits.columns.amount", { defaultValue: "Amount" })}
        words={words}
        wordsLabel={t("documents.amountInWords", { defaultValue: "In words" })}
      >
        <span style={data.isDeleted || rejected ? { textDecoration: "line-through" } : undefined}>
          {formatMoney(Number(data.amount || 0))}
        </span>
      </DocAmount>

      <DocRow
        label={t("documents.depositFor", { defaultValue: "Deposit for" })}
        value={monthLabel(monthKey)}
        strong
      />
      <DocRow label={t("documents.collectedOn", { defaultValue: "Collected on" })} value={data.date ? formatDate(data.date) : na} />
      <DocRow
        label={t("deposits.columns.member", { defaultValue: "Member" })}
        value={data.memberName ? `${data.memberName}${data.memberCode ? ` (${data.memberCode})` : ""}` : na}
      />
      <DocRow label={t("deposits.columns.fund", { defaultValue: "Fund" })} value={data.fundName || na} />
      <DocRow label={t("deposits.columns.method", { defaultValue: "Method" })} value={data.depositMethod || na} />
      <DocRow label={t("common.status", { defaultValue: "Status" })} value={status} strong />

      {data.balanceBefore != null && data.balanceBefore !== "" ? (
        <DocRow
          label={t("documents.openingBalance", { defaultValue: "Fund balance before" })}
          value={formatMoney(Number(data.balanceBefore))}
        />
      ) : null}
      {data.balanceAfter != null && data.balanceAfter !== "" ? (
        <DocRow
          label={t("documents.closingBalance", { defaultValue: "Fund balance after" })}
          value={formatMoney(Number(data.balanceAfter))}
        />
      ) : null}
      {data.memberTotalContributed != null && data.memberTotalContributed !== "" ? (
        <DocRow
          label={t("documents.contributionBalance", { defaultValue: "Member contribution balance" })}
          value={formatMoney(Number(data.memberTotalContributed))}
        />
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

      <DocRow label={t("deposits.modal.cashier", { defaultValue: "Handled By" })} value={data.handlingOfficer || na} />
      {bookedOn ? (
        <DocRow label={t("documents.bookedOn", { defaultValue: "Booked on" })} value={formatDateTime(bookedOn, true)} />
      ) : null}
      {data.createdAt ? (
        <DocRow label={t("documents.recordedOn", { defaultValue: "Recorded on" })} value={formatDateTime(data.createdAt, true)} />
      ) : null}
      {data.authorizerName ? (
        <DocRow label={t("expenses.approvedBy", { defaultValue: "Approved By" })} value={data.authorizerName} />
      ) : null}
      {data.description ? (
        <DocField label={t("documents.remarks", { defaultValue: "Remarks" })}>
          {translateLedgerDescription(data.description, t)}
        </DocField>
      ) : null}

      <div style={{ marginTop: "4mm", fontSize: 9.5, color: "#9ca3af", lineHeight: 1.5 }}>
        {t("documents.contributionFootnote", {
          defaultValue:
            "This receipt evidences money received and credited to the member's contribution balance. Share allocation is governed by the society's register, not by this document.",
        })}
      </div>
    </DocumentFrame>
  );
}
