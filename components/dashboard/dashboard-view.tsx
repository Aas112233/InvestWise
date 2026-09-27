"use client";

import React from "react";
import {
  Award,
  Calendar,
  Plus,
  Receipt,
  Layers,
  Users,
  Download,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsStats, Project, Member, Transaction } from "@/types";

interface DashboardViewProps {
  stats: AnalyticsStats | null;
  projects: Project[];
  members: Member[];
  recentTransactions?: Transaction[];
  isLoading: boolean;
  onNavigate: (route: string) => void;
}

export function DashboardView({
  stats,
  projects,
  members,
  recentTransactions = [],
  isLoading,
  onNavigate,
}: DashboardViewProps) {
  const { t } = useLocale();

  // Real figures only — no fabricated baselines (AGENTS.md §0/§12).
  const totalAssets = stats?.totalAssets ?? 0;
  const totalDeposits = stats?.totalDeposits ?? 0;
  const totalExpenses = stats?.totalExpenses ?? 0;
  const dividends = stats?.totalDividendsDistributed ?? 0;
  const netReserves = stats?.netReserveBalance ?? 0;
  const totalMembers = stats?.totalMembers ?? members.length;
  const activeProjects = stats?.activeProjects ?? projects.length;
  const monthlyGrowth = stats?.monthlyGrowthRate ?? 0;

  // Tenant default display format is DD/MM/YYYY (AGENTS.md §8).
  const today = new Date().toLocaleDateString("en-GB");

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-44 rounded-lg" />
            <Skeleton className="h-4 w-28 rounded-md" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
        </div>

        {/* 4 Cards Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 bg-card border border-border/80 rounded-xl space-y-3">
              <Skeleton className="h-4 w-24 rounded" />
              <div className="flex justify-between items-baseline">
                <Skeleton className="h-8 w-20 rounded" />
                <Skeleton className="h-4 w-12 rounded" />
              </div>
              <Skeleton className="h-1 w-full rounded-full" />
              <div className="space-y-1 pt-1">
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-3 w-3/4 rounded" />
              </div>
              <Skeleton className="h-3 w-16 rounded pt-2" />
            </div>
          ))}
        </div>

        {/* Lower Grid Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 p-5 bg-card border border-border/80 rounded-xl min-h-[300px]">
            <Skeleton className="h-5 w-40 rounded mb-4" />
            <div className="h-48 flex items-center justify-center">
              <Skeleton className="h-24 w-48 rounded-xl" />
            </div>
          </div>
          <div className="lg:col-span-4 p-5 bg-card border border-border/80 rounded-xl min-h-[300px] space-y-4">
            <Skeleton className="h-5 w-28 rounded" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Subheader / Action Bar ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("nav.dashboard", { defaultValue: "Dashboard" })}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{today}</p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate("/meetings")}
            className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3.5 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors shadow-2xs"
          >
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{t("dashboard.meetings", { defaultValue: "Meetings" })}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/members")}
            className="flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground px-3.5 py-2 text-xs font-medium transition-colors shadow-2xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t("dashboard.addMember", { defaultValue: "Add Member" })}</span>
          </button>
        </div>
      </div>

      {/* ── The 4 KPI Cards (Stat Cards) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Assets */}
        <div className="p-4 bg-card border border-border/80 rounded-xl shadow-2xs flex flex-col justify-between hover:border-border transition-all">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {t("dashboard.totalAssets", { defaultValue: "Total Assets" })}
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {formatMoney(totalAssets)}
              </span>
            </div>
            <div
              className="w-full h-1 rounded-full my-3"
              style={{ background: "var(--metric-cyan)" }}
            />
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("dashboard.monthlyGrowth", { defaultValue: "Monthly growth" })}
                </span>
                <span className="font-medium text-foreground">{monthlyGrowth}%</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => onNavigate("/analysis")}
              className="text-xs font-medium text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              <span>{t("dashboard.analysisLink", { defaultValue: "Analysis" })}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Card 2: Total Deposits */}
        <div className="p-4 bg-card border border-border/80 rounded-xl shadow-2xs flex flex-col justify-between hover:border-border transition-all">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {t("dashboard.totalDeposits", { defaultValue: "Total Deposits" })}
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {formatMoney(totalDeposits)}
              </span>
            </div>
            <div
              className="w-full h-1 rounded-full my-3"
              style={{ background: "var(--metric-emerald)" }}
            />
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("dashboard.expenses", { defaultValue: "Expenses" })}
                </span>
                <span className="font-medium text-foreground">{formatMoney(totalExpenses)}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => onNavigate("/deposits")}
              className="text-xs font-medium text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              <span>{t("dashboard.depositsLink", { defaultValue: "Deposits" })}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Card 3: Dividends Distributed */}
        <div className="p-4 bg-card border border-border/80 rounded-xl shadow-2xs flex flex-col justify-between hover:border-border transition-all">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {t("dashboard.dividendsDistributed", { defaultValue: "Dividends Distributed" })}
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {formatMoney(dividends)}
              </span>
            </div>
            <div
              className="w-full h-1 rounded-full my-3"
              style={{ background: "var(--metric-amber)" }}
            />
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("dashboard.netReserves", { defaultValue: "Net Reserves" })}
                </span>
                <span className="font-medium text-foreground">{formatMoney(netReserves)}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => onNavigate("/dividends")}
              className="text-xs font-medium text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              <span>{t("dashboard.dividendsLink", { defaultValue: "Dividends" })}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Card 4: Active Members */}
        <div className="p-4 bg-card border border-border/80 rounded-xl shadow-2xs flex flex-col justify-between hover:border-border transition-all">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              {t("dashboard.activeMembers", { defaultValue: "Active Members" })}
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {totalMembers}
              </span>
            </div>
            <div
              className="w-full h-1 rounded-full my-3"
              style={{ background: "var(--metric-indigo)" }}
            />
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t("dashboard.activeProjects", { defaultValue: "Active Projects" })}
                </span>
                <span className="font-medium text-foreground">{activeProjects}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => onNavigate("/members")}
              className="text-xs font-medium text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
            >
              <span>{t("dashboard.membersLink", { defaultValue: "Members" })}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Lower Two-Column Section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Card: Recent transactions */}
        <div className="lg:col-span-8 bg-card border border-border/80 rounded-xl shadow-2xs flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="p-4 px-5 flex items-center justify-between border-b border-border/60">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  {t("dashboard.recentTransactions", { defaultValue: "Recent transactions" })}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("/transactions")}
                className="text-xs font-medium text-muted-foreground hover:text-primary flex items-center gap-0.5 transition-colors"
              >
                <span>{t("dashboard.fullLedger", { defaultValue: "Full Ledger" })}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Content Area */}
            {recentTransactions.length === 0 ? (
              <div className="min-h-[200px] flex flex-col items-center justify-center p-8 text-center">
                <div className="h-12 w-12 rounded-xl border border-dashed border-border/90 bg-muted/40 flex items-center justify-center text-muted-foreground mb-3">
                  <Receipt className="h-6 w-6 stroke-[1.5]" />
                </div>
                <p className="text-xs text-muted-foreground font-medium mb-3">
                  {t("dashboard.noTransactions", { defaultValue: "No transactions recorded yet." })}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate("/deposits")}
                  className="rounded-lg border border-border/80 bg-card px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors shadow-2xs"
                >
                  {t("dashboard.newDeposit", { defaultValue: "New Deposit" })}
                </button>
              </div>
            ) : (
              <div className="p-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-muted-foreground text-left">
                        <th className="py-2 px-3 font-medium">
                          {t("dashboard.thDate", { defaultValue: "Date" })}
                        </th>
                        <th className="py-2 px-3 font-medium">
                          {t("dashboard.thReference", { defaultValue: "Reference" })}
                        </th>
                        <th className="py-2 px-3 font-medium">
                          {t("dashboard.thMember", { defaultValue: "Member" })}
                        </th>
                        <th className="py-2 px-3 font-medium">
                          {t("dashboard.thType", { defaultValue: "Type" })}
                        </th>
                        <th className="py-2 px-3 font-medium text-right">
                          {t("dashboard.thAmount", { defaultValue: "Amount" })}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {recentTransactions.slice(0, 5).map((txn) => (
                        <tr key={txn.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2 px-3 text-muted-foreground">
                            {new Date(txn.date).toLocaleDateString("en-GB")}
                          </td>
                          <td className="py-2 px-3 font-medium text-foreground">
                            {txn.referenceNumber || txn.id.slice(0, 8)}
                          </td>
                          <td className="py-2 px-3 text-foreground">
                            {txn.memberName || "—"}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{txn.type}</td>
                          <td className="py-2 px-3 text-right font-semibold text-foreground">
                            {formatMoney(txn.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Footer Bar */}
          <div className="border-t border-border/60 p-3 px-5 flex items-center justify-end text-xs text-muted-foreground bg-muted/15 rounded-b-xl">
            <span className="font-medium text-foreground">
              {t("dashboard.totalDeposits", { defaultValue: "Total Deposits" })}:{" "}
              {formatMoney(totalDeposits)}
            </span>
          </div>
        </div>

        {/* Right Card: Quick links */}
        <div className="lg:col-span-4 bg-card border border-border/80 rounded-xl shadow-2xs flex flex-col justify-between p-5">
          <div>
            {/* Header */}
            <div className="flex items-center gap-2 pb-3 border-b border-border/60">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                {t("dashboard.quickLinks", { defaultValue: "Quick links" })}
              </h2>
            </div>

            {/* List of 4 action cards */}
            <div className="space-y-2 py-3">
              {/* Link 1: New deposit */}
              <div
                onClick={() => onNavigate("/deposits")}
                className="p-2.5 rounded-xl border border-transparent hover:border-border/60 hover:bg-muted/40 transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    <Plus className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-foreground truncate">
                      {t("dashboard.quickNewDeposit", { defaultValue: "New deposit" })}
                    </h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {t("dashboard.quickNewDepositDesc", { defaultValue: "Record a member deposit" })}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
              </div>

              {/* Link 2: Members */}
              <div
                onClick={() => onNavigate("/members")}
                className="p-2.5 rounded-xl border border-transparent hover:border-border/60 hover:bg-muted/40 transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-foreground truncate">
                      {t("dashboard.quickMembers", { defaultValue: "Members" })}
                    </h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {t("dashboard.quickMembersDesc", { defaultValue: "Manage shareholder records" })}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
              </div>

              {/* Link 3: Projects */}
              <div
                onClick={() => onNavigate("/projects")}
                className="p-2.5 rounded-xl border border-transparent hover:border-border/60 hover:bg-muted/40 transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-foreground truncate">
                      {t("dashboard.quickProjects", { defaultValue: "Projects" })}
                    </h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {t("dashboard.quickProjectsDesc", { defaultValue: "Track fund allocations" })}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
              </div>

              {/* Link 4: Dividends */}
              <div
                onClick={() => onNavigate("/dividends")}
                className="p-2.5 rounded-xl border border-transparent hover:border-border/60 hover:bg-muted/40 transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    <Award className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-foreground truncate">
                      {t("dashboard.quickDividends", { defaultValue: "Dividends" })}
                    </h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {t("dashboard.quickDividendsDesc", { defaultValue: "Shareholder distributions" })}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
              </div>
            </div>
          </div>

          {/* Bottom Button */}
          <div className="pt-3 border-t border-border/60 text-center">
            <button
              type="button"
              onClick={() => onNavigate("/reports")}
              className="w-full text-xs font-medium text-foreground hover:text-primary flex items-center justify-center gap-1.5 transition-colors py-1"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{t("dashboard.downloadReports", { defaultValue: "Download Reports" })}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
