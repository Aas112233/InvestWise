"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { ReportsView } from "@/components/reports";
import { apiClient } from "@/lib/api-client";
import { Project, Member } from "@/types";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";
import type { ReportFormat, ReportPeriodType } from "@/lib/reports/catalog";

export default function ReportsPage() {
  const { t, locale } = useLocale();
  const router = useRouter();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: Project[] } | Project[]>("/projects");
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

  const { data: funds = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["funds"],
    queryFn: async () => {
      try {
        const res = await apiClient<{ data: any[] } | any[]>("/funds");
        const list = Array.isArray(res) ? res : res?.data || [];
        return list.map((f: any) => ({ id: f.id, name: f.name }));
      } catch {
        return [];
      }
    },
  });

  const buildQueryParams = (params: {
    format: ReportFormat;
    periodType: ReportPeriodType;
    fiscalMonth?: string;
    fiscalQuarter?: string;
    fiscalYear?: string;
    startDate?: string;
    endDate?: string;
    projectId?: string;
    memberId?: string;
    fundId?: string;
  }): Record<string, string> => {
    const queryParams: Record<string, string> = {
      format: params.format,
      periodType: params.periodType,
      locale,
    };

    if (params.fiscalMonth) queryParams.fiscalMonth = params.fiscalMonth;
    if (params.fiscalYear) queryParams.fiscalYear = params.fiscalYear;
    if (params.fiscalQuarter) queryParams.fiscalQuarter = params.fiscalQuarter;
    if (params.startDate) queryParams.startDate = params.startDate;
    if (params.endDate) queryParams.endDate = params.endDate;
    if (params.projectId) queryParams.projectId = params.projectId;
    if (params.memberId) queryParams.memberId = params.memberId;
    if (params.fundId) queryParams.fundId = params.fundId;

    return queryParams;
  };

  const handleGenerateReport = async (params: {
    reportType: string;
    format: ReportFormat;
    periodType: ReportPeriodType;
    fiscalMonth?: string;
    fiscalQuarter?: string;
    fiscalYear?: string;
    startDate?: string;
    endDate?: string;
    projectId?: string;
    memberId?: string;
    fundId?: string;
  }) => {
    toast.info(t("reports.generatingNotice", { defaultValue: "Synthesizing report document..." }));

    const queryString = new URLSearchParams(buildQueryParams(params)).toString();
    const endpoint = `/reports/generate/${encodeURIComponent(params.reportType)}?${queryString}`;

    const res = await fetch(endpoint.startsWith("http") ? endpoint : `/api${endpoint}`, {
      credentials: "include",
    });

    // Surface the real server error (Rule §11) instead of a masked message.
    if (!res.ok) {
      let message = `Report generation failed: ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.message) message = body.message;
      } catch {
        // Non-JSON error body — keep the status-text fallback.
      }
      throw new Error(message);
    }

    const blob = await res.blob();

    // Prefer the server's localized filename; fall back to slug + date.
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const fileName = match?.[1] ?? `${params.reportType.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.${params.format}`;

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    toast.success(t("reports.downloadSuccess", { defaultValue: "Document downloaded successfully" }));
  };

  // #32 — open the in-app viewer for the same scope the export would use.
  const handleViewReport = (params: {
    reportType: string;
    periodType: ReportPeriodType;
    fiscalMonth?: string;
    fiscalQuarter?: string;
    fiscalYear?: string;
    startDate?: string;
    endDate?: string;
    projectId?: string;
    memberId?: string;
    fundId?: string;
  }) => {
    const { format: _drop, ...rest } = buildQueryParams({ ...params, format: "json" });
    void _drop;
    const qs = new URLSearchParams(rest).toString();
    router.push(`/reports/${encodeURIComponent(params.reportType)}?${qs}`);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <ReportsView
          projects={projects}
          members={members}
          funds={funds}
          onGenerateReport={handleGenerateReport}
          onViewReport={handleViewReport}
        />
      </div>
    </AppShell>
  );
}
