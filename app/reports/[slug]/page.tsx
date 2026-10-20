"use client";

/**
 * #32 — Dedicated in-app report page.
 *
 * `/reports/comprehensive-ledger?periodType=Monthly&fiscalMonth=2026-10&...`
 * renders the same assembled document the exports contain. Query params carry
 * the period + entity scope so a viewer URL is shareable/bookmarkable.
 */
import React, { Suspense, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { ReportViewer } from "@/components/reports";
import { getReportDefinition, type ReportFormat, type ReportLocale } from "@/lib/reports/catalog";
import { useLocale } from "@/lib/i18n";

const DOWNLOAD_FORMATS: ReportFormat[] = ["xlsx", "pdf", "csv"];
const DOCUMENT_LOCALES: ReportLocale[] = ["en", "ur", "hi", "bn"];

// C16: useSearchParams opts this route out of prerendering; Next requires a
// Suspense boundary around it or the whole /reports/* shell suspends.
function SuspenseFallback() {
  const { t } = useLocale();
  return (
    <div className="p-10 text-center text-xs text-muted-foreground" role="status">
      {t("reports.viewer.loading", { defaultValue: "Loading report..." })}
    </div>
  );
}

export default function ReportViewerPage() {
  return (
    <Suspense fallback={<SuspenseFallback />}>
      <ReportViewerContent />
    </Suspense>
  );
}

function ReportViewerContent() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const { t, locale } = useLocale();

  const slug = decodeURIComponent(String(params?.slug ?? ""));
  const definition = useMemo(() => getReportDefinition(slug), [slug]);

  // Forward every query param except the transport format (period + scope +
  // the sender's document locale — C9: a shared URL renders in the locale it
  // was generated for, matching the download).
  const query = useMemo(() => {
    const out: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== "format") out[key] = value;
    });
    return out;
  }, [searchParams]);

  const docLocale: ReportLocale = DOCUMENT_LOCALES.includes(query.locale as ReportLocale)
    ? (query.locale as ReportLocale)
    : (locale as ReportLocale);

  const handleDownload = useCallback(
    async (format: ReportFormat) => {
      const qs = new URLSearchParams({ ...query, format, locale: docLocale }).toString();
      let res: Response;
      try {
        res = await fetch(`/api/reports/generate/${encodeURIComponent(slug)}?${qs}`, {
          credentials: "include",
        });
      } catch {
        // C8: a network failure is a toast, not an unhandled rejection.
        toast.error(t("reports.errors.generateFailed", { defaultValue: "Failed to generate the report. Please try again." }));
        return;
      }
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
    [query, docLocale, slug, t],
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
