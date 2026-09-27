"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { ReportsView } from "@/components/reports";
import { apiClient } from "@/lib/api-client";
import { Project, Member } from "@/types";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

export default function ReportsPage() {
  const { t } = useLocale();

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

  const handleGenerateReport = async (params: {
    reportType: string;
    format: "Excel" | "PDF" | "CSV";
    periodType: "Monthly" | "Quarterly" | "Yearly" | "Custom";
    fiscalMonth?: string;
    fiscalQuarter?: string;
    fiscalYear?: string;
    startDate?: string;
    endDate?: string;
    projectId?: string;
    memberId?: string;
    fundId?: string;
  }) => {
    try {
      toast.info(t("reports.generatingNotice", { defaultValue: "Synthesizing report document..." }));

      const queryParams: Record<string, string> = {
        format: params.format.toLowerCase(),
        periodType: params.periodType,
      };

      if (params.fiscalMonth) queryParams.fiscalMonth = params.fiscalMonth;
      if (params.fiscalYear) queryParams.fiscalYear = params.fiscalYear;
      if (params.fiscalQuarter) queryParams.fiscalQuarter = params.fiscalQuarter;
      if (params.startDate) queryParams.startDate = params.startDate;
      if (params.endDate) queryParams.endDate = params.endDate;
      if (params.projectId) queryParams.projectId = params.projectId;
      if (params.memberId) queryParams.memberId = params.memberId;
      if (params.fundId) queryParams.fundId = params.fundId;

      const queryString = new URLSearchParams(queryParams).toString();
      const endpoint = `/reports/generate/${encodeURIComponent(params.reportType)}?${queryString}`;

      const res = await fetch(endpoint.startsWith("http") ? endpoint : `/api${endpoint}`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Report generation failed: ${res.statusText}`);
      }

      const blob = await res.blob();
      const extension = params.format === "Excel" ? "xlsx" : params.format === "PDF" ? "pdf" : "csv";
      const fileName = `${params.reportType.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.${extension}`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t("reports.downloadSuccess", { defaultValue: "Document downloaded successfully" }));
    } catch (err: any) {
      toast.error(err?.message || t("common.errors.failedToGenerateReport", { defaultValue: "Failed to generate report document" }));
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <ReportsView
          projects={projects}
          members={members}
          funds={funds}
          onGenerateReport={handleGenerateReport}
        />
      </div>
    </AppShell>
  );
}
