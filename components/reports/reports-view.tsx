"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Eye,
  FileText,
} from "lucide-react";
import { AppDropdown, AppMultiSelect, Button, DropdownOption, ERPDatePicker, ERPFiscalMonthPicker, ERPFormField, ERPFormGrid, ERPFormSection } from "@/components/ui";
import { Project, Member } from "@/types";
import { useLocale } from "@/lib/i18n";
import { memberDisplayName } from "@/lib/member-display";
import { useTenantSettings, useTenantDateFormat } from "@/lib/use-tenant-settings";
import { useFiscalPeriodOptions } from "@/lib/fiscal-period-options";
import { useFiscalYearSync } from "@/lib/fiscal-year-context";
import { resolveFiscalQuarterBounds } from "@/lib/fiscal-periods";
import {
  REPORT_CATEGORIES,
  reportsForCategory,
  serializeMemberSelection,
  type MemberSelection,
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
  /** C6 — a localized message when the project/member/fund lists failed to load. */
  entityLoadError?: string | null;
  onRetryEntities?: () => void;
}

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

// C13: structural defaultValues — if a category label is ever missing from a
// locale file, the English name renders instead of the raw key path.
const CATEGORY_NAME_FALLBACKS: Record<ReportCategory, string> = {
  ledger: "Ledger",
  deposits: "Deposits",
  incomes: "Income",
  expenses: "Expenses",
  projects: "Projects",
};

export function ReportsView({
  projects,
  members,
  funds,
  onGenerateReport,
  onViewReport,
  entityLoadError,
  onRetryEntities,
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
  // Member scope is one / many / all (target member multi-select).
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [memberSelection, setMemberSelection] = useState<MemberSelection>({ all: false, ids: [] });
  const [selectedFundId, setSelectedFundId] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // C11: an error from a previous attempt must not survive the scope change
  // that fixes it — clear it whenever any input the message could refer to
  // is touched.
  useEffect(() => {
    setErrorMessage(null);
  }, [reportSlug, activeCategory, selectedProjectId, memberSelection, selectedFundId, periodType, startDate, endDate]);

  const { data: tenantSettings } = useTenantSettings();
  const dateFormat = useTenantDateFormat();
  const fiscalStartMonth = tenantSettings?.financial?.fiscalYearStart || "July";
  // One fiscal option source for every period control, shared with Analysis,
  // the deposit desk and the fiscal-period screen.
  const { yearOptionsAllIncluding, monthsFor, defaultFiscalYear, defaultMonthKey } = useFiscalPeriodOptions();
  // The header's fiscal-year selector is the app-wide period. A year picked here
  // survives until the header moves — then the local picks are cleared and the
  // report follows the header again (a report stuck on 2025-26 while the header
  // reads FY 2026-27 is exactly the confusion this removes).
  const clearLocalPeriod = useCallback(() => {
    setFiscalYear(null);
    setMonthlyFiscalYear(null);
    setMonthlyMonth(null);
  }, []);
  useFiscalYearSync(clearLocalPeriod);
  const selectedFiscalYear = fiscalYear ?? defaultFiscalYear;
  // Reports is a read screen, so it opens on the period actually open for
  // posting rather than an empty filter; entry forms stay empty (§15).
  const monthlyFiscal = monthlyFiscalYear ?? defaultFiscalYear;
  const monthlyKey = monthlyMonth ?? defaultMonthKey(monthlyFiscal);
  const monthlyMonthOptions = monthsFor(monthlyFiscal);
  // Every created year, marked (Open)/(Closed) — closed history IS reportable.
  // (The postable-only `yearOptionsIncluding` used to lock closed years out
  // of the picker, contradicting this comment.)
  const monthlyYearOptions = yearOptionsAllIncluding(monthlyFiscal);
  const selectedYearOptions = yearOptionsAllIncluding(selectedFiscalYear);
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
    label: `${memberDisplayName(m.name, m.status)} (${m.memberId})`,
  }));

  // "All members" renders every current row checked; the wire value is the
  // `all` sentinel (no stale id list), so later-added members stay in scope.
  const allMemberValues = useMemo(() => members.map((m) => m.id), [members]);

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

  // C12: the action buttons stay disabled while the selection cannot be
  // valid — the required markers on the fields tell the user what is missing
  // without waiting for a rejected round-trip.
  const isSelectionValid = useMemo(() => {
    if (!definition) return false;
    if (projectRequired && !selectedProjectId) return false;
    if (memberRequired && !memberSelection.all && memberSelection.ids.length === 0) return false;
    if (fundRequired && !selectedFundId) return false;
    if (periodType === "Custom" && (!startDate || !endDate)) return false;
    return true;
  }, [definition, projectRequired, memberRequired, fundRequired, selectedProjectId, memberSelection, selectedFundId, periodType, startDate, endDate]);

  // Shared validation for both Generate (download) and View (#32) — the viewer
  // must never be reachable with a scope the exporter would reject.
  const validateSelection = (): boolean => {
    setErrorMessage(null);

    if (projectRequired && !selectedProjectId) {
      setErrorMessage(t("reports.validation.selectProject", { defaultValue: "Please select a target project for this report." }));
      return false;
    }
    if (memberRequired && !memberSelection.all && memberSelection.ids.length === 0) {
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
    // C2: only send scopes this template actually declares — the server now
    // rejects undeclared scopes with NOT_APPLICABLE, and the viewer/exporter
    // must agree on the same URL.
    projectId: needsProject ? selectedProjectId || undefined : undefined,
    // One id, a comma list, or the "all" sentinel — the server parses all three.
    memberId: needsMember ? (serializeMemberSelection(memberSelection) ?? undefined) : undefined,
    fundId: needsFund ? selectedFundId || undefined : undefined,
  });

  const handleGenerate = async () => {
    if (!validateSelection()) return;

    setIsGenerating(true);
    try {
      await onGenerateReport({ ...selectionPayload(), format });
    } catch (err) {
      // C17: server-issued messages (localized 400s) win; the no-message
      // fallback is a translated string, never a hard-coded one (§9).
      setErrorMessage((err as Error)?.message || t("reports.errors.generateFailed", { defaultValue: "Failed to generate the report. Please try again." }));
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
              setMemberSelection({ all: false, ids: [] });
              setSelectedFundId(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeCategory === cat.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
              {t(cat.nameKey, { defaultValue: CATEGORY_NAME_FALLBACKS[cat.id] })}
            </button>
        ))}
      </div>

      {errorMessage && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-lg">
          {errorMessage}
        </div>
      )}

      {/* C6: a silently empty dropdown is worse than a loud banner. */}
      {entityLoadError && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs rounded-lg flex items-center justify-between gap-3">
          <span>{entityLoadError}</span>
          {onRetryEntities && (
            <button type="button" onClick={onRetryEntities} className="shrink-0 font-semibold underline">
              {t("common.retry", { defaultValue: "Retry" })}
            </button>
          )}
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
                  <ERPDatePicker value={startDate} onChange={setStartDate} displayFormat={dateFormat} />
                </ERPFormField>
                <ERPFormField label={t("reports.endDate", { defaultValue: "End Date" })}>
                  <ERPDatePicker value={endDate} onChange={setEndDate} displayFormat={dateFormat} min={startDate ?? null} />
                </ERPFormField>
              </>
            )}
          </ERPFormGrid>

          {/* Cascading Entity Selectors */}
          {(needsProject || needsMember || needsFund) && (
            <ERPFormGrid cols={3}>
              {needsProject && (
                <ERPFormField label={t("reports.linkedProject", { defaultValue: "Target Project" })} required={projectRequired}>
                  <AppDropdown
                    options={projectOptions}
                    value={selectedProjectId}
                    onChange={(val) => setSelectedProjectId(val)}
                    placeholder={t("reports.selectProjectPlaceholder", { defaultValue: "Select project..." })}
                  />
                </ERPFormField>
              )}

              {needsMember && (
                <ERPFormField label={t("reports.selectMember", { defaultValue: "Target Member" })} required={memberRequired}>
                    <AppMultiSelect
                      options={memberOptions}
                      values={memberSelection.all ? allMemberValues : memberSelection.ids}
                      onChange={(ids, toggled) => {
                        // C1: from "All members", toggling one member starts a
                        // fresh single selection — handing the user the whole
                        // id list (minus one) would be unmanageable.
                        if (memberSelection.all && toggled) {
                          setMemberSelection({ all: false, ids: [toggled.value] });
                          return;
                        }
                        setMemberSelection({ all: false, ids });
                      }}
                    placeholder={t("reports.selectMemberPlaceholder", { defaultValue: "Select member..." })}
                    allEntry={{
                      label: t("reports.allMembers", { defaultValue: "All members" }),
                      active: memberSelection.all,
                      onToggle: (active) =>
                        setMemberSelection(active ? { all: true, ids: [] } : { all: false, ids: [] }),
                    }}
                  />
                </ERPFormField>
              )}

              {needsFund && (
                <ERPFormField label={t("reports.selectFund", { defaultValue: "Target Fund" })} required={fundRequired}>
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
              disabled={!isSelectionValid}
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
            disabled={!isSelectionValid}
            icon={Download}
          >
            {t("reports.downloadButton", { defaultValue: "Generate & Export Document" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
