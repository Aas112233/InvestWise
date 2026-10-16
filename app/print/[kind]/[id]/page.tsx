"use client";

import React, { use, useEffect, useState } from "react";
import { Printer, X, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { useTenantSettings } from "@/lib/use-tenant-settings";
import { DepositReceipt } from "@/components/documents/deposit-receipt";
import { ProjectCharter } from "@/components/documents/project-charter";
import { ProjectUpdateReceipt } from "@/components/documents/project-update-receipt";

/**
 * Chrome-free printable document window.
 *
 * Opened in a new tab after a transaction succeeds (see lib/documents.ts). It
 * fetches the document's data, renders a single A4 sheet on a neutral backdrop
 * with a Print / Close toolbar, and uses scoped print CSS so only the sheet
 * prints (exact A4, no app chrome).
 */

const PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  html, body { background: #ffffff !important; }
  .doc-backdrop { padding: 0 !important; background: #ffffff !important; }
  .no-print { display: none !important; }
  .doc-sheet-wrap { box-shadow: none !important; }
  #doc-sheet { box-shadow: none !important; margin: 0 !important; width: 210mm !important; min-height: auto !important; }
}
`;

const primaryBtn: React.CSSProperties = {
  border: "1px solid transparent",
  background: "var(--primary, #2563eb)",
  color: "#ffffff",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  border: "1px solid #d1d5db",
  background: "#ffffff",
  color: "#374151",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export default function PrintDocumentPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = use(params);
  const { t } = useLocale();
  const { data: settings } = useTenantSettings();
  const orgName = settings?.organization?.companyName;
  const orgTagline = settings?.organization?.companyTagline;

  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const endpoint = kind === "project" ? `/projects/${id}` : `/transactions/${id}`;
    apiClient<Record<string, unknown>>(endpoint)
      .then((res) => {
        if (!active) return;
        // apiClient returns the raw JSON body; these endpoints wrap the row in
        // { success, data } — unwrap the envelope, otherwise every field the
        // templates read comes back undefined and the sheet renders zeros.
        const payload = (res as { data?: unknown } | null)?.data ?? res;
        setData((payload as Record<string, unknown>) ?? null);
      })
      .catch((e) => {
        if (active) setError(e?.message || "Failed to load document");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, id]);

  const title =
    kind === "deposit"
      ? t("deposits.receiptTitle", { defaultValue: "Deposit Receipt" })
      : kind === "project"
        ? t("documents.projectCharter", { defaultValue: "Project Charter" })
        : t("documents.projectUpdate", { defaultValue: "Project Update" });

  useEffect(() => {
    if (typeof document !== "undefined") document.title = `${title} · InvestWise`;
  }, [title]);

  return (
    <div className="doc-backdrop" style={{ minHeight: "100vh", background: "#eef1f4", padding: "20px 16px 48px" }}>
      {/* Toolbar — hidden when printing */}
      <div
        className="no-print"
        style={{ maxWidth: "210mm", margin: "0 auto 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: 9999, background: "var(--primary, #2563eb)", flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{orgName || "InvestWise"}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={() => window.close()} style={secondaryBtn} className="inline-flex items-center gap-1.5">
            <X size={15} /> {t("documents.close", { defaultValue: "Close" })}
          </button>
          <button type="button" onClick={() => window.print()} style={primaryBtn} className="inline-flex items-center gap-1.5">
            <Printer size={15} /> {t("documents.print", { defaultValue: "Print" })}
          </button>
        </div>
      </div>

      {loading ? (
        <div
          style={{
            maxWidth: "210mm",
            margin: "0 auto",
            height: "297mm",
            background: "#ffffff",
            boxShadow: "0 12px 40px rgba(16,24,40,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#9ca3af", fontSize: 13 }}>
            <Loader2 size={16} className="animate-spin" /> {t("documents.loading", { defaultValue: "Preparing document…" })}
          </span>
        </div>
      ) : error ? (
        <div
          style={{
            maxWidth: "210mm",
            margin: "0 auto",
            padding: 40,
            background: "#ffffff",
            boxShadow: "0 12px 40px rgba(16,24,40,0.08)",
            color: "#6b7280",
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 600, color: "#374151", marginBottom: 6 }}>{t("documents.notFound", { defaultValue: "Document not found" })}</div>
          <div>{error}</div>
        </div>
      ) : (
        <div className="doc-sheet-wrap" style={{ boxShadow: "0 12px 40px rgba(16,24,40,0.10)" }}>
          {kind === "deposit" ? <DepositReceipt data={data as any} orgName={orgName} orgTagline={orgTagline} /> : null}
          {kind === "project" ? <ProjectCharter data={data as any} orgName={orgName} orgTagline={orgTagline} /> : null}
          {kind === "project-update" ? <ProjectUpdateReceipt data={data as any} orgName={orgName} orgTagline={orgTagline} /> : null}
        </div>
      )}

      <style>{PRINT_CSS}</style>
    </div>
  );
}
