"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import {
  MeetingsListView,
  MeetingFormModal,
  MeetingAttendanceModal,
} from "@/components/meetings";
import { apiClient } from "@/lib/api-client";
import { Meeting, Member } from "@/types";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

export default function MeetingsPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  // TanStack Query v5 - Query key: ["meetings"]
  const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
    queryKey: ["meetings"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: Meeting[] } | Meeting[]>("/meetings");
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
  const createMutation = useMutation({
    mutationFn: async (newMeeting: Partial<Meeting>) => {
      return await apiClient("/meetings", {
        method: "POST",
        body: JSON.stringify(newMeeting),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success(t("meetings.scheduledSuccess", { defaultValue: "Meeting scheduled successfully" }));
      setIsCreateOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToScheduleMeeting", { defaultValue: "Failed to schedule meeting" }));
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: async ({
      meetingId,
      records,
    }: {
      meetingId: string;
      records: Array<{ memberId: string; attendanceStatus: string; notes?: string }>;
    }) => {
      return await apiClient(`/meetings/${meetingId}/attendance`, {
        method: "POST",
        body: JSON.stringify({ records }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success(t("meetings.attendanceSaved", { defaultValue: "Attendance records updated" }));
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToRecordAttendance", { defaultValue: "Failed to record attendance" }));
    },
  });

  const completeMutation = useMutation({
    mutationFn: async ({
      meetingId,
      notes,
    }: {
      meetingId: string;
      notes?: string;
    }) => {
      return await apiClient(`/meetings/${meetingId}/complete`, {
        method: "POST",
        body: JSON.stringify({ notes }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["governance"] });
      toast.success(t("meetings.completedSuccess", { defaultValue: "Meeting finalized and penalties evaluated" }));
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToFinalizeMeeting", { defaultValue: "Failed to finalize meeting" }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (meetingId: string) => {
      return await apiClient(`/meetings/${meetingId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success(t("meetings.deletedSuccess", { defaultValue: "Meeting removed" }));
    },
    onError: (err: any) => {
      toast.error(err?.message || t("common.errors.failedToDeleteMeeting", { defaultValue: "Failed to delete meeting" }));
    },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <MeetingsListView
          meetings={meetings}
          isLoading={isLoading}
          onOpenCreate={() => setIsCreateOpen(true)}
          onOpenLiveRoom={(m) => {
            setSelectedMeeting(m);
            setIsAttendanceOpen(true);
          }}
          onOpenDetail={(m) => {
            setSelectedMeeting(m);
            setIsAttendanceOpen(true);
          }}
          onDeleteMeeting={(id) => deleteMutation.mutate(id)}
        />

        {/* Schedule Meeting Modal */}
        <MeetingFormModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={async (data) => {
            await createMutation.mutateAsync(data);
          }}
        />

        {/* Live Room & Attendance Modal */}
        <MeetingAttendanceModal
          isOpen={isAttendanceOpen}
          onClose={() => {
            setIsAttendanceOpen(false);
            setSelectedMeeting(null);
          }}
          meeting={selectedMeeting}
          members={members}
          onSaveAttendance={async (id, records) => {
            await attendanceMutation.mutateAsync({ meetingId: id, records });
          }}
          onCompleteMeeting={async (id, notes) => {
            await completeMutation.mutateAsync({ meetingId: id, notes });
          }}
        />
      </div>
    </AppShell>
  );
}
