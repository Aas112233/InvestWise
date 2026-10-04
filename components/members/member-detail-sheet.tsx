"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Mail, Pencil, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { TopSheet } from "@/components/ui/top-sheet";
import { apiClient } from "@/lib/api-client";
import { formatDatePattern, formatMoney } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";
import { useTenantCurrency, useTenantDateFormat } from "@/lib/use-tenant-settings";
import type { Member } from "@/types";

interface MemberDeposit {
  id: string;
  amount: number | string;
  description: string;
  referenceNumber?: string | null;
  date: string;
  status?: string | null;
  depositMethod?: string | null;
}

interface MemberDetail extends Member {
  deposits?: MemberDeposit[];
}

function statusTone(status: string): StatusTone {
  const s = (status || "").toLowerCase();
  if (s === "active") return "emerald";
  if (s === "pending") return "amber";
  if (s === "suspended") return "rose";
  return "slate";
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function depositTotal(m: MemberDetail): number {
  return Number(m.totalDeposits ?? m.totalContributed ?? 0) || 0;
}

// The detail endpoint returns the stored row, so this figure is member EQUITY
// (deposits plus reinvested dividends). It is labeled as such rather than
// "Total Contributed", which the directory derives from deposits alone.

// Full member profile drawer: identity, share certificates summary, deposit
// history and warning record. Read-only; edits go through the form modal.
export function MemberDetailSheet({
  memberId,
  onClose,
  onEdit,
  onDivide,
}: {
  memberId: string | null;
  onClose: () => void;
  onEdit: (m: Member) => void;
  /** Present only for roles allowed to move equity; renders the divide action. */
  onDivide?: (m: Member) => void;
}) {
  const { t } = useLocale();

  const currency = useTenantCurrency();
  const dateFormat = useTenantDateFormat();

  const detailQuery = useQuery({
    queryKey: ["members", memberId],
    queryFn: () => apiClient<{ success: boolean; data: MemberDetail }>(`/members/${memberId}`),
    enabled: memberId !== null,
  });

  const member = detailQuery.data?.data;

  return (
    <TopSheet
      open={memberId !== null}
      onClose={onClose}
      title={member ? member.name : t("members.detail.profile")}
      subtitle={member ? member.memberId : undefined}
      footer={
        member ? (
          <div className="flex items-center gap-2">
            {onDivide && (
              <Button
                variant="outline"
                size="sm"
                icon={<ArrowLeftRight size={13} />}
                onClick={() => onDivide(member)}
              >
                {t("dividends.migrationEngine")}
              </Button>
            )}
            <Button variant="primary" size="sm" icon={<Pencil size={13} />} onClick={() => onEdit(member)}>
              {t("members.rowMenu.edit")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {detailQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton width="100%" height="4rem" />
          <Skeleton width="100%" height="6rem" />
          <Skeleton width="100%" height="8rem" />
        </div>
      ) : !member ? (
        <p className="text-sm text-slate-500 text-center py-8">{t("members.errors.loadFailed")}</p>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <span className="w-14 h-14 rounded-full bg-blue-600/10 text-blue-700 dark:text-blue-400 text-lg font-bold flex items-center justify-center shrink-0">
              {initials(member.name)}
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold text-slate-900 dark:text-white truncate">{member.name}</p>
              <p className="text-xs font-mono text-slate-500">{member.memberId}</p>
              <div className="mt-1.5">
                <StatusBadge tone={statusTone(member.status)}>
                  {t(`members.statusLabels.${member.status.toLowerCase()}`, { defaultValue: member.status })}
                </StatusBadge>
              </div>
            </div>
          </div>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              {t("members.detail.contactTitle")}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <Mail size={13} className="text-slate-400 shrink-0" />
                {member.email || "—"}
              </p>
              <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <Phone size={13} className="text-slate-400 shrink-0" />
                {member.phone || "—"}
              </p>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("members.detail.sharesTitle")}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-border/80 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("members.detail.shares")}</p>
                <p className="text-lg font-semibold font-mono mt-0.5">{member.shares}</p>
              </div>
              <div className="p-3 rounded-lg border border-border/80 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("members.equity")}</p>
                <p className="text-lg font-semibold font-mono mt-0.5">{formatMoney(depositTotal(member), currency)}</p>
              </div>
              <div className="p-3 rounded-lg border border-border/80 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("members.detail.joinDate")}</p>
                <p className="text-lg font-semibold font-mono mt-0.5">
                  {formatDatePattern(member.joinDate ?? member.createdAt, dateFormat)}
                </p>
              </div>
              <div className="p-3 rounded-lg border border-border/80 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("members.detail.performance")}</p>
                <p className="text-lg font-semibold font-mono mt-0.5">{member.performanceScore ?? "—"}</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("members.detail.deposits")}
            </h3>
            {!member.deposits || member.deposits.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border/80 rounded-lg">
                {t("members.detail.depositsEmpty")}
              </p>
            ) : (
              <div className="rounded-lg border border-border/80 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="text-left px-3 py-2 font-semibold">{t("members.detail.date")}</th>
                      <th className="text-left px-3 py-2 font-semibold">{t("members.detail.contributed")}</th>
                      <th className="text-right px-3 py-2 font-semibold">{t("members.columns.status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {member.deposits.map((d) => (
                      <tr key={d.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {formatDatePattern(d.date, dateFormat)}
                          {d.referenceNumber && (
                            <span className="block text-[10px] text-muted-foreground">{d.referenceNumber}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono font-medium text-foreground">{formatMoney(d.amount, currency)}</td>
                        <td className="px-3 py-2 text-right">
                          <StatusBadge tone="emerald">{d.status || t("members.statusLabels.completed")}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("members.detail.warnings")}
            </h3>
            {(member.warningCount ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/80 rounded-lg">
                {t("members.detail.warningsEmpty")}
              </p>
            ) : (
              <StatusBadge tone="amber">{member.warningCount}</StatusBadge>
            )}
          </section>
        </div>
      )}
    </TopSheet>
  );
}
