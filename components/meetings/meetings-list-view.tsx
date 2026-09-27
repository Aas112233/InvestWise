"use client";

import React, { useState, useMemo } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Play,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Search,
  Eye,
  Trash2,
  CheckCircle,
} from "lucide-react";
import { Meeting } from "@/types";
import {
  ERPDataTable,
  ERPColumn,
  ERPMetricCard,
  StatusBadge,
  Button,
  AppDropdown,
  DropdownOption,
  StatusTone,
} from "@/components/ui";
import { formatDate } from "@/lib/formatters";
import { useLocale } from "@/lib/i18n";

interface MeetingsListViewProps {
  meetings: Meeting[];
  isLoading: boolean;
  onOpenCreate: () => void;
  onOpenLiveRoom: (meeting: Meeting) => void;
  onOpenDetail: (meeting: Meeting) => void;
  onDeleteMeeting?: (id: string) => void;
}

export function MeetingsListView({
  meetings,
  isLoading,
  onOpenCreate,
  onOpenLiveRoom,
  onOpenDetail,
  onDeleteMeeting,
}: MeetingsListViewProps) {
  const { t } = useLocale();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Compute Metrics
  const metrics = useMemo(() => {
    let scheduled = 0;
    let inProgress = 0;
    let completed = 0;

    meetings.forEach((m) => {
      if (m.status === "SCHEDULED") scheduled++;
      else if (m.status === "IN_PROGRESS") inProgress++;
      else if (m.status === "COMPLETED") completed++;
    });

    return { scheduled, inProgress, completed, total: meetings.length };
  }, [meetings]);

  // Filtered dataset
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      const matchSearch =
        !searchQuery ||
        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.location && m.location.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (m.agenda && m.agenda.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchStatus =
        selectedStatus === "ALL" || m.status === selectedStatus;

      const matchType =
        selectedType === "ALL" || m.meetingType === selectedType;

      return matchSearch && matchStatus && matchType;
    });
  }, [meetings, searchQuery, selectedStatus, selectedType]);

  const mapStatusTone = (status: string): StatusTone => {
    switch (status) {
      case "COMPLETED":
        return "emerald";
      case "IN_PROGRESS":
        return "cyan";
      case "SCHEDULED":
        return "amber";
      case "CANCELLED":
        return "rose";
      default:
        return "slate";
    }
  };

  const columns: ERPColumn<Meeting>[] = [
    {
      key: "title",
      header: t("meetings.columns.meeting", { defaultValue: "MEETING & TYPE" }),
      sortable: true,
      render: (m) => (
        <div className="flex flex-col py-1">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {m.title}
          </span>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {m.meetingType?.replace(/_/g, " ")}
          </span>
        </div>
      ),
    },
    {
      key: "meetingDate",
      header: t("meetings.columns.dateSchedule", { defaultValue: "SCHEDULE" }),
      sortable: true,
      render: (m) => (
        <div className="flex flex-col text-xs text-slate-600 dark:text-slate-400 font-mono">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3 text-slate-400" />
            {formatDate(m.meetingDate, true)}
          </span>
          {m.location && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <MapPin className="w-3 h-3" />
              {m.location}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "attendees",
      header: t("meetings.columns.attendance", { defaultValue: "ATTENDANCE" }),
      render: (m) => {
        const total = m.stats?.total || m.totalAttendees || m.attendees?.length || 0;
        const present = m.stats?.present || m.presentCount || 0;
        const rate = total > 0 ? Math.round((present / total) * 100) : 0;

        return (
          <div className="flex flex-col text-xs">
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {present} / {total} {t("meetings.present", { defaultValue: "present" })}
            </span>
            {total > 0 && (
              <span className="text-[11px] text-slate-400 font-mono">
                {rate}% {t("meetings.turnout", { defaultValue: "turnout" })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      header: t("meetings.columns.status", { defaultValue: "STATUS" }),
      render: (m) => (
        <StatusBadge tone={mapStatusTone(m.status)} label={m.status} />
      ),
    },
    {
      key: "actions",
      header: t("common.actions", { defaultValue: "ACTIONS" }),
      align: "right",
      render: (m) => (
        <div className="flex items-center justify-end gap-1.5">
          {m.status === "SCHEDULED" || m.status === "IN_PROGRESS" ? (
            <Button
              variant="primary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLiveRoom(m);
              }}
              icon={Play}
            >
              {m.status === "IN_PROGRESS"
                ? t("meetings.resume", { defaultValue: "Live Room" })
                : t("meetings.start", { defaultValue: "Start" })}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(m);
              }}
              icon={Eye}
            >
              {t("common.details", { defaultValue: "Details" })}
            </Button>
          )}

          {onDeleteMeeting && (
            <Button
              variant="destructive"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(t("meetings.confirmDelete", { defaultValue: "Delete this meeting?" }))) {
                  onDeleteMeeting(m.id);
                }
              }}
              icon={Trash2}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ERPMetricCard
          label={t("meetings.metrics.totalMeetings", { defaultValue: "Total Meetings" })}
          value={metrics.total}
          icon={Calendar}
          tone="slate"
        />
        <ERPMetricCard
          label={t("meetings.metrics.inProgress", { defaultValue: "Live In Progress" })}
          value={metrics.inProgress}
          icon={Play}
          tone="cyan"
        />
        <ERPMetricCard
          label={t("meetings.metrics.scheduled", { defaultValue: "Scheduled" })}
          value={metrics.scheduled}
          icon={Clock}
          tone="amber"
        />
        <ERPMetricCard
          label={t("meetings.metrics.completed", { defaultValue: "Completed" })}
          value={metrics.completed}
          icon={CheckCircle2}
          tone="emerald"
        />
      </div>

      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-card border border-border/80 rounded-xl shadow-sm">
        <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("meetings.searchPlaceholder", { defaultValue: "Search meetings..." })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-card border border-border/80 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="w-36">
            <AppDropdown
              options={[
                { value: "ALL", label: t("common.allStatuses", { defaultValue: "All Statuses" }) },
                { value: "SCHEDULED", label: t("meetings.statuses.scheduled", { defaultValue: "Scheduled" }) },
                { value: "IN_PROGRESS", label: t("meetings.statuses.inProgress", { defaultValue: "In Progress" }) },
                { value: "COMPLETED", label: t("meetings.statuses.completed", { defaultValue: "Completed" }) },
                { value: "CANCELLED", label: t("meetings.statuses.cancelled", { defaultValue: "Cancelled" }) },
              ]}
              value={selectedStatus}
              onChange={(val) => setSelectedStatus(val || "ALL")}
              clearable={false}
            />
          </div>

          <div className="w-44">
            <AppDropdown
              options={[
                { value: "ALL", label: t("meetings.allTypes", { defaultValue: "All Types" }) },
                { value: "FOUNDING_MEMBER", label: t("meetings.types.foundingMember", { defaultValue: "Founding Member" }) },
                { value: "SHAREHOLDER", label: t("meetings.types.shareholder", { defaultValue: "Shareholder" }) },
                { value: "INVESTOR", label: t("meetings.types.investor", { defaultValue: "Investor" }) },
                { value: "GENERAL", label: t("meetings.types.general", { defaultValue: "General" }) },
              ]}
              value={selectedType}
              onChange={(val) => setSelectedType(val || "ALL")}
              clearable={false}
            />
          </div>
        </div>

        <Button variant="primary" size="sm" onClick={onOpenCreate} icon={Plus}>
          {t("meetings.scheduleButton", { defaultValue: "Schedule Meeting" })}
        </Button>
      </div>

      {/* Main ERP Data Table */}
      <ERPDataTable
        data={filteredMeetings}
        columns={columns}
        isLoading={isLoading}
        page={currentPage}
        pageSize={pageSize}
        totalCount={filteredMeetings.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        emptyMessage={t("meetings.noMeetingsFound", { defaultValue: "No meetings found." })}
        emptyActionLabel={t("meetings.scheduleButton", { defaultValue: "Schedule Meeting" })}
        onEmptyAction={onOpenCreate}
      />
    </div>
  );
}
