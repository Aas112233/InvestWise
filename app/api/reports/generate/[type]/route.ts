import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/middleware/auth";
import { requireTenant } from "@/lib/tenant";
import { logAudit } from "@/lib/utils/audit";
import { getDb } from "@/db/index";
import { systemSettings } from "@/db/schema/index";
import { eq } from "drizzle-orm";
import { ValidationError } from "@/lib/utils/errors";
import {
  getReportDefinition,
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
import { buildExcelBuffer } from "@/lib/reports/excel";
import { buildPdfBytes } from "@/lib/reports/pdf";
import { buildCsv } from "@/lib/reports/csv";

export const runtime = "nodejs";
// exceljs + jspdf + a 5000-row query can exceed the default 10s window.
export const maxDuration = 60;

const LOCALES: ReportLocale[] = ["en", "ur", "hi", "bn"];

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
    const slug = decodeURIComponent(type);
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

    // Required-entity guard straight from the catalog (Rule §5).
    if (definition.requires === "project" && !projectId) {
      throw new ValidationError("[Field 'projectId', Code: REQUIRED] A target project is required for this report");
    }
    if (definition.requires === "member" && !memberId) {
      throw new ValidationError("[Field 'memberId', Code: REQUIRED] A target member is required for this report");
    }
    if (definition.requires === "fund" && !fundId) {
      throw new ValidationError("[Field 'fundId', Code: REQUIRED] A target fund is required for this report");
    }

    // Resolve scoped entity display names; null for a provided id means the
    // entity belongs to another tenant — reject (Rule §6).
    const entityNames = await lookupEntityNames(scopedTenantId, { projectId, memberId, fundId });
    if (projectId && !entityNames.projectName) {
      throw new ValidationError("[Field 'projectId', Code: NOT_FOUND] Project not found in this tenant");
    }
    if (memberId && !entityNames.memberName) {
      throw new ValidationError("[Field 'memberId', Code: NOT_FOUND] Member not found in this tenant");
    }
    if (fundId && !entityNames.fundName) {
      throw new ValidationError("[Field 'fundId', Code: NOT_FOUND] Fund not found in this tenant");
    }

    // Tenant letterhead + currency + date format + fiscal calendar (Rule §8/§10).
    const db = getDb();
    const [settings] = await db
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
      .limit(1);

    const letterhead: ReportLetterhead = {
      name: settings?.companyName || "InvestWise",
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
    const period = resolveReportPeriod(periodParams, fiscal);

    const ctx: ReportRequestContext = {
      tenantId: scopedTenantId,
      locale,
      currency: settings?.baseCurrency || "BDT",
      dateFormat: settings?.dateFormat || "DD/MM/YYYY",
      generatedBy: user.name,
      fiscal,
    };

    const data = await fetchReportData(slug, ctx, period, periodParams, { projectId, memberId, fundId });
    const doc = buildReportDocument(data, ctx, periodParams, entityNames, letterhead);

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId: scopedTenantId,
      action: "GENERATE_REPORT",
      resourceType: "Report",
      resourceId: slug,
      details: {
        reportType: slug,
        format,
        rowCount: doc.rows.length,
        truncated: doc.truncated,
        period: doc.periodLine,
      },
      status: "SUCCESS",
    });

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
    return NextResponse.json(
      { success: false, message: (err as Error).message || "Report generation failed" },
      { status },
    );
  }
}
