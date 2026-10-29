"use client";

import React from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDate, useFormatDateOnly, useFormatMoney, useTenantCurrency } from "@/lib/use-tenant-settings";
import { translateLedgerDescription } from "@/lib/ledger-description";
import { getTransactionStatusLabel } from "@/lib/transaction-labels";
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
import { ledgerRef } from "@/lib/doc-number";

export interface ProjectUpdateReceiptData {
  id?: string;
  /** Printed reference (DEP-2026-00042). See lib/doc-number.ts. */
  docNumber?: string | null;
  referenceNumber?: string;
  date?: string;
  amount?: number | string;
  type?: string;
  projectName?: string;
  memberName?: string;
  memberCode?: string;
  fundName?: string;
  status?: string;
  handlingOfficer?: string;
  authorizerName?: string;
  description?: string;
  balanceBefore?: number | string | null;
  balanceAfter?: number | string | null;
  createdAt?: string;
  isDeleted?: boolean;
  deletedAt?: string | null;
  deletedByName?: string | null;
  deletionReason?: string | null;
  fiscalPeriod?: { year: number; status: string | null; closedAt: string | null } | null;
}

/** Project update receipt — opened after a project spending/earning is posted. */
export function ProjectUpdateReceipt({ data, orgName, orgTagline }: { data: ProjectUpdateReceiptData; orgName?: string; orgTagline?: string }) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  // Words must name the same currency as the figures — see lib/amount-in-words.ts.
  const currency = useTenantCurrency();
  const formatDate = useFormatDateOnly();
  const formatDateTime = useFormatDate();
  const na = t("common.na", { defaultValue: "—" });

  const title = t("documents.projectUpdate", { defaultValue: "Project Update" });
  // DB values are English ("Earning"/"Expense") — render through the app's
  // own ledger labels so the document follows the app language.
  const type =
    data.type === "Earning"
      ? t("projects.txLabels.earning", { defaultValue: "Earning" })
      : data.type === "Expense"
        ? t("projects.txLabels.expense", { defaultValue: "Expense" })
        : data.type || na;
  // The row's real status, not a literal: a posting can be PENDING or REJECTED,
  // and a receipt that asserts "Completed" for either is a false document.
  const status = getTransactionStatusLabel(data.status, t);
  const voided = Boolean(data.isDeleted);
  const upper = (data.status || "").toUpperCase();
  const pending = !voided && upper === "PENDING";
  const rejected = !voided && upper === "REJECTED";

  const signatures: DocSignature[] = [
    { label: t("documents.receivedBy", { defaultValue: "Received By" }), name: data.memberName },
    { label: t("documents.preparedBy", { defaultValue: "Prepared By" }), name: data.handlingOfficer },
    { label: t("documents.approvedBy", { defaultValue: "Approved By" }), name: data.authorizerName },
  ];

  return (
    <DocumentFrame
      orgName={orgName}
      orgTagline={orgTagline}
      docType={title}
      reference={ledgerRef(data, "") || undefined}
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
      <DocTitle>{data.projectName || title}</DocTitle>
      <DocAmount
        label={t("deposits.columns.amount", { defaultValue: "Amount" })}
        words={amountInWords(data.amount, currency)}
        wordsLabel={t("documents.amountInWords", { defaultValue: "In words" })}
      >
        <span style={voided || rejected ? { textDecoration: "line-through" } : undefined}>
          {formatMoney(Number(data.amount || 0))}
        </span>
      </DocAmount>

      <DocRow label={t("documents.type", { defaultValue: "Type" })} value={type} strong />
      <DocRow
        label={t("documents.member", { defaultValue: "Member" })}
        value={data.memberName ? `${data.memberName}${data.memberCode ? ` (${data.memberCode})` : ""}` : na}
      />
      <DocRow label={t("documents.project", { defaultValue: "Project" })} value={data.projectName || na} />
      {data.fundName ? <DocRow label={t("deposits.columns.fund", { defaultValue: "Fund" })} value={data.fundName} /> : null}
      <DocRow label={t("common.status", { defaultValue: "Status" })} value={status} />
      {data.balanceBefore != null && data.balanceBefore !== "" ? (
        <DocRow
          label={t("documents.openingBalance", { defaultValue: "Fund balance before" })}
          value={formatMoney(Number(data.balanceBefore))}
        />
      ) : null}
      {data.balanceAfter != null && data.balanceAfter !== "" ? (
        <DocRow
          label={t("reports.summary.closingBalance", { defaultValue: "Closing Balance" })}
          value={formatMoney(Number(data.balanceAfter))}
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
      {data.createdAt ? (
        <DocRow label={t("documents.recordedOn", { defaultValue: "Recorded on" })} value={formatDateTime(data.createdAt, true)} />
      ) : null}
      {data.authorizerName ? (
        <DocRow label={t("expenses.approvedBy", { defaultValue: "Approved By" })} value={data.authorizerName} />
      ) : null}
      {voided && data.deletionReason ? (
        <DocField label={t("transactions.deleted.reason", { defaultValue: "Deletion Reason" })}>{data.deletionReason}</DocField>
      ) : null}
      {data.description ? (
        <DocField label={t("documents.remarks", { defaultValue: "Remarks" })}>
          {translateLedgerDescription(data.description, t)}
        </DocField>
      ) : null}
    </DocumentFrame>
  );
}
