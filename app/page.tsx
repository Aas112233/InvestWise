"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { apiClient } from "@/lib/api-client";
import { AnalyticsStats, Project, Member, Transaction } from "@/types";

export default function DashboardPage() {
  const router = useRouter();

  // TanStack Query v5 - Hierarchical noun-first keys (AGENTS.md §7)
  const { data: statsData, isLoading: statsLoading } = useQuery<AnalyticsStats>({
    queryKey: ["analytics", "stats"],
    queryFn: async () => {
      try {
        return await apiClient<AnalyticsStats>("/analytics/stats");
      } catch {
        // API unreachable — render an honest empty state (zeros), never a
        // fabricated demo snapshot (AGENTS.md §0/§12).
        return {
          totalAssets: 0,
          totalMembers: 0,
          activeMembers: 0,
          activeProjects: 0,
          ongoingBudget: 0,
          totalDividendsDistributed: 0,
          monthlyGrowthRate: null,
          totalDeposits: 0,
          depositCount: 0,
          totalExpenses: 0,
          netReserveBalance: 0,
          totalShares: 0,
          foundingShares: 0,
          normalShares: 0,
          foundingMembers: 0,
          normalMembers: 0,
          investmentsTotal: 0,
          investmentsCount: 0,
          monthlyDeposits: [],
          ongoingProjectFinance: [],
          fundsHealth: { reserves: 0, monthlyBurn: 0, runwayMonths: null, status: "Good" },
        };
      }
    },
    staleTime: 60_000,
  });

  const { data: projectsData = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: Project[] } | Project[]>("/projects");
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const { data: membersData = [] } = useQuery<Member[]>({
    queryKey: ["members"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: Member[] } | Member[]>("/members");
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const { data: transactionsRes } = useQuery<{ data: Transaction[] }>({
    queryKey: ["transactions", { limit: 5 }],
    queryFn: async () => {
      try {
        return await apiClient<{ data: Transaction[] }>("/transactions?limit=5");
      } catch {
        return { data: [] };
      }
    },
    staleTime: 60_000,
  });

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Executive Dashboard View */}
        <DashboardView
          stats={statsData || null}
          projects={projectsData}
          members={membersData}
          recentTransactions={transactionsRes?.data || []}
          isLoading={statsLoading}
          onNavigate={(path) => router.push(path)}
        />
      </div>
    </AppShell>
  );
}
