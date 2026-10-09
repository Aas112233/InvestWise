"use client";

/**
 * #32 — In-app report viewer.
 *
 * Renders the EXACT document the exporters consume: `GET /api/reports/generate/
 * [type]?format=json` returns the assembled `ReportDocument` (localized header,
 * columns, rows, summary, totals). No second query path exists — a row you see
 * here is a row you would get in the .xlsx.
 */
import React from "react";
import Link from "next/link";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui";
import { useLocale } from "@/lib/i18n";
import { apiClient } from "@/lib/api-client";
import type { ReportFormat, ReportPeriodType } from "@/lib/reports/catalog";

export interface ReportDocumentPayload {
  slug: string;
  title: string;
  locale: string;
  currency: string;
  dateFormat: string;
  letterhead: {
    name: string;
    tagline?: string | null;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  periodLine: string;
  generatedAt: string;
  generatedBy: string;
  generatedByLabel: string;
  summary: Array<{ label: string; value: string }>;
  columns: Array<{ key: string; label: string; type: string; total?: boolean }>;
  rows: Record<string, string | number | null>[];
  totalsLabel: string;
  truncated: boolean;
  truncatedNote: string;
  footerNote: string;
  fileBase: string;
}

export interface ReportViewerProps {
  slug: string;
  /** Query params (period + entity scope) forwarded verbatim to the API. */
  query: Record<string, string>;
  /** Formats offered as downloads from the viewer toolbar. */
  downloadFormats?: ReportFormat[];
  onDownload?: (format: ReportFormat) => Promise<void> | void;
}

export function ReportViewer({ slug, query, downloadFormats = ["xlsx", "pdf", "csv"], onDownload }: ReportViewerProps) {
  const { t, locale } = useLocale();

  const search = new URLSearchParams({ ...query, format: "json", locale });
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ReportDocumentPayload>({
    queryKey: ["report-viewer", slug, search.toString()],
    queryFn: async () => {
      const res = await apiClient<{ success: boolean; data: ReportDocumentPayload }>(
        `/reports/generate/${encodeURIComponent(slug)}?${search.toString()}`,
      );
      return res.data;
    },
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <div className="p-10 text-center text-xs text-muted-foreground" role="status">
        {t("reports.viewer.loading", { defaultValue: "Loading report..." })}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 space-y-3">
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-lg">
          {(error as Error)?.message || t("reports.viewer.loadError", { defaultValue: "Failed to load report." })}
        </div>
        <Button variant="outline" size="sm" icon={RefreshCw} onClick={() => refetch()}>
          {t("reports.viewer.retry", { defaultValue: "Retry" })}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("reports.viewer.back", { defaultValue: "Back to Reports" })}
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={() => refetch()}
            loading={isFetching}
          >
            {t("reports.viewer.refresh", { defaultValue: "Refresh" })}
          </Button>
          {onDownload &&
            downloadFormats.map((f) => (
              <Button
                key={f}
                variant="outline"
                size="sm"
                icon={Download}
                onClick={() => onDownload(f)}
              >
                {f.toUpperCase()}
              </Button>
            ))}
        </div>
      </div>

      {/* Document sheet */}
      <div className="bg-card border border-border/80 rounded-xl shadow-sm overflow-hidden">
        {/* Letterhead */}
        <div className="p-6 border-b border-border/80 space-y-1">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-lg font-bold text-foreground">{data.letterhead.name}</h1>
              {data.letterhead.tagline && (
                <p className="text-xs text-muted-foreground">{data.letterhead.tagline}</p>
              )}
              {data.letterhead.address && (
                <p className="text-[11px] text-muted-foreground mt-1">{data.letterhead.address}</p>
              )}
              {(data.letterhead.email || data.letterhead.phone) && (
                <p className="text-[11px] text-muted-foreground">
                  {[data.letterhead.email, data.letterhead.phone].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <div className="text-right">
              <h2 className="text-sm font-bold text-foreground">{data.title}</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">{data.periodLine}</p>
              <p className="text-[11px] text-muted-foreground">
                {data.generatedByLabel}: {data.generatedBy}
              </p>
              <p className="text-[11px] text-muted-foreground">{data.generatedAt}</p>
            </div>
          </div>
        </div>

        {/* Summary strip */}
        {data.summary.length > 0 && (
          <div className="p-4 bg-slate-50/60 dark:bg-slate-900/40 border-b border-border/80 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.summary.map((entry, idx) => (
              <div key={`${entry.label}-${idx}`} className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                  {entry.label}
                </p>
                <p className="text-sm font-semibold text-foreground tabular-nums truncate">
                  {entry.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {data.truncated && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px]" role="alert">
            {data.truncatedNote}
          </div>
        )}

        {/* Ledger table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800">
                {data.columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap ${
                      col.type === "money" || col.type === "number" ? "text-right" : "text-left"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(data.columns.length, 1)}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    {t("reports.viewer.empty", { defaultValue: "No records for this period." })}
                  </td>
                </tr>
              ) : (
                data.rows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    className="border-b border-border/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    {data.columns.map((col) => {
                      const value = row[col.key];
                      const isNumeric = col.type === "money" || col.type === "number";
                      return (
                        <td
                          key={col.key}
                          className={`px-3 py-2 ${isNumeric ? "text-right tabular-nums" : "text-left"} ${
                            col.type === "money" ? "font-medium text-foreground" : "text-foreground/90"
                          }`}
                        >
                          {value === null || value === undefined || value === "" ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            String(value)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
            {data.rows.length > 0 && data.columns.some((c) => c.total) && (
              <tfoot>
                <tr className="bg-slate-100 dark:bg-slate-800 font-bold">
                  {data.columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 ${col.type === "money" || col.type === "number" ? "text-right tabular-nums" : "text-left"}`}
                    >
                      {col.total ? totalForColumn(data.rows, col.key, col.type) : ""}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td colSpan={Math.max(data.columns.length, 1)} className="px-3 py-1 text-[10px] text-muted-foreground">
                    {data.totalsLabel}: {data.rows.length}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="px-4 py-3 border-t border-border/80 text-[10px] text-muted-foreground">
          {data.footerNote}
        </div>
      </div>
    </div>
  );
}

/**
 * Totals row: money columns are summed from the already-formatted strings via
 * integer cents (the document stores decimal strings, never floats), number
 * columns are summed directly. Mirrors the exporter totals row.
 */
export function totalForColumn(
  rows: Record<string, string | number | null>[],
  key: string,
  type: string,
): string {
  if (type === "money") {
    let cents = 0;
    for (const row of rows) {
      const raw = row[key];
      if (raw === null || raw === undefined || raw === "") continue;
      cents += Math.round(Number(raw) * 100);
    }
    return (cents / 100).toFixed(2);
  }
  if (type === "number") {
    let sum = 0;
    for (const row of rows) {
      const raw = row[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) sum += parsed;
    }
    return String(sum);
  }
  return "";
}
