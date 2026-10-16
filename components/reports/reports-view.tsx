"use client";

import React, { useMemo, useState } from "react";
import {
  Download,
  Eye,
  FileText,
} from "lucide-react";
import { AppDropdown, Button, DropdownOption, ERPDatePicker, ERPFiscalMonthPicker, ERPFormField, ERPFormGrid, ERPFormSection } from "@/components/ui";
import { Project, Member } from "@/types";
import { useLocale } from "@/lib/i18n";
import { useTenantSettings } from "@/lib/use-tenant-settings";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { resolveFiscalQuarterBounds } from "@/lib/fiscal-periods";
import {
  REPORT_CATEGORIES,
  reportsForCategory,
  type ReportCategory,
  type ReportFormat,
  type ReportPeriodType,
} from "@/lib/reports/catalog";

interface ReportsViewProps {
  projects: Project[];
  members: Member[];
  funds: Array<{ id: string; name: string }>;
  onGenerateReport: (params: {
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
  }) => Promise<void>;
  /** #32 — open the same scope in the in-app viewer instead of downloading. */
  onViewReport?: (params: {
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
  }) => void;
}

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

export function ReportsView({
  projects,
  members,
  funds,
  onGenerateReport,
  onViewReport,
}: ReportsViewProps) {
  const { t, locale } = useLocale();

  const [activeCategory, setActiveCategory] = useState<ReportCategory>("ledger");
  const [reportSlug, setReportSlug] = useState("comprehensive-ledger");
  const [format, setFormat] = useState<ReportFormat>("xlsx");
  const [periodType, setPeriodType] = useState<ReportPeriodType>("Monthly");

  // Every period is fiscal (§8): Monthly picks a month of the tenant's fiscal
  // year, Quarterly/Yearly pick within the same fiscal year arrays.
  const [monthlyFiscalYear, setMonthlyFiscalYear] = useState<string | null>(null);
  const [monthlyMonth, setMonthlyMonth] = useState<string | null>(null);
  const [fiscalYear, setFiscalYear] = useState<string | null>(null);
  const [fiscalQuarter, setFiscalQuarter] = useState<string>("Q1");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  // Cascading entity filters (Rule §5 & §15: start empty with placeholders).
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedFundId, setSelectedFundId] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: tenantSettings } = useTenantSettings();
  const fiscalStartMonth = tenantSettings?.financial?.fiscalYearStart || "July";
  // One fiscal option source for every period control, shared with Analysis,
  // the deposit desk and the fiscal-period screen.
  const { yearOptionsIncluding, monthsFor, defaultFiscalYear, defaultMonthKey } = useFiscalPeriodOptions();
  const selectedFiscalYear = fiscalYear ?? defaultFiscalYear;
  // Reports is a read screen, so it opens on the period actually open for
  // posting rather than an empty filter; entry forms stay empty (§15).
  const monthlyFiscal = monthlyFiscalYear ?? defaultFiscalYear;
  const monthlyKey = monthlyMonth ?? defaultMonthKey(monthlyFiscal);
  const monthlyMonthOptions = monthsFor(monthlyFiscal);
  // Every created year, marked (Open)/(Closed) — closed history is reportable.
  const monthlyYearOptions = yearOptionsIncluding(monthlyFiscal);
  const selectedYearOptions = yearOptionsIncluding(selectedFiscalYear);
  const quarterOptions: DropdownOption[] = QUARTERS.map((quarter) => {
    try {
      const bounds = resolveFiscalQuarterBounds(Number(selectedFiscalYear), quarter, fiscalStartMonth);
      const startLabel = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(bounds.start);
      const endLabel = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(bounds.end);
      return { value: quarter, label: `${quarter} (${startLabel} – ${endLabel})` };
    } catch {
      return { value: quarter, label: quarter };
    }
  });

  const categoryReports = useMemo(() => reportsForCategory(activeCategory), [activeCategory]);
  const definition = useMemo(
    () => categoryReports.find((r) => r.slug === reportSlug) ?? categoryReports[0],
    [categoryReports, reportSlug],
  );

  const projectOptions: DropdownOption[] = projects.map((p) => ({
    value: p.id,
    label: p.title,
  }));

  const memberOptions: DropdownOption[] = members.map((m) => ({
    value: m.id,
    label: `${m.name} (${m.memberId})`,
  }));

  const fundOptions: DropdownOption[] = funds.map((f) => ({
    value: f.id,
    label: f.name,
  }));

  const needsProject = definition?.requires === "project" || definition?.optionalEntity === "project";
  const needsMember = definition?.requires === "member" || definition?.optionalEntity === "member";
  const needsFund = definition?.requires === "fund" || definition?.optionalEntity === "fund";
  const projectRequired = definition?.requires === "project";
  const memberRequired = definition?.requires === "member";
  const fundRequired = definition?.requires === "fund";

  // Shared validation for both Generate (download) and View (#32) — the viewer
  // must never be reachable with a scope the exporter would reject.
  const validateSelection = (): boolean => {
    setErrorMessage(null);

    if (projectRequired && !selectedProjectId) {
      setErrorMessage(t("reports.validation.selectProject", { defaultValue: "Please select a target project for this report." }));
      return false;
    }
    if (memberRequired && !selectedMemberId) {
      setErrorMessage(t("reports.validation.selectMember", { defaultValue: "Please select a target member for this report." }));
      return false;
    }
    if (fundRequired && !selectedFundId) {
      setErrorMessage(t("reports.validation.selectFund", { defaultValue: "Please select a target fund for this report." }));
      return false;
    }
    if (periodType === "Custom" && (!startDate || !endDate)) {
      setErrorMessage(t("reports.validation.selectRange", { defaultValue: "Please choose both start and end dates." }));
      return false;
    }
    if (!definition) {
      setErrorMessage(t("reports.validation.selectReport", { defaultValue: "Please select a report template." }));
      return false;
    }
    return true;
  };

  const selectionPayload = () => ({
    reportType: definition!.slug,
    periodType,
    // Absolute YYYY-MM of the fiscal month the user picked — the name and the
    // period now agree.
    fiscalMonth: periodType === "Monthly" ? monthlyKey : undefined,
    fiscalQuarter: periodType === "Quarterly" ? fiscalQuarter : undefined,
    fiscalYear: periodType === "Quarterly" || periodType === "Yearly" ? selectedFiscalYear : undefined,
    startDate: periodType === "Custom" ? startDate ?? undefined : undefined,
    endDate: periodType === "Custom" ? endDate ?? undefined : undefined,
    projectId: selectedProjectId || undefined,
    memberId: selectedMemberId || undefined,
    fundId: selectedFundId || undefined,
  });

  const handleGenerate = async () => {
    if (!validateSelection()) return;

    setIsGenerating(true);
    try {
      await onGenerateReport({ ...selectionPayload(), format });
    } catch (err) {
      setErrorMessage((err as Error)?.message || "Failed to generate export document.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleView = () => {
    if (!validateSelection()) return;
    onViewReport?.(selectionPayload());
  };

  return (
    <div className="space-y-6">
      {/* Category Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg max-w-fit flex-wrap">
        {REPORT_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => {
              setActiveCategory(cat.id);
              const first = reportsForCategory(cat.id)[0];
              if (first) setReportSlug(first.slug);
              setSelectedProjectId(null);
              setSelectedMemberId(null);
              setSelectedFundId(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeCategory === cat.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(cat.nameKey)}
          </button>
        ))}
      </div>

      {errorMessage && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-lg">
          {errorMessage}
        </div>
      )}

      {/* Main Configuration Card */}
      <div className="p-6 bg-card border border-border/80 rounded-xl shadow-sm space-y-6">
        <div>
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
            {t("reports.exportSpecification", { defaultValue: "Export Configuration" })}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("reports.specificationDesc", { defaultValue: "Reports conform to 4-locale UTF-8 formatting with tenant currency." })}
          </p>
        </div>

        <ERPFormSection title={t("reports.reportTypeTitle", { defaultValue: "1. Select Report Template" })}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {categoryReports.map((report) => (
              <button
                key={report.slug}
                type="button"
                onClick={() => setReportSlug(report.slug)}
                className={`p-3 text-left border rounded-md transition-all text-xs ${
                  definition?.slug === report.slug
                    ? "border-cyan-600 bg-cyan-50/50 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200 font-semibold ring-1 ring-cyan-500"
                    : "border-slate-200 dark:border-input hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                }`}
              >
                <FileText className="w-4 h-4 mb-2 text-cyan-600 dark:text-cyan-400" />
                <span className="block">{t(report.nameKey)}</span>
                <span className="block mt-1 text-[10px] font-normal text-muted-foreground leading-snug">
                  {t(report.descKey)}
                </span>
              </button>
            ))}
          </div>
        </ERPFormSection>

        <ERPFormSection title={t("reports.periodTitle", { defaultValue: "2. Period & Scope" })}>
          <ERPFormGrid cols={3}>
            <ERPFormField label={t("reports.periodType", { defaultValue: "Timeframe Period" })}>
              <AppDropdown
                options={[
                  { value: "Monthly", label: t("reports.periods.monthly") },
                  { value: "Quarterly", label: t("reports.periods.quarterly") },
                  { value: "Yearly", label: t("reports.periods.yearly") },
                  { value: "Custom", label: t("reports.periods.custom") },
                ]}
                value={periodType}
                onChange={(val) => setPeriodType((val as ReportPeriodType) || "Monthly")}
                clearable={false}
              />
            </ERPFormField>

            {periodType === "Monthly" && (
              <ERPFiscalMonthPicker
                fiscalYears={monthlyYearOptions}
                months={monthlyMonthOptions}
                value={{ fiscalYear: monthlyFiscal, month: monthlyKey }}
                onChange={(v) => {
                  setMonthlyFiscalYear(v.fiscalYear ?? defaultFiscalYear);
                  setMonthlyMonth(v.month);
                }}
              />
            )}

            {periodType === "Quarterly" && (
              <>
                <ERPFormField label={t("reports.quarter", { defaultValue: "Fiscal Quarter" })}>
                  <AppDropdown
                    options={quarterOptions}
                    value={fiscalQuarter}
                    onChange={(val) => setFiscalQuarter(val || "Q1")}
                    clearable={false}
                  />
                </ERPFormField>
                <ERPFormField label={t("reports.year", { defaultValue: "Fiscal Year" })}>
                  <AppDropdown
                    options={selectedYearOptions}
                    value={selectedFiscalYear}
                    onChange={setFiscalYear}
                    clearable={false}
                  />
                </ERPFormField>
              </>
            )}

            {periodType === "Yearly" && (
              <ERPFormField label={t("reports.year", { defaultValue: "Fiscal Year" })}>
                <AppDropdown
                  options={selectedYearOptions}
                  value={selectedFiscalYear}
                  onChange={setFiscalYear}
                  clearable={false}
                />
              </ERPFormField>
            )}

            {periodType === "Custom" && (
              <>
                <ERPFormField label={t("reports.startDate", { defaultValue: "Start Date" })}>
                  <ERPDatePicker value={startDate} onChange={setStartDate} />
                </ERPFormField>
                <ERPFormField label={t("reports.endDate", { defaultValue: "End Date" })}>
                  <ERPDatePicker value={endDate} onChange={setEndDate} min={startDate ?? null} />
                </ERPFormField>
              </>
            )}
          </ERPFormGrid>

          {/* Cascading Entity Selectors */}
          {(needsProject || needsMember || needsFund) && (
            <ERPFormGrid cols={3}>
              {needsProject && (
                <ERPFormField label={t("reports.linkedProject", { defaultValue: "Target Project" })}>
                  <AppDropdown
                    options={projectOptions}
                    value={selectedProjectId}
                    onChange={(val) => setSelectedProjectId(val)}
                    placeholder={t("reports.selectProjectPlaceholder", { defaultValue: "Select project..." })}
                  />
                </ERPFormField>
              )}

              {needsMember && (
                <ERPFormField label={t("reports.selectMember", { defaultValue: "Target Member" })}>
                  <AppDropdown
                    options={memberOptions}
                    value={selectedMemberId}
                    onChange={(val) => setSelectedMemberId(val)}
                    placeholder={t("reports.selectMemberPlaceholder", { defaultValue: "Select member..." })}
                  />
                </ERPFormField>
              )}

              {needsFund && (
                <ERPFormField label={t("reports.selectFund", { defaultValue: "Target Fund" })}>
                  <AppDropdown
                    options={fundOptions}
                    value={selectedFundId}
                    onChange={(val) => setSelectedFundId(val)}
                    placeholder={t("reports.selectFundPlaceholder", { defaultValue: "Select fund..." })}
                  />
                </ERPFormField>
              )}
            </ERPFormGrid>
          )}
        </ERPFormSection>

        <ERPFormSection title={t("reports.formatTitle", { defaultValue: "3. Output Document Format" })}>
          <div className="flex items-center gap-4 flex-wrap">
            {(
              [
                { value: "xlsx", label: t("reports.format.excel", { defaultValue: "Microsoft Excel (.xlsx)" }) },
                { value: "pdf", label: t("reports.format.pdf", { defaultValue: "Printable PDF (.pdf)" }) },
                { value: "csv", label: t("reports.format.csv", { defaultValue: "Raw CSV Data (.csv)" }) },
              ] as Array<{ value: ReportFormat; label: string }>
            ).map((option) => (
              <label key={option.value} className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="format"
                  value={option.value}
                  checked={format === option.value}
                  onChange={() => setFormat(option.value)}
                  className="text-cyan-600 focus:ring-cyan-500"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200">{option.label}</span>
              </label>
            ))}
          </div>
        </ERPFormSection>

        {/* View / Generate / Download Trigger */}
        <div className="pt-4 border-t border-slate-100 dark:border-border flex justify-end gap-2 flex-wrap">
          {onViewReport && (
            <Button
              variant="outline"
              size="md"
              onClick={handleView}
              icon={Eye}
            >
              {t("reports.viewButton", { defaultValue: "View Report" })}
            </Button>
          )}
          <Button
            variant="primary"
            size="md"
            onClick={handleGenerate}
            loading={isGenerating}
            icon={Download}
          >
            {t("reports.downloadButton", { defaultValue: "Generate & Export Document" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
