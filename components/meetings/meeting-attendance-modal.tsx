"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  UserCheck,
  UserX,
  AlertTriangle,
  Play,
  Save,
} from "lucide-react";
import { TopSheet, Button, StatusBadge } from "@/components/ui";
import { Meeting, MeetingAttendee, Member } from "@/types";
import { useLocale } from "@/lib/i18n";

interface MeetingAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: Meeting | null;
  members: Member[];
  onSaveAttendance: (
    meetingId: string,
    records: Array<{ memberId: string; attendanceStatus: string; notes?: string }>
  ) => Promise<void>;
  onCompleteMeeting: (meetingId: string, notes?: string) => Promise<void>;
}

export function MeetingAttendanceModal({
  isOpen,
  onClose,
  meeting,
  members,
  onSaveAttendance,
  onCompleteMeeting,
}: MeetingAttendanceModalProps) {
  const { t } = useLocale();

  // Initialize attendance records from meeting or list of members
  const [records, setRecords] = useState<
    Record<string, { attendanceStatus: "PRESENT" | "ABSENT" | "EXCUSED"; notes?: string }>
  >(() => {
    const map: Record<string, { attendanceStatus: "PRESENT" | "ABSENT" | "EXCUSED"; notes?: string }> = {};
    if (meeting?.attendees && meeting.attendees.length > 0) {
      meeting.attendees.forEach((a) => {
        map[a.memberId] = {
          attendanceStatus: a.attendanceStatus || "ABSENT",
          notes: a.notes,
        };
      });
    } else {
      members.forEach((m) => {
        map[m.id] = { attendanceStatus: "ABSENT" };
      });
    }
    return map;
  });

  const [meetingNotes, setMeetingNotes] = useState(meeting?.notes || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  if (!meeting) return null;

  const handleStatusChange = (memberId: string, status: "PRESENT" | "ABSENT" | "EXCUSED") => {
    setRecords((prev) => ({
      ...prev,
      [memberId]: {
        ...prev[memberId],
        attendanceStatus: status,
      },
    }));
  };

  const handleNotesChange = (memberId: string, note: string) => {
    setRecords((prev) => ({
      ...prev,
      [memberId]: {
        attendanceStatus: prev[memberId]?.attendanceStatus || "ABSENT",
        notes: note,
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = Object.entries(records).map(([memberId, rec]) => ({
        memberId,
        attendanceStatus: rec.attendanceStatus,
        notes: rec.notes,
      }));
      await onSaveAttendance(meeting.id, payload);
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!confirm(t("meetings.confirmComplete", { defaultValue: "Finalize this meeting and process penalty evaluations?" }))) {
      return;
    }
    setIsCompleting(true);
    try {
      await handleSave();
      await onCompleteMeeting(meeting.id, meetingNotes);
      onClose();
    } finally {
      setIsCompleting(false);
    }
  };

  // Metrics
  const total = members.length;
  let present = 0;
  let absent = 0;
  let excused = 0;

  members.forEach((m) => {
    const s = records[m.id]?.attendanceStatus || "ABSENT";
    if (s === "PRESENT") present++;
    else if (s === "ABSENT") absent++;
    else if (s === "EXCUSED") excused++;
  });

  return (
    <TopSheet
      isOpen={isOpen}
      onClose={onClose}
      title={meeting.title}
      description={`${t("meetings.attendanceRoster", { defaultValue: "Attendance Roster" })} • ${meeting.location || "HQ"}`}
    >
      <div className="space-y-6">
        {/* Attendance Summary Header */}
        <div className="grid grid-cols-4 gap-2 p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-center text-xs">
          <div>
            <span className="text-slate-400 block">{t("meetings.total", { defaultValue: "Total" })}</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{total}</span>
          </div>
          <div>
            <span className="text-emerald-500 block">{t("meetings.present", { defaultValue: "Present" })}</span>
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{present}</span>
          </div>
          <div>
            <span className="text-rose-500 block">{t("meetings.absent", { defaultValue: "Absent" })}</span>
            <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{absent}</span>
          </div>
          <div>
            <span className="text-amber-500 block">{t("meetings.excused", { defaultValue: "Excused" })}</span>
            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{excused}</span>
          </div>
        </div>

        {/* Member Roster List */}
        <div className="border border-border/80 rounded-lg overflow-hidden divide-y divide-border/60">
          {members.map((member) => {
            const currentStatus = records[member.id]?.attendanceStatus || "ABSENT";
            return (
              <div
                key={member.id}
                className="flex items-center justify-between p-3 bg-card hover:bg-muted/40 transition-colors"
              >
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-foreground">
                    {member.name}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    ID: {member.memberId} • Shares: {member.shares}
                  </span>
                </div>

                {/* Status Toggle Buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleStatusChange(member.id, "PRESENT")}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      currentStatus === "PRESENT"
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-emerald-50"
                    }`}
                  >
                    {t("meetings.present", { defaultValue: "Present" })}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleStatusChange(member.id, "EXCUSED")}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      currentStatus === "EXCUSED"
                        ? "bg-amber-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-amber-50"
                    }`}
                  >
                    {t("meetings.excused", { defaultValue: "Excused" })}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleStatusChange(member.id, "ABSENT")}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      currentStatus === "ABSENT"
                        ? "bg-rose-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-rose-50"
                    }`}
                  >
                    {t("meetings.absent", { defaultValue: "Absent" })}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Meeting Minutes / Notes */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
            {t("meetings.meetingMinutes", { defaultValue: "Official Minutes / Discussion Summary" })}
          </label>
          <textarea
            rows={4}
            placeholder={t("meetings.minutesPlaceholder", { defaultValue: "Document resolutions, decisions and key takeaways..." })}
            value={meetingNotes}
            onChange={(e) => setMeetingNotes(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
          <Button variant="outline" size="sm" onClick={handleSave} loading={isSaving} icon={Save}>
            {t("meetings.saveDraft", { defaultValue: "Save Roster" })}
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("common.close", { defaultValue: "Close" })}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleComplete}
              loading={isCompleting}
              icon={CheckCircle2}
            >
              {t("meetings.completeAndEscalate", { defaultValue: "Finalize & Complete Meeting" })}
            </Button>
          </div>
        </div>
      </div>
    </TopSheet>
  );
}
