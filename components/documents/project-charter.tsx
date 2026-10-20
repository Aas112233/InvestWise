"use client";

import React from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDateOnly, useFormatMoney } from "@/lib/use-tenant-settings";
import { DocumentFrame, DocTitle, DocAmount, DocRow, DocField, DocTable, DocSectionLabel, type DocSignature } from "./document-frame";

export interface ProjectCharterParticipant {
  memberName?: string;
  memberCode?: string;
  sharesInvested?: number;
  totalInvested?: number;
  ownershipPercentage?: number | string | null;
}

export interface ProjectCharterData {
  id?: string;
  title?: string;
  category?: string;
  description?: string;
  /** Invested shareholder capital (projects.initialInvestment); budget is the fallback for projects created without shareholders yet. */
  totalCapital?: number | string;
  initialInvestment?: number | string;
  budget?: number | string;
  status?: string;
  startDate?: string;
  completionDate?: string;
  linkedFundName?: string;
  tenantShareValue?: number | string;
  involvedMembers?: ProjectCharterParticipant[];
}

/** Project charter — opened after a project is created. */
export function ProjectCharter({ data, orgName, orgTagline }: { data: ProjectCharterData; orgName?: string; orgTagline?: string }) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  const formatDate = useFormatDateOnly();
  const na = t("common.na", { defaultValue: "—" });

  const title = t("documents.projectCharter", { defaultValue: "Project Charter" });
  const members = (data.involvedMembers || []).filter((m) => m && (m.memberName || m.totalInvested || m.sharesInvested));
  // DB lifecycle values are English — map through the app's status labels.
  const status = (() => {
    const u = (data.status || "").toUpperCase().replace(/\s+/g, "_");
    const key =
      u === "IN_PROGRESS" ? "projects.statuses.inProgress"
      : u === "COMPLETED" ? "projects.statuses.completed"
      : u === "REVIEW" ? "projects.statuses.review"
      : u === "CANCELLED" ? "projects.statuses.cancelled"
      : u === "ON_HOLD" ? "projects.statuses.onHold"
      : null;
    return key ? t(key, { defaultValue: data.status || na }) : data.status || na;
  })();

  const signatures: DocSignature[] = [
    { label: t("documents.preparedBy", { defaultValue: "Prepared By" }) },
    { label: t("documents.approvedBy", { defaultValue: "Approved By" }) },
  ];

  return (
    <DocumentFrame orgName={orgName} orgTagline={orgTagline} docType={title} reference={data.id} dateLabel={data.startDate ? formatDate(data.startDate) : undefined} signatures={signatures}>
      <DocTitle>{data.title || na}</DocTitle>
      {data.category ? (
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          {t("documents.category", { defaultValue: "Category" })}: {data.category}
        </div>
      ) : null}

      <DocAmount label={t("documents.totalCapital", { defaultValue: "Total Capital" })}>
        {formatMoney(Number(data.totalCapital ?? data.initialInvestment ?? data.budget ?? 0))}
      </DocAmount>

      {data.description ? (
        <DocField label={t("documents.description", { defaultValue: "Description" })}>{data.description}</DocField>
      ) : null}

      {members.length > 0 ? (
        <>
          <DocSectionLabel>{t("documents.participants", { defaultValue: "Participants" })}</DocSectionLabel>
          <DocTable
            headers={[
              t("documents.member", { defaultValue: "Member" }),
              t("documents.shares", { defaultValue: "Shares" }),
              t("documents.invested", { defaultValue: "Invested" }),
              t("projects.shareholders.ownership", { defaultValue: "Ownership %" }),
            ]}
            rows={members.map((m) => [
              m.memberName ? `${m.memberName}${m.memberCode ? ` (${m.memberCode})` : ""}` : na,
              m.sharesInvested ?? 0,
              formatMoney(Number(m.totalInvested || 0)),
              `${Number(m.ownershipPercentage ?? 0)}%`,
            ])}
          />
        </>
      ) : null}

      <div style={{ marginTop: "6mm" }}>
        <DocRow label={t("documents.startDate", { defaultValue: "Start Date" })} value={data.startDate ? formatDate(data.startDate) : na} />
        <DocRow label={t("documents.completionDate", { defaultValue: "Completion Date" })} value={data.completionDate ? formatDate(data.completionDate) : na} />
        <DocRow label={t("deposits.columns.fund", { defaultValue: "Fund" })} value={data.linkedFundName || na} />
        {data.tenantShareValue != null ? (
          <DocRow label={t("projects.shareValue", { defaultValue: "UNIT SHARE VALUE" })} value={formatMoney(Number(data.tenantShareValue))} />
        ) : null}
        <DocRow label={t("common.status", { defaultValue: "Status" })} value={status} strong />
      </div>
    </DocumentFrame>
  );
}
