"use client";

/**
 * #32 — Dedicated in-app report page.
 *
 * `/reports/comprehensive-ledger?periodType=Monthly&fiscalMonth=2026-10&...`
 * renders the same assembled document the exports contain. Query params carry
 * the period + entity scope so a viewer URL is shareable/bookmarkable.
 */
import React, { useMemo, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { ReportViewer } from "@/components/reports";
import { getReportDefinition, type ReportFormat } from "@/lib/reports/catalog";
import { useLocale } from "@/lib/i18n";

const DOWNLOAD_FORMATS: ReportFormat[] = ["xlsx", "pdf", "csv"];

export default function ReportViewerPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const { t, locale } = useLocale();

  const slug = decodeURIComponent(String(params?.slug ?? ""));
  const definition = useMemo(() => getReportDefinition(slug), [slug]);

  // Forward every non-format query param to the API (period + scope).
  const query = useMemo(() => {
    const out: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== "format" && key !== "locale") out[key] = value;
    });
    return out;
  }, [searchParams]);

  const handleDownload = useCallback(
    async (format: ReportFormat) => {
      const qs = new URLSearchParams({ ...query, format, locale }).toString();
      const res = await fetch(`/api/reports/generate/${encodeURIComponent(slug)}?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        let message = `Report generation failed: ${res.statusText}`;
        try {
          const body = await res.json();
          if (body?.message) message = body.message;
        } catch {
          // Non-JSON error body — keep the status-text fallback.
        }
        toast.error(message);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const fileName = match?.[1] ?? `${slug}_${new Date().toISOString().slice(0, 10)}.${format}`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success(t("reports.downloadSuccess", { defaultValue: "Document downloaded successfully" }));
    },
    [query, locale, slug, t],
  );

  if (!definition) {
    return (
      <AppShell>
        <div className="p-6 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-lg">
          {t("reports.viewer.unknownReport", {
            defaultValue: "Unknown report type.",
          })}{" "}
          <span className="font-mono">{slug}</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ReportViewer
        slug={slug}
        query={query}
        downloadFormats={DOWNLOAD_FORMATS}
        onDownload={handleDownload}
      />
    </AppShell>
  );
}
