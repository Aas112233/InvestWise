"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { AnalysisView } from "@/components/analysis";
import { apiClient } from "@/lib/api-client";
import { AnalysisData, Member } from "@/types";
import { useTenantSettings } from "@/lib/use-tenant-settings";
import { useFiscalPeriodYears } from "@/lib/fiscal-period-options";
import { useFiscalYear, useFiscalYearSync } from "@/lib/fiscal-year-context";
import { fiscalStartYearForDate, isFiscalMonthName } from "@/lib/fiscal-periods";

export default function AnalysisPage() {
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("all");
  const { data: tenantSettings, isLoading: settingsLoading } = useTenantSettings();
  // Guard a legacy settings row holding a malformed month name: it must
  // degrade to the platform default, not crash the page's render.
  const rawStart = tenantSettings?.financial?.fiscalYearStart;
  const rawEnd = tenantSettings?.financial?.fiscalYearEnd;
  const fiscalStartMonth = isFiscalMonthName(rawStart) ? rawStart : "July";
  const fiscalEndMonth = isFiscalMonthName(rawEnd) ? rawEnd : "June";
  const currentFiscalStartYear = fiscalStartYearForDate(new Date(), fiscalStartMonth);
  // The header's fiscal-year selector is the app-wide period. A local pick wins
  // only until the header moves: the sync below clears it, so the header always
  // has the last word (Analysis is a read screen — it follows, it never leads).
  const { fiscalYear: headerFiscalYear } = useFiscalYear();
  const clearLocalYear = React.useCallback(() => setSelectedFiscalYear(null), []);
  useFiscalYearSync(clearLocalYear);
  const { openFiscalYear } = useFiscalPeriodYears();
  const activeFiscalYear =
    selectedFiscalYear ?? Number(headerFiscalYear ?? openFiscalYear ?? currentFiscalStartYear);

  // TanStack Query v5 - Hierarchical noun-first keys (AGENTS.md §7)
  const {
    data: analysisData = null,
    isLoading: analysisLoading,
    isError: analysisFailed,
    error: analysisError,
    refetch,
  } = useQuery<AnalysisData>({
    queryKey: ["analytics", "analysis", { year: activeFiscalYear, memberId: selectedMemberId }],
    queryFn: async () => {
      const params = new URLSearchParams({
        year: String(activeFiscalYear),
        memberId: selectedMemberId,
      });
      return await apiClient<AnalysisData>(`/analytics/analysis?${params.toString()}`);
    },
    enabled: !settingsLoading,
    staleTime: 60_000,
  });

  // A failed load must reach the view as an error state (with retry) — never
  // as a null `data` that renders as a false "no data" screen.
  const {
    data: members = [],
    isError: membersFailed,
    error: membersError,
    refetch: refetchMembers,
  } = useQuery<Member[]>({
    queryKey: ["members"],
    queryFn: async () => {
      const res = await apiClient<{ data: Member[] } | Member[]>("/members");
      return Array.isArray(res) ? res : res?.data || [];
    },
    staleTime: 120_000,
  });

  return (
    <AppShell>
      <AnalysisView
        data={analysisData}
        members={members}
        isLoading={settingsLoading || analysisLoading}
        selectedYear={activeFiscalYear}
        fiscalStartMonth={fiscalStartMonth}
        fiscalEndMonth={fiscalEndMonth}
        selectedMemberId={selectedMemberId}
        onYearChange={setSelectedFiscalYear}
        onMemberChange={setSelectedMemberId}
        onRefresh={() => refetch()}
        error={analysisFailed ? (analysisError as Error)?.message || "Request failed" : null}
        onRetry={() => refetch()}
        membersError={membersFailed ? (membersError as Error)?.message || "Request failed" : null}
        onMembersRetry={() => refetchMembers()}
      />
    </AppShell>
  );
}
