"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Landmark, Lock, Plus, RefreshCw, Scale, Settings2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n";
import { hasScreenPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type SettingsTab = "organization" | "financial" | "governance" | "system";

interface PenaltyRule {
  tier: number;
  title: string;
  type: string;
  deductionAmount?: number;
  isPercentage?: boolean;
}

interface SettingsResponse {
  organization: {
    companyName: string;
    companyTagline: string;
    companyAddress: string;
    companyEmail: string;
    companyPhone: string;
    companyWebsite: string;
    companyRegNo: string;
  };
  financial: {
    fiscalYearStart: string;
    fiscalYearEnd: string;
    baseCurrency: string;
    taxRate: number;
    accountingMethod: string;
    shareValueBdt: number;
    isShareValueLocked: boolean;
    withdrawalLimitPercent: number;
    withdrawalNoticeDays: number;
    maxWithdrawalPerRequest: number;
    statutoryReservePercent: number;
  };
  governance: {
    monthlyMeetingDay: number;
    depositDueDate: number;
    gracePeriodDays: number;
    meetingTypes: string[];
    penaltyRules: PenaltyRule[];
  };
  system: {
    language: string;
    refreshInterval: string;
    theme: string;
    dateFormat: string;
    isMaintenanceMode: boolean;
  };
}

const MONTHS: { short: "jan" | "feb" | "mar" | "apr" | "may" | "jun" | "jul" | "aug" | "sep" | "oct" | "nov" | "dec"; full: string }[] = [
  { short: "jan", full: "January" },
  { short: "feb", full: "February" },
  { short: "mar", full: "March" },
  { short: "apr", full: "April" },
  { short: "may", full: "May" },
  { short: "jun", full: "June" },
  { short: "jul", full: "July" },
  { short: "aug", full: "August" },
  { short: "sep", full: "September" },
  { short: "oct", full: "October" },
  { short: "nov", full: "November" },
  { short: "dec", full: "December" },
];

const inputCls =
  "w-full px-3 py-2 rounded-lg border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-60 disabled:bg-muted/50";

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

// Enterprise settings administration (behavioral port of Settings.tsx
// CONFIGURATIONS area). Wired to GET /api/settings + PUT /api/settings with
// per-group payloads; share-value edits are rejected server-side once locked
// (Rule §12) and the UI reflects the lock with a badge + disabled input.
export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>("organization");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient<SettingsResponse>("/settings"),
    staleTime: 60_000,
  });

  const [org, setOrg] = useState({ companyName: "", companyTagline: "", companyAddress: "", companyEmail: "", companyPhone: "", companyWebsite: "", companyRegNo: "" });
  const [fin, setFin] = useState({ fiscalYearStart: "", fiscalYearEnd: "", baseCurrency: "", taxRate: "", accountingMethod: "", shareValueBdt: "", withdrawalLimitPercent: "", withdrawalNoticeDays: "", maxWithdrawalPerRequest: "", statutoryReservePercent: "" });
  const [gov, setGov] = useState({ monthlyMeetingDay: "", depositDueDate: "", gracePeriodDays: "", meetingTypes: [] as string[], penaltyRules: [] as PenaltyRule[] });
  const [sys, setSys] = useState({ language: "", refreshInterval: "", theme: "", dateFormat: "", isMaintenanceMode: false });
  const [shareLocked, setShareLocked] = useState(false);
  const [newMeetingType, setNewMeetingType] = useState("");

  useEffect(() => {
    if (!data) return;
    setOrg({ ...data.organization });
    setFin({
      fiscalYearStart: data.financial.fiscalYearStart,
      fiscalYearEnd: data.financial.fiscalYearEnd,
      baseCurrency: data.financial.baseCurrency,
      taxRate: String(data.financial.taxRate),
      accountingMethod: data.financial.accountingMethod,
      shareValueBdt: String(data.financial.shareValueBdt),
      withdrawalLimitPercent: String(data.financial.withdrawalLimitPercent),
      withdrawalNoticeDays: String(data.financial.withdrawalNoticeDays),
      maxWithdrawalPerRequest: String(data.financial.maxWithdrawalPerRequest),
      statutoryReservePercent: String(data.financial.statutoryReservePercent),
    });
    setGov({
      monthlyMeetingDay: String(data.governance.monthlyMeetingDay),
      depositDueDate: String(data.governance.depositDueDate),
      gracePeriodDays: String(data.governance.gracePeriodDays),
      meetingTypes: [...(data.governance.meetingTypes ?? [])],
      penaltyRules: [...(data.governance.penaltyRules ?? [])],
    });
    setSys({ ...data.system });
    setShareLocked(data.financial.isShareValueLocked);
  }, [data]);

  if (!authLoading && !user) {
    router.replace("/login?redirect=/settings");
    return null;
  }

  const canWrite = hasScreenPermission(user, "SETTINGS", "WRITE");

  return (
    <AppShell>
      <SettingsBody
        tab={tab}
        setTab={setTab}
        isLoading={isLoading}
        isError={isError}
        isFetching={isFetching}
        refetch={refetch}
        org={org}
        setOrg={setOrg}
        fin={fin}
        setFin={setFin}
        gov={gov}
        setGov={setGov}
        sys={sys}
        setSys={setSys}
        shareLocked={shareLocked}
        newMeetingType={newMeetingType}
        setNewMeetingType={setNewMeetingType}
        canWrite={canWrite}
        queryClient={queryClient}
      />
    </AppShell>
  );
}

interface BodyProps {
  tab: SettingsTab;
  setTab: (t: SettingsTab) => void;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
  org: { companyName: string; companyTagline: string; companyAddress: string; companyEmail: string; companyPhone: string; companyWebsite: string; companyRegNo: string };
  setOrg: React.Dispatch<React.SetStateAction<BodyProps["org"]>>;
  fin: Record<"fiscalYearStart" | "fiscalYearEnd" | "baseCurrency" | "taxRate" | "accountingMethod" | "shareValueBdt" | "withdrawalLimitPercent" | "withdrawalNoticeDays" | "maxWithdrawalPerRequest" | "statutoryReservePercent", string>;
  setFin: React.Dispatch<React.SetStateAction<BodyProps["fin"]>>;
  gov: { monthlyMeetingDay: string; depositDueDate: string; gracePeriodDays: string; meetingTypes: string[]; penaltyRules: PenaltyRule[] };
  setGov: React.Dispatch<React.SetStateAction<BodyProps["gov"]>>;
  sys: { language: string; refreshInterval: string; theme: string; dateFormat: string; isMaintenanceMode: boolean };
  setSys: React.Dispatch<React.SetStateAction<BodyProps["sys"]>>;
  shareLocked: boolean;
  newMeetingType: string;
  setNewMeetingType: (v: string) => void;
  canWrite: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
}

function SettingsBody(props: BodyProps) {
  const { tab, setTab, isLoading, isError, isFetching, refetch, canWrite, queryClient } = props;
  const { t } = useLocale();

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiClient<SettingsResponse>("/settings", { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(["settings"], updated);
      const section = t(`settings.tabs.${Object.keys(variables)[0] ?? "organization"}`);
      toast.success(t("settings.saved", { section }));
    },
    onError: (err) => {
      toast.error(errMsg(err, t("settings.loadFailed")));
    },
  });

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "organization", label: t("settings.tabs.organization"), icon: <Building2 size={14} /> },
    { id: "financial", label: t("settings.tabs.financial"), icon: <Landmark size={14} /> },
    { id: "governance", label: t("settings.tabs.governance"), icon: <Scale size={14} /> },
    { id: "system", label: t("settings.tabs.system"), icon: <Settings2 size={14} /> },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {t("settings.title")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("settings.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching} icon={<RefreshCw size={13} />}>
          {t("settings.refresh")}
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border/80" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors",
              tab === tb.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tb.icon}
            {tb.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="bg-card p-6 rounded-xl border border-border/80 shadow-sm space-y-4">
          <Skeleton width="12rem" height="1.25rem" />
          <Skeleton width="100%" height="2.5rem" />
          <Skeleton width="100%" height="2.5rem" />
        </div>
      ) : isError ? (
        <div role="alert" className="bg-card p-8 rounded-xl border border-border/80 shadow-sm text-center space-y-3">
          <p className="text-sm text-muted-foreground">{t("settings.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : !canWrite ? (
        <div role="alert" className="bg-card p-8 rounded-xl border border-border/80 shadow-sm text-center">
          <p className="text-sm font-medium text-foreground">{t("settings.forbidden")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("settings.forbiddenDetails")}</p>
        </div>
      ) : (
        <>
          {tab === "organization" && <OrganizationTab {...props} save={(p) => saveMutation.mutate(p)} pending={saveMutation.isPending} />}
          {tab === "financial" && <FinancialTab {...props} save={(p) => saveMutation.mutate(p)} pending={saveMutation.isPending} />}
          {tab === "governance" && <GovernanceTab {...props} save={(p) => saveMutation.mutate(p)} pending={saveMutation.isPending} />}
          {tab === "system" && <SystemTab {...props} save={(p) => saveMutation.mutate(p)} pending={saveMutation.isPending} />}
        </>
      )}
    </div>
  );
}

function SaveBar({ pending, onSave }: { pending: boolean; onSave: () => void }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <Button variant="primary" size="sm" loading={pending} loadingLabel={t("settings.saving")} onClick={onSave}>
        {t("settings.save")}
      </Button>
    </div>
  );
}

function OrganizationTab({ org, setOrg, save, pending }: BodyProps & { save: (p: Record<string, unknown>) => void; pending: boolean }) {
  const { t } = useLocale();
  const set = (k: keyof BodyProps["org"]) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOrg((prev) => ({ ...prev, [k]: e.target.value }));
  return (
    <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6">
      <ERPFormLayout>
        <ERPFormSection title={t("settings.organization.title")} description={t("settings.organization.description")}>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.organization.companyName")} required>
              <input value={org.companyName} onChange={set("companyName")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.organization.companyTagline")}>
              <input value={org.companyTagline} onChange={set("companyTagline")} className={inputCls} />
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormField label={t("settings.organization.companyAddress")}>
            <input value={org.companyAddress} onChange={set("companyAddress")} className={inputCls} />
          </ERPFormField>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.organization.companyEmail")}>
              <input type="email" value={org.companyEmail} onChange={set("companyEmail")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.organization.companyPhone")}>
              <input value={org.companyPhone} onChange={set("companyPhone")} className={inputCls} />
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.organization.companyWebsite")}>
              <input value={org.companyWebsite} onChange={set("companyWebsite")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.organization.companyRegNo")}>
              <input value={org.companyRegNo} onChange={set("companyRegNo")} className={inputCls} />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>
        <SaveBar pending={pending} onSave={() => save({ organization: org })} />
      </ERPFormLayout>
    </div>
  );
}

function FinancialTab({ fin, setFin, shareLocked, save, pending }: BodyProps & { save: (p: Record<string, unknown>) => void; pending: boolean }) {
  const { t } = useLocale();
  const set = (k: keyof BodyProps["fin"]) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFin((prev) => ({ ...prev, [k]: e.target.value }));

  const monthOptions = MONTHS.map(({ short, full }) => ({
    value: full,
    label: t(`common.months.${short}`),
  }));
  const num = (v: string, fallback = 0): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
  };
  const int = (v: string, fallback = 0): number => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const onSave = () =>
    save({
      financial: {
        fiscalYearStart: fin.fiscalYearStart,
        fiscalYearEnd: fin.fiscalYearEnd,
        baseCurrency: fin.baseCurrency.trim() || "BDT",
        taxRate: num(fin.taxRate, 0),
        accountingMethod: fin.accountingMethod || "Cash",
        ...(shareLocked ? {} : { shareValueBdt: num(fin.shareValueBdt, 0) }),
        withdrawalLimitPercent: num(fin.withdrawalLimitPercent, 0),
        withdrawalNoticeDays: int(fin.withdrawalNoticeDays, 0),
        maxWithdrawalPerRequest: num(fin.maxWithdrawalPerRequest, 0),
        statutoryReservePercent: num(fin.statutoryReservePercent, 0),
      },
    });

  return (
    <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6">
      <ERPFormLayout>
        <ERPFormSection title={t("settings.financial.title")} description={t("settings.financial.description")}>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.financial.fiscalYearStart")}>
              <AppDropdown options={monthOptions} value={fin.fiscalYearStart || null} onChange={(v) => setFin((p) => ({ ...p, fiscalYearStart: v ?? "" }))} placeholder={t("erp.fiscalMonth.selectMonth")} />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.fiscalYearEnd")}>
              <AppDropdown options={monthOptions} value={fin.fiscalYearEnd || null} onChange={(v) => setFin((p) => ({ ...p, fiscalYearEnd: v ?? "" }))} placeholder={t("erp.fiscalMonth.selectMonth")} />
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormGrid columns={3}>
            <ERPFormField label={t("settings.financial.baseCurrency")}>
              <input value={fin.baseCurrency} onChange={set("baseCurrency")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.taxRate")}>
              <input type="number" min="0" max="100" step="0.01" value={fin.taxRate} onChange={set("taxRate")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.accountingMethod")}>
              <AppDropdown
                options={[
                  { value: "Cash", label: t("settings.financial.cash") },
                  { value: "Accrual", label: t("settings.financial.accrual") },
                ]}
                value={fin.accountingMethod || null}
                onChange={(v) => setFin((p) => ({ ...p, accountingMethod: v ?? "" }))}
                placeholder={t("settings.financial.accountingMethod")}
              />
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormField
            label={t("settings.financial.shareValue")}
            hint={shareLocked ? t("settings.financial.shareLockedNote") : undefined}
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={fin.shareValueBdt}
                onChange={set("shareValueBdt")}
                disabled={shareLocked}
                className={cn(inputCls, "flex-1")}
              />
              <StatusBadge tone={shareLocked ? "slate" : "emerald"}>
                <span className="inline-flex items-center gap-1">
                  {shareLocked && <Lock size={11} />}
                  {shareLocked ? t("settings.financial.shareLocked") : t("settings.financial.shareUnlocked")}
                </span>
              </StatusBadge>
            </div>
          </ERPFormField>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.financial.withdrawalLimit")}>
              <input type="number" min="0" max="100" step="0.01" value={fin.withdrawalLimitPercent} onChange={set("withdrawalLimitPercent")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.withdrawalNotice")}>
              <input type="number" min="0" value={fin.withdrawalNoticeDays} onChange={set("withdrawalNoticeDays")} className={inputCls} />
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.financial.maxWithdrawal")}>
              <input type="number" min="0" step="0.01" value={fin.maxWithdrawalPerRequest} onChange={set("maxWithdrawalPerRequest")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.statutoryReserve")}>
              <input type="number" min="0" max="100" step="0.01" value={fin.statutoryReservePercent} onChange={set("statutoryReservePercent")} className={inputCls} />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>
        <SaveBar pending={pending} onSave={onSave} />
      </ERPFormLayout>
    </div>
  );
}

function GovernanceTab({ gov, setGov, newMeetingType, setNewMeetingType, save, pending }: BodyProps & { save: (p: Record<string, unknown>) => void; pending: boolean }) {
  const { t } = useLocale();
  const setNum = (k: "monthlyMeetingDay" | "depositDueDate" | "gracePeriodDays") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setGov((prev) => ({ ...prev, [k]: e.target.value }));

  const penaltyTypeOptions = [
    { value: "VERBAL_WARNING", label: t("settings.governance.verbal") },
    { value: "FUND_DEDUCTION", label: t("settings.governance.fundDeduction") },
    { value: "SUSPENSION", label: t("settings.governance.suspension") },
  ];

  const onSave = () =>
    save({
      governance: {
        monthlyMeetingDay: Math.max(1, Math.min(28, parseInt(gov.monthlyMeetingDay, 10) || 1)),
        depositDueDate: Math.max(1, Math.min(28, parseInt(gov.depositDueDate, 10) || 1)),
        gracePeriodDays: Math.max(0, parseInt(gov.gracePeriodDays, 10) || 0),
        meetingTypes: gov.meetingTypes,
        penaltyRules: gov.penaltyRules.map((r) => ({
          tier: r.tier,
          title: r.title,
          type: r.type,
          deductionAmount: Number(r.deductionAmount) || 0,
          isPercentage: !!r.isPercentage,
        })),
      },
    });

  return (
    <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6">
      <ERPFormLayout>
        <ERPFormSection title={t("settings.governance.title")} description={t("settings.governance.description")}>
          <ERPFormGrid columns={3}>
            <ERPFormField label={t("settings.governance.monthlyMeetingDay")}>
              <input type="number" min="1" max="28" value={gov.monthlyMeetingDay} onChange={setNum("monthlyMeetingDay")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.governance.depositDueDate")}>
              <input type="number" min="1" max="28" value={gov.depositDueDate} onChange={setNum("depositDueDate")} className={inputCls} />
            </ERPFormField>
            <ERPFormField label={t("settings.governance.gracePeriodDays")}>
              <input type="number" min="0" value={gov.gracePeriodDays} onChange={setNum("gracePeriodDays")} className={inputCls} />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>

        <ERPFormSection title={t("settings.governance.meetingTypes")}>
          <div className="flex flex-wrap gap-2">
            {gov.meetingTypes.map((mt) => (
              <span key={mt} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/80 text-xs text-foreground bg-muted/30">
                {mt}
                <button
                  type="button"
                  aria-label={`Remove ${mt}`}
                  onClick={() => setGov((p) => ({ ...p, meetingTypes: p.meetingTypes.filter((x) => x !== mt) }))}
                  className="text-muted-foreground hover:text-rose-500 transition-colors"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newMeetingType}
              onChange={(e) => setNewMeetingType(e.target.value)}
              placeholder={t("settings.governance.meetingTypes")}
              className={cn(inputCls, "flex-1")}
            />
            <Button
              variant="outline"
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => {
                const v = newMeetingType.trim().toUpperCase().replace(/\s+/g, "_");
                if (v && !gov.meetingTypes.includes(v)) {
                  setGov((p) => ({ ...p, meetingTypes: [...p.meetingTypes, v] }));
                  setNewMeetingType("");
                }
              }}
            >
              {t("settings.governance.addType")}
            </Button>
          </div>
        </ERPFormSection>

        <ERPFormSection title={t("settings.governance.penaltyRules")}>
          <div className="space-y-3">
            {gov.penaltyRules.map((rule, idx) => (
              <div key={rule.tier} className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-end p-3 rounded-lg border border-border/80 bg-muted/30">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider pb-2">
                  {t("settings.governance.tier", { n: rule.tier })}
                </span>
                <ERPFormField label={t("settings.governance.ruleTitle")}>
                  <input
                    value={rule.title}
                    onChange={(e) =>
                      setGov((p) => ({
                        ...p,
                        penaltyRules: p.penaltyRules.map((r, i) => (i === idx ? { ...r, title: e.target.value } : r)),
                      }))
                    }
                    className={inputCls}
                  />
                </ERPFormField>
                <ERPFormField label={t("settings.governance.ruleType")}>
                  <AppDropdown
                    options={penaltyTypeOptions}
                    value={rule.type || null}
                    onChange={(v) =>
                      setGov((p) => ({
                        ...p,
                        penaltyRules: p.penaltyRules.map((r, i) => (i === idx ? { ...r, type: v ?? r.type } : r)),
                      }))
                    }
                    placeholder={t("settings.governance.ruleType")}
                    clearable={false}
                  />
                </ERPFormField>
                <ERPFormField label={t("settings.governance.deduction")}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rule.deductionAmount ?? 0}
                    onChange={(e) =>
                      setGov((p) => ({
                        ...p,
                        penaltyRules: p.penaltyRules.map((r, i) =>
                          i === idx ? { ...r, deductionAmount: parseFloat(e.target.value) || 0 } : r,
                        ),
                      }))
                    }
                    className={inputCls}
                  />
                </ERPFormField>
                <label className="flex items-center gap-2 pb-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!rule.isPercentage}
                    onChange={(e) =>
                      setGov((p) => ({
                        ...p,
                        penaltyRules: p.penaltyRules.map((r, i) => (i === idx ? { ...r, isPercentage: e.target.checked } : r)),
                      }))
                    }
                    className="w-4 h-4 rounded border-slate-300 accent-blue-600 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-500">{t("settings.governance.isPercentage")}</span>
                </label>
              </div>
            ))}
          </div>
        </ERPFormSection>
        <SaveBar pending={pending} onSave={onSave} />
      </ERPFormLayout>
    </div>
  );
}

function SystemTab({ sys, setSys, save, pending }: BodyProps & { save: (p: Record<string, unknown>) => void; pending: boolean }) {
  const { t, setLocale } = useLocale();
  const { setTheme } = useTheme();

  return (
    <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6">
      <ERPFormLayout>
        <ERPFormSection title={t("settings.system.title")} description={t("settings.system.description")}>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.system.language")}>
              <AppDropdown
                options={[
                  { value: "English", label: "English" },
                  { value: "Bengali", label: "Bengali" },
                ]}
                value={sys.language || null}
                onChange={(v) => {
                  setSys((p) => ({ ...p, language: v ?? "" }));
                  if (v === "English") setLocale("en");
                  else if (v === "Bengali") setLocale("bn");
                }}
                placeholder={t("settings.system.language")}
              />
            </ERPFormField>
            <ERPFormField label={t("settings.system.theme")}>
              <AppDropdown
                options={[
                  { value: "System Default", label: t("settings.system.themeSystem") },
                  { value: "Light", label: t("settings.system.themeLight") },
                  { value: "Dark", label: t("settings.system.themeDark") },
                ]}
                value={sys.theme || null}
                onChange={(v) => {
                  const theme = v ?? "";
                  setSys((p) => ({ ...p, theme }));
                  if (theme === "Dark") {
                    setTheme("dark");
                  } else if (theme === "Light") {
                    setTheme("light");
                  } else {
                    setTheme("system");
                  }
                }}
                placeholder={t("settings.system.theme")}
              />
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.system.refreshInterval")}>
              <AppDropdown
                options={[
                  { value: "Real-time", label: t("settings.system.realtime") },
                  { value: "1 minute", label: "1 minute" },
                  { value: "5 minutes", label: "5 minutes" },
                ]}
                value={sys.refreshInterval || null}
                onChange={(v) => setSys((p) => ({ ...p, refreshInterval: v ?? "" }))}
                placeholder={t("settings.system.refreshInterval")}
              />
            </ERPFormField>
            <ERPFormField label={t("settings.system.dateFormat")}>
              <AppDropdown
                options={[
                  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
                  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
                  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
                ]}
                value={sys.dateFormat || null}
                onChange={(v) => setSys((p) => ({ ...p, dateFormat: v ?? "" }))}
                placeholder={t("settings.system.dateFormat")}
              />
            </ERPFormField>
          </ERPFormGrid>
          <ERPFormField label={t("settings.system.maintenanceMode")} hint={t("settings.system.maintenanceNote")}>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sys.isMaintenanceMode}
                onChange={(e) => setSys((p) => ({ ...p, isMaintenanceMode: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300 accent-blue-600 cursor-pointer"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300">
                {sys.isMaintenanceMode ? t("common.active") : t("common.pending")}
              </span>
            </label>
          </ERPFormField>
        </ERPFormSection>
        <SaveBar
          pending={pending}
          onSave={() =>
            save({
              system: {
                language: sys.language,
                refreshInterval: sys.refreshInterval,
                theme: sys.theme,
                dateFormat: sys.dateFormat,
                isMaintenanceMode: sys.isMaintenanceMode,
              },
            })
          }
        />
      </ERPFormLayout>
    </div>
  );
}

// SettingsTab is part of the page contract for future tab extensions.
export type { SettingsTab };
