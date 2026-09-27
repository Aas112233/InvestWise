"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { AnalysisView } from "@/components/analysis";
import { apiClient } from "@/lib/api-client";
import { AnalysisData, Member } from "@/types";

export default function AnalysisPage() {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMemberId, setSelectedMemberId] = useState<string>("all");

  // TanStack Query v5 - Hierarchical noun-first keys (AGENTS.md §7)
  const {
    data: analysisData = null,
    isLoading: analysisLoading,
    refetch,
  } = useQuery<AnalysisData>({
    queryKey: ["analytics", "analysis", { year: selectedYear, memberId: selectedMemberId }],
    queryFn: async () => {
      const params = new URLSearchParams({
        year: String(selectedYear),
        memberId: selectedMemberId,
      });
      return await apiClient<AnalysisData>(`/analytics/analysis?${params.toString()}`);
    },
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
        isLoading={analysisLoading}
        selectedYear={selectedYear}
        selectedMemberId={selectedMemberId}
        onYearChange={setSelectedYear}
        onMemberChange={setSelectedMemberId}
        onRefresh={() => refetch()}
      />
    </AppShell>
  );
}
