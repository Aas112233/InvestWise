"use client";

import React, { useMemo } from "react";
import { useLocale } from "@/lib/i18n";
import { useFormatDate, useTenantSettings } from "@/lib/use-tenant-settings";

/**
 * Printable-document primitives.
 *
 * Design language: A4, monochrome, hairline rules, a single brand accent,
 * tabular figures. No gradients, no colored panels. All layout uses physical mm
 * (exact print fidelity) and logical alignment (start/end) so Urdu mirrors to
 * RTL automatically via the inherited <html dir>.
 */

/**
 * Stable fingerprint of a sheet, derived from its reference. The value is the
 * same every time the same document is printed, so it identifies the document;
 * the issuance timestamp beside it is what distinguishes one printout from the
 * next. Office staff can match either against the PRINT_DOCUMENT audit entries.
 */
function sheetCodeFor(reference: string | undefined): string | undefined {
  if (!reference) return undefined;
  let h = 0x811c9dc5;
  for (let i = 0; i < reference.length; i++) {
    h ^= reference.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, "0").slice(0, 7);
}

export interface DocSignature {
  label: string;
  name?: string;
  role?: string;
}

const HAIRLINE = "1px solid #eef0f3";
const RULE = "1px solid #e5e7eb";
const INK = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";

/**
 * Text must never clip on the sheet: every value can wrap inside its cell
 * (overflow-wrap: anywhere also breaks long unspaced tokens like reference
 * numbers) and nothing is allowed to be cut by ellipsis. breakInside keeps a
 * row/block whole when a long document flows onto a second printed page.
 */
const WRAP: React.CSSProperties = { overflowWrap: "anywhere", wordBreak: "break-word" };
const KEEP: React.CSSProperties = { breakInside: "avoid" };

interface DocumentFrameProps {
  orgName?: string;
  docType: string;
  reference?: string;
  dateLabel?: string;
  children: React.ReactNode;
  signatures?: DocSignature[];
  orgTagline?: string;
}

export function DocumentFrame({ orgName, docType, reference, dateLabel, children, signatures, orgTagline }: DocumentFrameProps) {
  const { t } = useLocale();
  const formatDate = useFormatDate();
  const org = useTenantSettings().data?.organization;
  // The sheet must date its own creation: a receipt printed today for a
  // transaction recorded three years ago was previously indistinguishable from
  // one printed on the day of payment.
  const issuedAt = useMemo(() => new Date(), []);
  const issuedLabel = formatDate(issuedAt, true);
  const sheetCode = sheetCodeFor(reference);
  const identity = [
    org?.companyAddress,
    org?.companyRegNo ? `${t("documents.regNo", { defaultValue: "Reg" })} ${org.companyRegNo}` : null,
    [org?.companyPhone, org?.companyEmail].filter(Boolean).join(" · ") || null,
  ].filter((line): line is string => Boolean(line));
  return (
    <div
      id="doc-sheet"
      className="doc-sheet"
      style={{
        width: "210mm",
        minHeight: "297mm",
        margin: "0 auto",
        padding: "16mm 18mm 14mm",
        background: "#ffffff",
        color: INK,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Letterhead */}
      <div style={{ borderBottom: RULE, paddingBottom: "6mm", marginBottom: "9mm", ...KEEP }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12mm" }}>
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.25, color: INK, ...WRAP }}>
              {orgName || t("documents.orgFallback", { defaultValue: "InvestWise" })}
            </div>
            <div style={{ marginTop: 3, fontSize: 10.5, color: FAINT, display: "flex", alignItems: "center", gap: 6 }}>
              {/* Outlined, not filled: a background dot vanishes when the print
                  dialog has "Background graphics" off, and the sheet must still
                  look like the issuer's letterhead on a mono printer. */}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 9999,
                  border: `1.5px solid ${INK}`,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              {orgTagline || "InvestWise"}
            </div>
            {identity.length > 0 ? (
              <div style={{ marginTop: 4, fontSize: 9.5, color: MUTED, lineHeight: 1.6, ...WRAP }}>
                {identity.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            ) : null}
          </div>
          <div style={{ textAlign: "end", fontSize: 11, color: MUTED, lineHeight: 1.7, minWidth: 0, flex: "0 1 auto", ...WRAP }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.09em", color: FAINT, fontWeight: 600, ...WRAP }}>
              {docType}
            </div>
            {reference ? (
              <div>
                {t("documents.reference", { defaultValue: "Reference" })}:{" "}
                <span style={{ fontVariantNumeric: "tabular-nums", color: INK }}>{reference}</span>
              </div>
            ) : (
              <div style={{ color: FAINT }}>{t("documents.noReference", { defaultValue: "No reference assigned" })}</div>
            )}
            {dateLabel ? <div style={{ fontVariantNumeric: "tabular-nums" }}>{dateLabel}</div> : null}
            {issuedLabel ? (
              <div style={{ fontSize: 9.5, color: FAINT, fontVariantNumeric: "tabular-nums" }}>
                {t("documents.issued", { defaultValue: "Issued" })}: {issuedLabel}
              </div>
            ) : null}
            {sheetCode ? (
              <div style={{ fontSize: 9.5, color: FAINT, fontVariantNumeric: "tabular-nums" }}>
                {t("documents.sheetCode", { defaultValue: "Sheet" })}: {sheetCode}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Body (grows so signatures/footer sit at the bottom of the sheet) */}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>

      {/* Signatures */}
      {signatures && signatures.length > 0 ? (
        <div style={{ marginTop: "10mm" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "10mm", ...KEEP }}>
            {signatures.map((s, i) => (
              <div key={i} style={{ flex: 1, maxWidth: "52mm", minWidth: 0 }}>
                <div
                  style={{
                    borderTop: `1px solid ${FAINT}`,
                    paddingTop: 5,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: INK,
                    minHeight: 15,
                    lineHeight: 1.3,
                    ...WRAP,
                  }}
                >
                  {s.name || ""}
                </div>
                <div style={{ fontSize: 9, color: FAINT, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>
                  {s.label}
                  {s.role ? ` · ${s.role}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Footer */}
      <div
        style={{
          marginTop: "10mm",
          paddingTop: "3mm",
        borderTop: HAIRLINE,
        fontSize: 9.5,
        color: FAINT,
        textAlign: "center",
        ...KEEP,
        ...WRAP,
      }}
    >
        {t("documents.generatedBy", { defaultValue: "Generated by InvestWise" })}
        {reference ? ` · ${reference}` : ""}
        {dateLabel ? ` · ${dateLabel}` : ""}
        {issuedLabel ? ` · ${t("documents.issued", { defaultValue: "Issued" })} ${issuedLabel}` : ""}
      </div>

      {/* Repeats on every printed page, so a second page still identifies the
          document it belongs to. Hidden on screen. */}
      <div className="doc-running">
        {orgName || "InvestWise"} · {docType}
        {reference ? ` · ${reference}` : ""}
      </div>
    </div>
  );
}

export function DocTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em", color: INK, marginBottom: 6, ...KEEP, ...WRAP }}>{children}</div>;
}

export function DocAmount({
  label,
  words,
  wordsLabel,
  children,
}: {
  label?: string;
  /** Spelled-out figure — the tamper evidence a numeric-only amount lacks. */
  words?: string | null;
  wordsLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ margin: "4mm 0 7mm" }}>
      {label ? (
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.09em", color: FAINT, marginBottom: 3, fontWeight: 600 }}>
          {label}
        </div>
      ) : null}
      <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em", color: INK, lineHeight: 1.2, ...WRAP }}>
        {children}
      </div>
      {words ? (
        <div style={{ marginTop: 4, fontSize: 11.5, color: MUTED, lineHeight: 1.5, ...WRAP }}>
          {wordsLabel ? <span style={{ color: FAINT }}>{wordsLabel}: </span> : null}
          <span style={{ color: INK, fontStyle: "italic" }}>{words}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Conditional-state banner. An unverified or declined row must not print as a
 * clean, official document — only voided rows carried a stamp before this.
 * Bordered rather than filled so it survives "no background graphics".
 */
export function DocBanner({ label, detail }: { label: string; detail?: string }) {
  return (
    <div
      style={{
        border: "1.5px solid #111827",
        borderLeft: `4px solid #111827`,
        padding: "3mm 4mm",
        marginBottom: "6mm",
        ...KEEP,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.11em", color: INK, ...WRAP }}>
        {label}
      </div>
      {detail ? <div style={{ marginTop: 2, fontSize: 10.5, color: MUTED, lineHeight: 1.5, ...WRAP }}>{detail}</div> : null}
    </div>
  );
}

export function DocRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12mm", padding: "3.1mm 0", borderBottom: HAIRLINE, fontSize: 12.5, ...KEEP }}>
      <span style={{ color: MUTED, flexShrink: 0, ...WRAP }}>{label}</span>
      <span style={{ color: INK, fontWeight: strong ? 650 : 500, textAlign: "end", fontVariantNumeric: "tabular-nums", minWidth: 0, flex: "1 1 auto", ...WRAP }}>{value}</span>
    </div>
  );
}

export function DocField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "3.1mm 0", borderBottom: HAIRLINE, ...KEEP }}>
      <div style={{ color: MUTED, fontSize: 12.5, marginBottom: 2 }}>{label}</div>
      <div style={{ color: INK, fontSize: 12.5, lineHeight: 1.55, ...WRAP }}>{children}</div>
    </div>
  );
}

/**
 * Void banner — a retracted ledger row must never print as a live document.
 * Monochrome rule: a bordered stamp survives a printer set to no colour.
 */
export function DocVoidStamp({ label, dateLabel, detail }: { label: string; dateLabel?: string; detail?: string }) {
  return (
    <div
      style={{
        border: "1.5px solid #111827",
        padding: "3.5mm 4mm",
        marginBottom: "7mm",
        ...KEEP,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8mm" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: INK, ...WRAP }}>{label}</span>
        {dateLabel ? (
          <span style={{ fontSize: 11, color: MUTED, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{dateLabel}</span>
        ) : null}
      </div>
      {/* A cancelled instrument has to name the person who cancelled it. */}
      {detail ? <div style={{ marginTop: 2, fontSize: 10.5, color: MUTED, ...WRAP }}>{detail}</div> : null}
    </div>
  );
}

export function DocSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.09em", color: FAINT, fontWeight: 600, margin: "6mm 0 2mm" }}>
      {children}
    </div>
  );
}

export function DocTable({ headers, rows, alignFirstLeft = true }: { headers: string[]; rows: React.ReactNode[][]; alignFirstLeft?: boolean }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: RULE }}>
          {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: i === 0 && alignFirstLeft ? "start" : "end",
                  padding: "2.4mm 0",
                  fontSize: 9.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: FAINT,
                  fontWeight: 600,
                  overflowWrap: "anywhere",
                }}
              >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} style={{ borderBottom: HAIRLINE, ...KEEP }}>
            {r.map((c, ci) => (
              <td key={ci} style={{ padding: "2.4mm 0", color: INK, textAlign: ci === 0 && alignFirstLeft ? "start" : "end", fontVariantNumeric: "tabular-nums", ...WRAP }}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
