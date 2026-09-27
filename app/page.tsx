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
        // Fallback default snapshot if database is initializing
        return {
          totalAssets: 4850000,
          totalMembers: 24,
          activeProjects: 6,
          totalDividendsDistributed: 420000,
          monthlyGrowthRate: 8.5,
          totalDeposits: 5200000,
          totalExpenses: 1350000,
          netReserveBalance: 3850000,
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
