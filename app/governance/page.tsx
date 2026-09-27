"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import {
  GovernanceView,
  WaivePenaltyModal,
  IssuePenaltyModal,
} from "@/components/governance";
import { apiClient } from "@/lib/api-client";
import { LeaderboardEntry, MemberPenalty, Member } from "@/types";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

export default function GovernancePage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [waiveTargetPenalty, setWaiveTargetPenalty] = useState<MemberPenalty | null>(null);

  // TanStack Query v5 - Keys: ["governance", "leaderboard"], ["governance", "penalties"]
  const { data: leaderboard = [], isLoading: isLeaderboardLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["governance", "leaderboard"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: LeaderboardEntry[] } | LeaderboardEntry[]>("/governance/leaderboard");
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
    },
  });

  const { data: penalties = [], isLoading: isPenaltiesLoading } = useQuery<MemberPenalty[]>({
    queryKey: ["governance", "penalties"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: MemberPenalty[] } | MemberPenalty[]>("/governance/penalties");
        return Array.isArray(res) ? res : res?.data || [];
      } catch {
        return [];
      }
    },
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
  });

  // Mutations
  const issueMutation = useMutation({
    mutationFn: async (payload: {
      memberId: string;
      tier: 1 | 2 | 3 | 4;
      title: string;
      type: "VERBAL_WARNING" | "FUND_DEDUCTION" | "SUSPENSION";
      deductionAmount?: number;
      reason: string;
    }) => {
      return await apiClient("/governance/penalties", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["governance"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success(t("governance.issuedSuccess", { defaultValue: "Penalty issued and recorded" }));
      setIsIssueOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToIssuePenalty", { defaultValue: "Failed to issue penalty" }));
    },
  });

  const waiveMutation = useMutation({
    mutationFn: async ({
      penaltyId,
      waiveReason,
    }: {
      penaltyId: string;
      waiveReason: string;
    }) => {
      return await apiClient(`/governance/penalties/${penaltyId}/waive`, {
        method: "POST",
        body: JSON.stringify({ waiveReason }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["governance"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success(t("governance.waivedSuccess", { defaultValue: "Penalty waived with audit record" }));
      setWaiveTargetPenalty(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToWaivePenalty", { defaultValue: "Failed to waive penalty" }));
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      return await apiClient("/governance/performance/recalculate-all", {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["governance"] });
      toast.success(t("governance.recalculatedSuccess", { defaultValue: "Performance scores recalculated" }));
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToRecalculatePerformance", { defaultValue: "Failed to recalculate performance scores" }));
    },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <GovernanceView
          leaderboard={leaderboard}
          penalties={penalties}
          members={members}
          isLoading={isLeaderboardLoading || isPenaltiesLoading}
          onOpenIssuePenalty={() => setIsIssueOpen(true)}
          onOpenWaivePenalty={(p) => setWaiveTargetPenalty(p)}
          onRecalculateScores={async () => {
            await recalculateMutation.mutateAsync();
          }}
        />

        {/* Issue Penalty Modal */}
        <IssuePenaltyModal
          isOpen={isIssueOpen}
          onClose={() => setIsIssueOpen(false)}
          members={members}
          onIssuePenalty={async (payload) => {
            await issueMutation.mutateAsync(payload);
          }}
        />

        {/* Waive Penalty Modal */}
        <WaivePenaltyModal
          isOpen={!!waiveTargetPenalty}
          onClose={() => setWaiveTargetPenalty(null)}
          penalty={waiveTargetPenalty}
          onWaive={async (id, reason) => {
            await waiveMutation.mutateAsync({ penaltyId: id, waiveReason: reason });
          }}
        />
      </div>
    </AppShell>
  );
}
