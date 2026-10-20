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
import { formatMoneyNumber, formatUtcDate, totalForColumn } from "@/lib/reports/format";
import type { ReportFormat, ReportLocale } from "@/lib/reports/catalog";

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
  /** Full-set totals for `total` columns — the table is capped, so the
   *  viewer must not re-sum the listed rows when the server provides these. */
  columnTotals?: Record<string, string>;
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

const DOCUMENT_LOCALES: ReportLocale[] = ["en", "ur", "hi", "bn"];

export function ReportViewer({ slug, query, downloadFormats = ["xlsx", "pdf", "csv"], onDownload }: ReportViewerProps) {
  const { t, locale } = useLocale();

  // C9: the document language is the sender's URL locale when it is one of
  // the 4 supported report locales — a bookmarked Urdu report must render
  // Urdu in an English UI (and the download buttons match the view).
  const docLocale: ReportLocale = DOCUMENT_LOCALES.includes(query.locale as ReportLocale)
    ? (query.locale as ReportLocale)
    : (locale as ReportLocale);

  const search = new URLSearchParams({ ...query, format: "json", locale: docLocale });
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
                       // Date columns carry ISO on the wire (the exporters format
                       // them); render them the same way the PDF/Excel do, against
                       // the tenant pattern (§8) — never a raw 2026-10-09T…Z.
                       // C5: money columns carry decimal strings on the wire;
                       // group them like the exporters do instead of showing
                       // a raw `1234567.5`.
                       const shown =
                         col.type === "date"
                           ? formatUtcDate(String(value), data.dateFormat) || String(value)
                           : col.type === "money"
                             ? formatMoneyNumber(value) || String(value)
                             : String(value);
                      return (
                        <td
                          key={col.key}
                          className={`px-3 py-2 align-top ${
                            isNumeric
                              ? "whitespace-nowrap text-right tabular-nums"
                              : col.type === "date"
                                ? "whitespace-nowrap text-left"
                                : "text-left break-words max-w-[220px]"
                          } ${col.type === "money" ? "font-medium text-foreground" : "text-foreground/90"}`}
                        >
                          {value === null || value === undefined || value === "" ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            shown
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
                  {data.columns.map((col) => {
                    // C4: the full-set total wins over a re-sum of the (capped)
                    // listed rows; money totals get grouped like the cells.
                    const rawTotal = col.total
                      ? (data.columnTotals?.[col.key] ?? totalForColumn(data.rows, col.key, col.type)) || ""
                      : "";
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 ${col.type === "money" || col.type === "number" ? "text-right tabular-nums" : "text-left"}`}
                      >
                        {col.total ? (col.type === "money" ? formatMoneyNumber(rawTotal) || rawTotal : rawTotal) : ""}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td colSpan={Math.max(data.columns.length, 1)} className="px-3 py-1 text-[10px] text-muted-foreground">
                    {t("reports.viewer.rowCount", { count: data.rows.length, defaultValue: "{count} rows" })}
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

