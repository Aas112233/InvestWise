"use client";

import React from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDateOnly, useFormatMoney, useTenantCurrency } from "@/lib/use-tenant-settings";
import { getCategoryLabel } from "@/lib/transaction-labels";
import { amountInWords } from "@/lib/amount-in-words";
import {
  DocumentFrame,
  DocBanner,
  DocTitle,
  DocAmount,
  DocRow,
  DocField,
  DocTable,
  DocSectionLabel,
  type DocSignature,
} from "./document-frame";

export interface ProjectCharterParticipant {
  memberName?: string;
  memberCode?: string;
  sharesInvested?: number;
  totalInvested?: number;
  ownershipPercentage?: number | string | null;
  /** The deposit fund this shareholder's capital was actually drawn from. */
  sourceFundName?: string | null;
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
  expectedRoi?: number | string | null;
  totalShares?: number;
  status?: string;
  startDate?: string;
  completionDate?: string;
  linkedFundName?: string;
  /** What is left in the project fund at the time the sheet was printed. */
  linkedFundBalance?: number | string;
  projectFundHandler?: string | null;
  /** One-way flag set by a settle-and-close run — a closed project must not print as if it were live. */
  isLocked?: boolean;
  tenantShareValue?: number | string;
  involvedMembers?: ProjectCharterParticipant[];
}

/** Project charter — opened after a project is created. */
export function ProjectCharter({ data, orgName, orgTagline }: { data: ProjectCharterData; orgName?: string; orgTagline?: string }) {
  const { t } = useLocale();
  const formatMoney = useFormatMoney();
  // Words must name the same currency as the figures — see lib/amount-in-words.ts.
  const currency = useTenantCurrency();
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
  const categoryLabel = getCategoryLabel(data.category, t) || data.category;
  const totalCapital = Number(data.totalCapital ?? data.initialInvestment ?? data.budget ?? 0);
  const anySourceFunds = members.some((m) => m.sourceFundName);

  const signatures: DocSignature[] = [
    { label: t("documents.preparedBy", { defaultValue: "Prepared By" }), name: data.projectFundHandler || undefined },
    { label: t("documents.approvedBy", { defaultValue: "Approved By" }) },
  ];

  return (
    <DocumentFrame orgName={orgName} orgTagline={orgTagline} docType={title} reference={data.id} dateLabel={data.startDate ? formatDate(data.startDate) : undefined} signatures={signatures}>
      {/* is_locked is one-way, so a charter reprinted after settlement looked
          identical to one printed at inception — the moment a stakeholder most
          needs the difference visible. */}
      {data.isLocked ? (
        <DocBanner
          label={t("documents.lockedBanner", { defaultValue: "Settled and permanently locked" })}
          detail={data.completionDate
            ? `${t("documents.completedOn", { defaultValue: "Completed" })}: ${formatDate(data.completionDate)}`
            : undefined}
        />
      ) : null}

      <DocTitle>{data.title || na}</DocTitle>
      {categoryLabel ? (
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          {t("documents.category", { defaultValue: "Category" })}: {categoryLabel}
        </div>
      ) : null}

      <DocAmount
        label={t("documents.totalCapital", { defaultValue: "Total Capital" })}
        words={amountInWords(totalCapital, currency)}
        wordsLabel={t("documents.amountInWords", { defaultValue: "In words" })}
      >
        {formatMoney(totalCapital)}
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
              ...(anySourceFunds ? [t("documents.drawnFrom", { defaultValue: "Capital drawn from" })] : []),
            ]}
            rows={members.map((m) => [
              m.memberName ? `${m.memberName}${m.memberCode ? ` (${m.memberCode})` : ""}` : na,
              m.sharesInvested ?? 0,
              formatMoney(Number(m.totalInvested || 0)),
              `${Number(m.ownershipPercentage ?? 0)}%`,
              ...(anySourceFunds ? [m.sourceFundName || na] : []),
            ])}
          />
        </>
      ) : null}

      <div style={{ marginTop: "6mm" }}>
        <DocRow label={t("documents.startDate", { defaultValue: "Start Date" })} value={data.startDate ? formatDate(data.startDate) : na} />
        <DocRow label={t("documents.completionDate", { defaultValue: "Completion Date" })} value={data.completionDate ? formatDate(data.completionDate) : na} />
        <DocRow label={t("deposits.columns.fund", { defaultValue: "Fund" })} value={data.linkedFundName || na} />
        {data.linkedFundBalance != null ? (
          <DocRow
            label={t("documents.projectFundBalance", { defaultValue: "Project fund balance" })}
            value={formatMoney(Number(data.linkedFundBalance))}
          />
        ) : null}
        {data.totalShares ? (
          <DocRow label={t("documents.totalShares", { defaultValue: "Total shares" })} value={data.totalShares} />
        ) : null}
        {data.expectedRoi != null ? (
          <DocRow label={t("documents.expectedRoi", { defaultValue: "Expected ROI" })} value={`${Number(data.expectedRoi)}%`} />
        ) : null}
        {data.tenantShareValue != null ? (
          <DocRow label={t("projects.shareValue", { defaultValue: "UNIT SHARE VALUE" })} value={formatMoney(Number(data.tenantShareValue))} />
        ) : null}
        <DocRow label={t("common.status", { defaultValue: "Status" })} value={status} strong />
        {data.isLocked ? (
          <DocRow label={t("documents.lockState", { defaultValue: "Record state" })} value={t("documents.locked", { defaultValue: "LOCKED — immutable" })} strong />
        ) : null}
      </div>
    </DocumentFrame>
  );
}
