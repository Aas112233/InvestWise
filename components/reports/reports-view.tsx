"use client";

import React, { useState } from "react";
import {
  FileText,
  Calendar,
  Clock,
  Download,
  FileSpreadsheet,
  FileCheck,
  Filter,
  CheckCircle2,
  Users,
  Briefcase,
  Landmark,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { AppDropdown, DropdownOption, Button, ERPFormSection, ERPFormGrid, ERPFormField } from "@/components/ui";
import { Project, Member } from "@/types";
import { useLocale } from "@/lib/i18n";
import { formatMoney } from "@/lib/formatters";

interface ReportsViewProps {
  projects: Project[];
  members: Member[];
  funds: Array<{ id: string; name: string }>;
  onGenerateReport: (params: {
    reportType: string;
    format: "Excel" | "PDF" | "CSV";
    periodType: "Monthly" | "Quarterly" | "Yearly" | "Custom";
    fiscalMonth?: string;
    fiscalQuarter?: string;
    fiscalYear?: string;
    startDate?: string;
    endDate?: string;
    projectId?: string;
    memberId?: string;
    fundId?: string;
  }) => Promise<void>;
}

export function ReportsView({
  projects,
  members,
  funds,
  onGenerateReport,
}: ReportsViewProps) {
  const { t, locale } = useLocale();

  const [activeCategory, setActiveCategory] = useState<"Ledger" | "Deposits" | "Expenses" | "Projects">("Ledger");
  const [reportType, setReportType] = useState("Comprehensive Master Ledger");
  const [format, setFormat] = useState<"Excel" | "PDF" | "CSV">("Excel");
  const [periodType, setPeriodType] = useState<"Monthly" | "Quarterly" | "Yearly" | "Custom">("Monthly");

  const [fiscalMonth, setFiscalMonth] = useState(new Date().toISOString().slice(0, 7));
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()));
  const [fiscalQuarter, setFiscalQuarter] = useState("Q1");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  // Cascading entity filters (Rule §5 & §15: starts empty with placeholders)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedFundId, setSelectedFundId] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reportTypeMap: Record<string, string[]> = {
    Ledger: [
      "Comprehensive Master Ledger",
      "Project Specific Ledger",
      "Member Specific Ledger",
      "Fund Specific Ledger",
    ],
    Deposits: ["Member Deposit History", "Monthly Contribution Schedule", "Arrears & Penalties Audit"],
    Expenses: ["Expense Audit Report", "Revenue & Earnings Ledger", "Project Expense Audit"],
    Projects: ["Project Performance & ROI", "Project Growth Matrix", "Disbursements Statement"],
  };

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

  const handleGenerate = async () => {
    setErrorMessage(null);

    // Validation for cascading selectors (Rule §5)
    if (reportType.includes("Project") && !selectedProjectId && reportType !== "Project Performance & ROI") {
      setErrorMessage(t("reports.validation.selectProject", { defaultValue: "Please select a target project for this report." }));
      return;
    }
    if (reportType.includes("Member") && !selectedMemberId && reportType !== "Monthly Contribution Schedule") {
      setErrorMessage(t("reports.validation.selectMember", { defaultValue: "Please select a target member for this report." }));
      return;
    }
    if (reportType.includes("Fund") && !selectedFundId) {
      setErrorMessage(t("reports.validation.selectFund", { defaultValue: "Please select a target fund for this report." }));
      return;
    }

    setIsGenerating(true);
    try {
      await onGenerateReport({
        reportType,
        format,
        periodType,
        fiscalMonth,
        fiscalQuarter,
        fiscalYear,
        startDate,
        endDate,
        projectId: selectedProjectId || undefined,
        memberId: selectedMemberId || undefined,
        fundId: selectedFundId || undefined,
      });
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to generate export document.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Category Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg max-w-fit">
        {(["Ledger", "Deposits", "Expenses", "Projects"] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => {
              setActiveCategory(cat);
              setReportType(reportTypeMap[cat]![0]!);
              setSelectedProjectId(null);
              setSelectedMemberId(null);
              setSelectedFundId(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeCategory === cat
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat} Reports
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
            {reportTypeMap[activeCategory]!.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setReportType(type)}
                className={`p-3 text-left border rounded-md transition-all text-xs ${
                  reportType === type
                    ? "border-cyan-600 bg-cyan-50/50 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200 font-semibold ring-1 ring-cyan-500"
                    : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                }`}
              >
                <FileText className="w-4 h-4 mb-2 text-cyan-600 dark:text-cyan-400" />
                <span>{type}</span>
              </button>
            ))}
          </div>
        </ERPFormSection>

        <ERPFormSection title={t("reports.periodTitle", { defaultValue: "2. Period & Scope" })}>
          <ERPFormGrid cols={3}>
            <ERPFormField label={t("reports.periodType", { defaultValue: "Timeframe Period" })}>
              <AppDropdown
                options={[
                  { value: "Monthly", label: "Monthly" },
                  { value: "Quarterly", label: "Quarterly" },
                  { value: "Yearly", label: "Yearly" },
                  { value: "Custom", label: "Custom Date Range" },
                ]}
                value={periodType}
                onChange={(val) => setPeriodType((val as any) || "Monthly")}
                clearable={false}
              />
            </ERPFormField>

            {periodType === "Monthly" && (
              <ERPFormField label={t("reports.month", { defaultValue: "Fiscal Month" })}>
                <input
                  type="month"
                  value={fiscalMonth}
                  onChange={(e) => setFiscalMonth(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none"
                />
              </ERPFormField>
            )}

            {periodType === "Quarterly" && (
              <>
                <ERPFormField label={t("reports.quarter", { defaultValue: "Fiscal Quarter" })}>
                  <AppDropdown
                    options={[
                      { value: "Q1", label: "Q1 (Jan - Mar)" },
                      { value: "Q2", label: "Q2 (Apr - Jun)" },
                      { value: "Q3", label: "Q3 (Jul - Sep)" },
                      { value: "Q4", label: "Q4 (Oct - Dec)" },
                    ]}
                    value={fiscalQuarter}
                    onChange={(val) => setFiscalQuarter(val || "Q1")}
                    clearable={false}
                  />
                </ERPFormField>
                <ERPFormField label={t("reports.year", { defaultValue: "Fiscal Year" })}>
                  <input
                    type="number"
                    value={fiscalYear}
                    onChange={(e) => setFiscalYear(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none"
                  />
                </ERPFormField>
              </>
            )}

            {periodType === "Custom" && (
              <>
                <ERPFormField label={t("reports.startDate", { defaultValue: "Start Date" })}>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none"
                  />
                </ERPFormField>
                <ERPFormField label={t("reports.endDate", { defaultValue: "End Date" })}>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none"
                  />
                </ERPFormField>
              </>
            )}
          </ERPFormGrid>

          {/* Cascading Entity Selectors */}
          <ERPFormGrid cols={3}>
            {reportType.includes("Project") && (
              <ERPFormField label={t("projects.linkedProject", { defaultValue: "Target Project" })}>
                <AppDropdown
                  options={projectOptions}
                  value={selectedProjectId}
                  onChange={(val) => setSelectedProjectId(val)}
                  placeholder={t("reports.selectProjectPlaceholder", { defaultValue: "Select project..." })}
                />
              </ERPFormField>
            )}

            {reportType.includes("Member") && (
              <ERPFormField label={t("members.selectMember", { defaultValue: "Target Member" })}>
                <AppDropdown
                  options={memberOptions}
                  value={selectedMemberId}
                  onChange={(val) => setSelectedMemberId(val)}
                  placeholder={t("reports.selectMemberPlaceholder", { defaultValue: "Select member..." })}
                />
              </ERPFormField>
            )}

            {reportType.includes("Fund") && (
              <ERPFormField label={t("funds.selectFund", { defaultValue: "Target Fund" })}>
                <AppDropdown
                  options={fundOptions}
                  value={selectedFundId}
                  onChange={(val) => setSelectedFundId(val)}
                  placeholder={t("reports.selectFundPlaceholder", { defaultValue: "Select fund..." })}
                />
              </ERPFormField>
            )}
          </ERPFormGrid>
        </ERPFormSection>

        <ERPFormSection title={t("reports.formatTitle", { defaultValue: "3. Output Document Format" })}>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="radio"
                name="format"
                value="Excel"
                checked={format === "Excel"}
                onChange={() => setFormat("Excel")}
                className="text-cyan-600 focus:ring-cyan-500"
              />
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {t("reports.format.excel", { defaultValue: "Microsoft Excel (.xlsx)" })}
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="radio"
                name="format"
                value="PDF"
                checked={format === "PDF"}
                onChange={() => setFormat("PDF")}
                className="text-cyan-600 focus:ring-cyan-500"
              />
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {t("reports.format.pdf", { defaultValue: "Printable PDF (.pdf)" })}
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="radio"
                name="format"
                value="CSV"
                checked={format === "CSV"}
                onChange={() => setFormat("CSV")}
                className="text-cyan-600 focus:ring-cyan-500"
              />
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {t("reports.format.csv", { defaultValue: "Raw CSV Data (.csv)" })}
              </span>
            </label>
          </div>
        </ERPFormSection>

        {/* Generate / Download Trigger */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
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
