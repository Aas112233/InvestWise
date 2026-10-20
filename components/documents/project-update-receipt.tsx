"use client";

import React from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDate, useFormatDateOnly, useFormatMoney } from "@/lib/use-tenant-settings";
import { translateLedgerDescription } from "@/lib/ledger-description";
import { getTransactionStatusLabel } from "@/lib/transaction-labels";
import { DocumentFrame, DocTitle, DocAmount, DocRow, DocField, DocVoidStamp, type DocSignature } from "./document-frame";

export interface ProjectUpdateReceiptData {
  id?: string;
  referenceNumber?: string;
  date?: string;
  amount?: number | string;
  type?: string;
  projectName?: string;
  memberName?: string;
  memberCode?: string;
  status?: string;
  handlingOfficer?: string;
  authorizerName?: string;
  description?: string;
  createdAt?: string;
  isDeleted?: boolean;
  deletedAt?: string | null;
}

/** Project update receipt — opened after a project spending/earning is posted. */
export function ProjectUpdateReceipt({ data, orgName, orgTagline }: { data: ProjectUpdateReceiptData; orgName?: string; orgTagline?: string }) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
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
      reference={data.referenceNumber || data.id}
      dateLabel={data.date ? formatDate(data.date) : undefined}
      signatures={signatures}
    >
      {data.isDeleted ? (
        <DocVoidStamp
          label={t("documents.voidStamp", { defaultValue: "Voided entry" })}
          dateLabel={data.deletedAt ? formatDateTime(data.deletedAt, true) : undefined}
        />
      ) : null}
      <DocTitle>{data.projectName || title}</DocTitle>
      <DocAmount label={t("deposits.columns.amount", { defaultValue: "Amount" })}>
        <span style={data.isDeleted ? { textDecoration: "line-through" } : undefined}>{formatMoney(Number(data.amount || 0))}</span>
      </DocAmount>

      <DocRow label={t("documents.type", { defaultValue: "Type" })} value={type} strong />
      <DocRow
        label={t("documents.member", { defaultValue: "Member" })}
        value={data.memberName ? `${data.memberName}${data.memberCode ? ` (${data.memberCode})` : ""}` : na}
      />
      <DocRow label={t("documents.project", { defaultValue: "Project" })} value={data.projectName || na} />
      <DocRow label={t("common.status", { defaultValue: "Status" })} value={status} />
      <DocRow label={t("deposits.modal.cashier", { defaultValue: "Handled By" })} value={data.handlingOfficer || na} />
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
    </DocumentFrame>
  );
}
