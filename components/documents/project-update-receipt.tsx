"use client";

import React from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDateOnly, useFormatMoney } from "@/lib/use-tenant-settings";
import { translateLedgerDescription } from "@/lib/ledger-description";
import { DocumentFrame, DocTitle, DocAmount, DocRow, DocField, type DocSignature } from "./document-frame";

export interface ProjectUpdateReceiptData {
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
}

/** Project update receipt — opened after a project spending/earning is posted. */
export function ProjectUpdateReceipt({ data, orgName, orgTagline }: { data: ProjectUpdateReceiptData; orgName?: string; orgTagline?: string }) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  const formatDate = useFormatDateOnly();
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
  const status = t("projects.statuses.completed", { defaultValue: "Completed" });

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
      reference={data.referenceNumber}
      dateLabel={data.date ? formatDate(data.date) : undefined}
      signatures={signatures}
    >
      <DocTitle>{data.projectName || title}</DocTitle>
      <DocAmount label={t("deposits.columns.amount", { defaultValue: "Amount" })}>
        {formatMoney(Number(data.amount || 0))}
      </DocAmount>

      <DocRow label={t("documents.type", { defaultValue: "Type" })} value={type} strong />
      <DocRow
        label={t("documents.member", { defaultValue: "Member" })}
        value={data.memberName ? `${data.memberName}${data.memberCode ? ` (${data.memberCode})` : ""}` : na}
      />
      <DocRow label={t("documents.project", { defaultValue: "Project" })} value={data.projectName || na} />
      <DocRow label={t("common.status", { defaultValue: "Status" })} value={status} />
      <DocRow label={t("deposits.modal.cashier", { defaultValue: "Handled By" })} value={data.handlingOfficer || na} />
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
