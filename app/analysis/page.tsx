"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { AnalysisView } from "@/components/analysis";
import { apiClient } from "@/lib/api-client";
import { AnalysisData, Member } from "@/types";
import { useTenantSettings } from "@/lib/use-tenant-settings";
import { useFiscalPeriodYears } from "@/lib/fiscal-period-options";
import { fiscalStartYearForDate } from "@/lib/fiscal-periods";

export default function AnalysisPage() {
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("all");
  const { data: tenantSettings, isLoading: settingsLoading } = useTenantSettings();
  const fiscalStartMonth = tenantSettings?.financial?.fiscalYearStart || "July";
  const fiscalEndMonth = tenantSettings?.financial?.fiscalYearEnd || "June";
  const currentFiscalStartYear = fiscalStartYearForDate(new Date(), fiscalStartMonth);
  // Analysis is a read screen, so it opens on the year actually open for
  // posting rather than the date-derived one; the picker marks the same year.
  const { openFiscalYear } = useFiscalPeriodYears();
  const activeFiscalYear = selectedFiscalYear ?? Number(openFiscalYear ?? currentFiscalStartYear);

  // TanStack Query v5 - Hierarchical noun-first keys (AGENTS.md §7)
  const {
    data: analysisData = null,
    isLoading: analysisLoading,
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

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["members"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: Member[] } | Member[]>("/members");
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
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
      />
    </AppShell>
  );
}
