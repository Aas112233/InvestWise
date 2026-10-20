import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/middleware/auth";
import { requireTenant } from "@/lib/tenant";
import { getDb } from "@/db/index";
import { systemSettings, tenants } from "@/db/schema/index";
import { eq } from "drizzle-orm";
import { ValidationError } from "@/lib/utils/errors";
import {
  getReportDefinition,
  parseMemberSelection,
  resolveReportPeriod,
  ReportParamError,
  DEFAULT_FISCAL,
  type ReportFormat,
  type ReportLocale,
} from "@/lib/reports/catalog";
import {
  fetchReportData,
  buildReportDocument,
  lookupEntityNames,
  type ReportLetterhead,
  type ReportRequestContext,
} from "@/lib/reports/data";
import { createServerT } from "@/lib/reports/format";
import { buildExcelBuffer } from "@/lib/reports/excel";
import { buildPdfBytes } from "@/lib/reports/pdf";
import { buildCsv } from "@/lib/reports/csv";

export const runtime = "nodejs";
// exceljs + jspdf + a 5000-row query can exceed the default 10s window.
export const maxDuration = 60;

const LOCALES: ReportLocale[] = ["en", "ur", "hi", "bn"];

// Entity ids are uuid columns. Validating the shape BEFORE any query keeps a
// garbage id a 400 (INVALID_FORMAT) instead of a Postgres 22P02 inside
// inArray that would surface as a 500 with the SQL in the error message.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeFormat(raw: string | null): ReportFormat {
  const value = (raw || "xlsx").toLowerCase();
  if (value === "xlsx" || value === "excel") return "xlsx";
  if (value === "pdf") return "pdf";
  if (value === "csv") return "csv";
  // #32: the in-app viewer consumes the same assembled document as the files.
  if (value === "json") return "json";
  throw new ValidationError(`[Field 'format', Code: INVALID_FORMAT] Unsupported format: ${raw}`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    const scopedTenantId = requireTenant(tenantId, user);

    const { type } = await params;
    // decodeURIComponent can throw on a malformed % sequence — a 400, not a
    // stack trace.
    let slug: string;
    try {
      slug = decodeURIComponent(type);
    } catch {
      throw new ValidationError("[Field 'type', Code: INVALID_FORMAT] Report type is not a valid URL segment");
    }
    const definition = getReportDefinition(slug);
    if (!definition) {
      throw new ValidationError(`[Field 'type', Code: UNKNOWN_REPORT_TYPE] Unknown report type: ${slug}`);
    }

    const { searchParams } = new URL(request.url);
    const format = normalizeFormat(searchParams.get("format"));
    const localeParam = (searchParams.get("locale") || "en").toLowerCase() as ReportLocale;
    const locale: ReportLocale = LOCALES.includes(localeParam) ? localeParam : "en";

    const projectId = searchParams.get("projectId") || null;
    const memberId = searchParams.get("memberId") || null;
    const fundId = searchParams.get("fundId") || null;
    // The member scope accepts one id (legacy links), a comma list, or the
    // "all" sentinel — parseMemberSelection keeps old report URLs working.
    const memberSelection = parseMemberSelection(memberId);
    const memberIds: string[] | null = memberSelection.all ? null : memberSelection.ids.length > 0 ? memberSelection.ids : null;

    // Shape-check every id before it reaches a uuid column (§11: a malformed
    // value is a 400 client fault, never a 500 with driver text).
    if (projectId && !UUID_RE.test(projectId)) {
      throw new ValidationError("[Field 'projectId', Code: INVALID_FORMAT] projectId must be a valid project id (uuid)");
    }
    if (fundId && !UUID_RE.test(fundId)) {
      throw new ValidationError("[Field 'fundId', Code: INVALID_FORMAT] fundId must be a valid fund id (uuid)");
    }
    if (memberSelection.ids.some((id) => !UUID_RE.test(id))) {
      throw new ValidationError("[Field 'memberId', Code: INVALID_FORMAT] memberId must be a comma-separated list of uuids or the value 'all'");
    }

    // The catalog is the single source of truth for which scopes a report
    // understands. Silently ignoring (or silently applying) a scope the
    // template doesn't declare made documents look scoped when they were not.
    const scopeApplies = (entity: "project" | "member" | "fund") =>
      definition.requires === entity || definition.optionalEntity === entity;
    if (projectId && !scopeApplies("project")) {
      throw new ValidationError("[Field 'projectId', Code: NOT_APPLICABLE] This report does not support a project scope");
    }
    if (memberSelection.all && !scopeApplies("member")) {
      throw new ValidationError("[Field 'memberId', Code: NOT_APPLICABLE] This report does not support a member scope");
    }
    if (memberSelection.ids.length > 0 && !scopeApplies("member")) {
      throw new ValidationError("[Field 'memberId', Code: NOT_APPLICABLE] This report does not support a member scope");
    }
    if (fundId && !scopeApplies("fund")) {
      throw new ValidationError("[Field 'fundId', Code: NOT_APPLICABLE] This report does not support a fund scope");
    }

    // Required-entity guard straight from the catalog (Rule §5).
    if (definition.requires === "project" && !projectId) {
      throw new ValidationError("[Field 'projectId', Code: REQUIRED] A target project is required for this report");
    }
    if (definition.requires === "member" && !memberSelection.all && memberSelection.ids.length === 0) {
      throw new ValidationError("[Field 'memberId', Code: REQUIRED] A target member is required for this report");
    }
    if (definition.requires === "fund" && !fundId) {
      throw new ValidationError("[Field 'fundId', Code: REQUIRED] A target fund is required for this report");
    }

    // Resolve scoped entity display names; a missing name for a provided id
    // means the entity belongs to another tenant — reject (Rule §6).
    const entityNames = await lookupEntityNames(scopedTenantId, { projectId, memberIds, fundId });
    if (projectId && !entityNames.projectName) {
      throw new ValidationError("[Field 'projectId', Code: NOT_FOUND] Project not found in this tenant");
    }
    if (memberSelection.ids.length > 0 && !entityNames.memberName) {
      throw new ValidationError("[Field 'memberId', Code: NOT_FOUND] Member not found in this tenant");
    }
    if (memberSelection.all) {
      // Explicit "all" scope — the document header says so.
      entityNames.memberName = createServerT(locale)("reports.allMembers");
    }
    if (fundId && !entityNames.fundName) {
      throw new ValidationError("[Field 'fundId', Code: NOT_FOUND] Fund not found in this tenant");
    }

    // Tenant letterhead + currency + date format + fiscal calendar (Rule §8/§10).
    const db = getDb();
    const [settingsRows, tenantRows] = await Promise.all([
      db
        .select({
          companyName: systemSettings.companyName,
          companyTagline: systemSettings.companyTagline,
          companyAddress: systemSettings.companyAddress,
          companyEmail: systemSettings.companyEmail,
          companyPhone: systemSettings.companyPhone,
          baseCurrency: systemSettings.baseCurrency,
          dateFormat: systemSettings.dateFormat,
          fiscalYearStart: systemSettings.fiscalYearStart,
          fiscalYearEnd: systemSettings.fiscalYearEnd,
        })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, scopedTenantId))
        .limit(1),
      db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, scopedTenantId)).limit(1),
    ]);
    const settings = settingsRows[0];
    const tenant = tenantRows[0];

    const letterhead: ReportLetterhead = {
      // Company name, else the tenant's name, else the brand — the letterhead
      // should never say "InvestWise" for a tenant that has a name.
      name: settings?.companyName || tenant?.name || "InvestWise",
      tagline: settings?.companyTagline,
      address: settings?.companyAddress,
      email: settings?.companyEmail,
      phone: settings?.companyPhone,
    };

    const fiscal = {
      startMonth: settings?.fiscalYearStart || DEFAULT_FISCAL.startMonth,
      endMonth: settings?.fiscalYearEnd || DEFAULT_FISCAL.endMonth,
    };
    const periodParams = {
      periodType: searchParams.get("periodType") || undefined,
      fiscalMonth: searchParams.get("fiscalMonth"),
      fiscalQuarter: searchParams.get("fiscalQuarter"),
      fiscalYear: searchParams.get("fiscalYear"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
    };
    // resolveReportPeriod throws ReportParamError for bad client params, but
    // the fiscal helpers throw plain Errors for an invalid tenant fiscal
    // calendar (e.g. a non-English month name in systemSettings) — that must
    // also be a 400, not a 500 with the helper's message.
    let period;
    try {
      period = resolveReportPeriod(periodParams, fiscal);
    } catch (err) {
      if (err instanceof ReportParamError) throw err;
      throw new ReportParamError("fiscalYear", "INVALID_FISCAL_CALENDAR", "The tenant fiscal calendar is misconfigured; check Settings");
    }

    const ctx: ReportRequestContext = {
      tenantId: scopedTenantId,
      locale,
      currency: settings?.baseCurrency || "BDT",
      dateFormat: settings?.dateFormat || "DD/MM/YYYY",
      generatedBy: user.name,
      fiscal,
    };

    const data = await fetchReportData(slug, ctx, period, {
      projectId,
      memberIds,
      memberScoped: memberSelection.all || memberSelection.ids.length > 0,
      fundId,
    });
    const doc = buildReportDocument(data, ctx, periodParams, entityNames, letterhead);

    // Report generation is deliberately NOT audited: it reads existing data and
    // changes nothing, and a read-heavy export would bury the real financial
    // trail in the audit log.

    const filename = `${doc.fileBase}.${format}`;
    const disposition = `attachment; filename="${filename}"`;

    // #32: the in-app viewer needs the assembled document, not a file. Return
    // the exact same payload the exporters consume (never a second query path).
    if (format === "json") {
      return NextResponse.json({ success: true, data: doc }, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (format === "xlsx") {
      const buffer = await buildExcelBuffer(doc);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": disposition,
          "Cache-Control": "no-cache",
        },
      });
    }

    if (format === "pdf") {
      const bytes = await buildPdfBytes(doc);
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": disposition,
          "Cache-Control": "no-cache",
        },
      });
    }

    return new NextResponse(buildCsv(doc), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": disposition,
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    if (err instanceof ReportParamError || err instanceof ValidationError) {
      return NextResponse.json(
        { success: false, message: err.message },
        { status: 400 },
      );
    }
    console.error("[REPORT GENERATE ERROR]", err);
    const status = (err as { statusCode?: number })?.statusCode || 500;
    // §11: the real error goes to the server log; the client gets a static
    // message. Returning err.message put driver SQL and stack text into the
    // response body on any unexpected failure.
    return NextResponse.json(
      { success: false, message: status === 401 ? "Unauthorized" : "[Code: INTERNAL] Report generation failed" },
      { status },
    );
  }
}
