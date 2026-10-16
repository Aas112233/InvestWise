"use client";

import React from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDateOnly, useFormatMoney } from "@/lib/use-tenant-settings";
import { translateLedgerDescription } from "@/lib/ledger-description";
import { DocumentFrame, DocTitle, DocAmount, DocRow, DocField, type DocSignature } from "./document-frame";

export interface DepositReceiptData {
  referenceNumber?: string;
  date?: string;
  amount?: number | string;
  memberName?: string;
  memberCode?: string;
  fundName?: string;
  depositMethod?: string;
  status?: string;
  handlingOfficer?: string;
  authorizerName?: string;
  description?: string;
}

/** Deposit receipt — opened after a deposit is approved. */
export function DepositReceipt({ data, orgName, orgTagline }: { data: DepositReceiptData; orgName?: string; orgTagline?: string }) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  const formatDate = useFormatDateOnly();
  const na = t("common.na", { defaultValue: "—" });

  const title = t("deposits.receiptTitle", { defaultValue: "Deposit Receipt" });
  // The DB stores English status values; render them through the same labels
  // the deposits screen uses so the document follows the app language.
  const status = (() => {
    const u = (data.status || "").toUpperCase();
    if (u === "PENDING") return t("deposits.statusPending", { defaultValue: "Pending" });
    if (u === "REJECTED") return t("deposits.statusRejected", { defaultValue: "Rejected" });
    return t("deposits.statusVerified", { defaultValue: "Verified" });
  })();

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
      <DocTitle>{title}</DocTitle>
      <DocAmount label={t("deposits.columns.amount", { defaultValue: "Amount" })}>
        {formatMoney(Number(data.amount || 0))}
      </DocAmount>

      <DocRow
        label={t("deposits.columns.member", { defaultValue: "Member" })}
        value={data.memberName ? `${data.memberName}${data.memberCode ? ` (${data.memberCode})` : ""}` : na}
      />
      <DocRow label={t("deposits.columns.fund", { defaultValue: "Fund" })} value={data.fundName || na} />
      <DocRow label={t("deposits.columns.method", { defaultValue: "Method" })} value={data.depositMethod || na} />
      <DocRow label={t("common.status", { defaultValue: "Status" })} value={status} strong />
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
