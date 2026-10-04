"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  CheckCircle2,
  Info,
  Landmark,
  Lock,
  Plus,
  RefreshCw,
  Scale,
  Settings2,
  ShieldAlert,
  Unlock,
  X,
} from "lucide-react";
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

const SETTINGS_SECTION_LABEL: Record<SettingsTab, string> = {
  organization: "settings.tabs.organization",
  financial: "settings.tabs.financial",
  governance: "settings.tabs.governance",
  system: "settings.tabs.system",
};

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
    lateDepositGraceMonths: number;
    inactiveAfterMonths: number;
    suspendedAfterMonths: number;
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

export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { t, setLocale } = useLocale();
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>("organization");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient<SettingsResponse>("/settings"),
    staleTime: 60_000,
  });

  const [org, setOrg] = useState({
    companyName: "",
    companyTagline: "",
    companyAddress: "",
    companyEmail: "",
    companyPhone: "",
    companyWebsite: "",
    companyRegNo: "",
  });

  const [fin, setFin] = useState({
    fiscalYearStart: "",
    fiscalYearEnd: "",
    baseCurrency: "",
    taxRate: "",
    accountingMethod: "",
    shareValueBdt: "",
    withdrawalLimitPercent: "",
    withdrawalNoticeDays: "",
    maxWithdrawalPerRequest: "",
    statutoryReservePercent: "",
  });

  const [gov, setGov] = useState({
    monthlyMeetingDay: "5",
    depositDueDate: "10",
    gracePeriodDays: "3",
    lateDepositGraceMonths: "1",
    inactiveAfterMonths: "3",
    suspendedAfterMonths: "6",
    meetingTypes: [] as string[],
    penaltyRules: [] as PenaltyRule[],
  });

  const [sys, setSys] = useState({
    language: "English",
    refreshInterval: "Real-time",
    theme: "Light",
    dateFormat: "DD/MM/YYYY",
    isMaintenanceMode: false,
  });

  const [shareLocked, setShareLocked] = useState(false);
  const [newMeetingType, setNewMeetingType] = useState("");

  useEffect(() => {
    if (!data) return;
    setOrg({
      companyName: data.organization?.companyName || "InvestWise",
      companyTagline: data.organization?.companyTagline || "",
      companyAddress: data.organization?.companyAddress || "",
      companyEmail: data.organization?.companyEmail || "",
      companyPhone: data.organization?.companyPhone || "",
      companyWebsite: data.organization?.companyWebsite || "",
      companyRegNo: data.organization?.companyRegNo || "",
    });
    setFin({
      fiscalYearStart: data.financial?.fiscalYearStart || "July",
      fiscalYearEnd: data.financial?.fiscalYearEnd || "June",
      baseCurrency: data.financial?.baseCurrency || "BDT",
      taxRate: String(data.financial?.taxRate ?? 15),
      accountingMethod: data.financial?.accountingMethod || "Cash",
      shareValueBdt: String(data.financial?.shareValueBdt ?? 1000),
      withdrawalLimitPercent: String(data.financial?.withdrawalLimitPercent ?? 25),
      withdrawalNoticeDays: String(data.financial?.withdrawalNoticeDays ?? 30),
      maxWithdrawalPerRequest: String(data.financial?.maxWithdrawalPerRequest ?? 100000),
      statutoryReservePercent: String(data.financial?.statutoryReservePercent ?? 10),
    });
    setGov({
      monthlyMeetingDay: String(data.governance?.monthlyMeetingDay ?? 5),
      depositDueDate: String(data.governance?.depositDueDate ?? 10),
      gracePeriodDays: String(data.governance?.gracePeriodDays ?? 3),
      lateDepositGraceMonths: String(data.governance?.lateDepositGraceMonths ?? 1),
      inactiveAfterMonths: String(data.governance?.inactiveAfterMonths ?? 3),
      suspendedAfterMonths: String(data.governance?.suspendedAfterMonths ?? 6),
      meetingTypes: [...(data.governance?.meetingTypes ?? [])],
      penaltyRules: [...(data.governance?.penaltyRules ?? [])],
    });
    setSys({
      language: data.system?.language || "English",
      refreshInterval: data.system?.refreshInterval || "Real-time",
      theme: data.system?.theme || "Light",
      dateFormat: data.system?.dateFormat || "DD/MM/YYYY",
      isMaintenanceMode: Boolean(data.system?.isMaintenanceMode),
    });
    setShareLocked(Boolean(data.financial?.isShareValueLocked));
  }, [data]);

  const isGuest = !authLoading && !user;
  useEffect(() => {
    if (isGuest) router.replace("/login?redirect=/settings");
  }, [isGuest, router]);

  if (isGuest) return null;

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
        setLocale={setLocale}
        setTheme={setTheme}
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
  org: {
    companyName: string;
    companyTagline: string;
    companyAddress: string;
    companyEmail: string;
    companyPhone: string;
    companyWebsite: string;
    companyRegNo: string;
  };
  setOrg: React.Dispatch<React.SetStateAction<BodyProps["org"]>>;
  fin: Record<
    | "fiscalYearStart"
    | "fiscalYearEnd"
    | "baseCurrency"
    | "taxRate"
    | "accountingMethod"
    | "shareValueBdt"
    | "withdrawalLimitPercent"
    | "withdrawalNoticeDays"
    | "maxWithdrawalPerRequest"
    | "statutoryReservePercent",
    string
  >;
  setFin: React.Dispatch<React.SetStateAction<BodyProps["fin"]>>;
  gov: {
    monthlyMeetingDay: string;
    depositDueDate: string;
    gracePeriodDays: string;
    lateDepositGraceMonths: string;
    inactiveAfterMonths: string;
    suspendedAfterMonths: string;
    meetingTypes: string[];
    penaltyRules: PenaltyRule[];
  };
  setGov: React.Dispatch<React.SetStateAction<BodyProps["gov"]>>;
  sys: {
    language: string;
    refreshInterval: string;
    theme: string;
    dateFormat: string;
    isMaintenanceMode: boolean;
  };
  setSys: React.Dispatch<React.SetStateAction<BodyProps["sys"]>>;
  shareLocked: boolean;
  newMeetingType: string;
  setNewMeetingType: (v: string) => void;
  canWrite: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  setLocale: (l: any) => void;
  setTheme: (t: string) => void;
}

function SettingsBody(props: BodyProps) {
  const { tab, setTab, isLoading, isError, isFetching, refetch, canWrite, queryClient } = props;
  const { t } = useLocale();

  const saveMutation = useMutation({
    mutationFn: (args: { section: SettingsTab; payload: Record<string, unknown> }) =>
      apiClient<SettingsResponse>("/settings", {
        method: "PUT",
        body: JSON.stringify(args.payload),
      }),
    onSuccess: (updated, { section }) => {
      queryClient.setQueryData(["settings"], updated);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      const label = t(SETTINGS_SECTION_LABEL[section]);
      toast.success(t("settings.saved", { section: label }));
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
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-5 rounded-xl border border-border/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t("settings.title")}
            </h1>
            <StatusBadge tone="cyan">
              <span className="text-[10px] font-semibold tracking-wider uppercase">ERP Multi-Tenant</span>
            </StatusBadge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("settings.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            loading={isFetching}
            icon={<RefreshCw size={13} />}
          >
            {t("settings.refresh")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border/80 px-1 overflow-x-auto" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap",
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
        <div className="bg-card p-8 rounded-xl border border-border/80 shadow-sm space-y-4">
          <Skeleton width="14rem" height="1.5rem" />
          <Skeleton width="100%" height="3rem" />
          <Skeleton width="100%" height="3rem" />
          <Skeleton width="100%" height="3rem" />
        </div>
      ) : isError ? (
        <div role="alert" className="bg-card p-8 rounded-xl border border-border/80 shadow-sm text-center space-y-3">
          <ShieldAlert className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-sm font-semibold text-foreground">{t("settings.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : !canWrite ? (
        <div role="alert" className="bg-card p-8 rounded-xl border border-border/80 shadow-sm text-center space-y-2">
          <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
          <p className="text-sm font-semibold text-foreground">{t("settings.forbidden")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.forbiddenDetails")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {tab === "organization" && (
            <OrganizationTab
              {...props}
              save={(p) => saveMutation.mutate({ section: "organization", payload: p })}
              pending={saveMutation.isPending}
            />
          )}
          {tab === "financial" && (
            <FinancialTab
              {...props}
              save={(p) => saveMutation.mutate({ section: "financial", payload: p })}
              pending={saveMutation.isPending}
            />
          )}
          {tab === "governance" && (
            <GovernanceTab
              {...props}
              save={(p) => saveMutation.mutate({ section: "governance", payload: p })}
              pending={saveMutation.isPending}
            />
          )}
          {tab === "system" && (
            <SystemTab
              {...props}
              save={(p) => saveMutation.mutate({ section: "system", payload: p })}
              pending={saveMutation.isPending}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SaveBar({ pending, onSave }: { pending: boolean; onSave: () => void }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center justify-between pt-4 border-t border-border/80 mt-6">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <CheckCircle2 size={13} className="text-emerald-500" />
        <span>{t("settings.synced")}</span>
      </div>
      <Button
        variant="primary"
        size="sm"
        loading={pending}
        loadingLabel={t("settings.saving")}
        onClick={onSave}
        icon={<Check size={13} />}
      >
        {t("settings.save")}
      </Button>
    </div>
  );
}

function OrganizationTab({
  org,
  setOrg,
  save,
  pending,
}: BodyProps & { save: (p: Record<string, unknown>) => void; pending: boolean }) {
  const { t } = useLocale();
  const set = (k: keyof BodyProps["org"]) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOrg((prev) => ({ ...prev, [k]: e.target.value }));

  const handleSave = () => {
    if (!org.companyName.trim()) {
      toast.error(t("settings.organization.companyName") + " is required.");
      return;
    }
    save({ organization: org });
  };

  return (
    <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6">
      <ERPFormLayout>
        <ERPFormSection
          title={t("settings.organization.title")}
          description={t("settings.organization.description")}
        >
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
        <SaveBar pending={pending} onSave={handleSave} />
      </ERPFormLayout>
    </div>
  );
}

function FinancialTab({
  fin,
  setFin,
  shareLocked,
  save,
  pending,
}: BodyProps & { save: (p: Record<string, unknown>) => void; pending: boolean }) {
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

  const onSave = () => {
    const baseCurr = fin.baseCurrency.trim().toUpperCase() || "BDT";
    save({
      financial: {
        fiscalYearStart: fin.fiscalYearStart,
        fiscalYearEnd: fin.fiscalYearEnd,
        baseCurrency: baseCurr,
        taxRate: num(fin.taxRate, 0),
        accountingMethod: fin.accountingMethod || "Cash",
        ...(shareLocked ? {} : { shareValueBdt: num(fin.shareValueBdt, 1000) }),
        withdrawalLimitPercent: num(fin.withdrawalLimitPercent, 25),
        withdrawalNoticeDays: int(fin.withdrawalNoticeDays, 30),
        maxWithdrawalPerRequest: num(fin.maxWithdrawalPerRequest, 100000),
        statutoryReservePercent: num(fin.statutoryReservePercent, 10),
      },
    });
  };

  return (
    <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6">
      <ERPFormLayout>
        <ERPFormSection title={t("settings.financial.title")} description={t("settings.financial.description")}>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.financial.fiscalYearStart")}>
              <AppDropdown
                options={monthOptions}
                value={fin.fiscalYearStart || null}
                onChange={(v) => setFin((p) => ({ ...p, fiscalYearStart: v ?? "" }))}
                placeholder={t("erp.fiscalMonth.selectMonth")}
              />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.fiscalYearEnd")}>
              <AppDropdown
                options={monthOptions}
                value={fin.fiscalYearEnd || null}
                onChange={(v) => setFin((p) => ({ ...p, fiscalYearEnd: v ?? "" }))}
                placeholder={t("erp.fiscalMonth.selectMonth")}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid columns={3}>
            <ERPFormField label={t("settings.financial.baseCurrency")}>
              <input
                value={fin.baseCurrency}
                onChange={set("baseCurrency")}
                placeholder="BDT"
                className={inputCls}
              />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.taxRate")}>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={fin.taxRate}
                onChange={set("taxRate")}
                className={inputCls}
              />
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
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                step="0.01"
                value={fin.shareValueBdt}
                onChange={set("shareValueBdt")}
                disabled={shareLocked}
                className={cn(inputCls, "flex-1")}
              />
              <StatusBadge tone={shareLocked ? "slate" : "emerald"}>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  {shareLocked ? <Lock size={12} /> : <Unlock size={12} />}
                  {shareLocked ? t("settings.financial.shareLocked") : t("settings.financial.shareUnlocked")}
                </span>
              </StatusBadge>
            </div>
          </ERPFormField>

          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.financial.withdrawalLimit")}>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={fin.withdrawalLimitPercent}
                onChange={set("withdrawalLimitPercent")}
                className={inputCls}
              />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.withdrawalNotice")}>
              <input
                type="number"
                min="0"
                value={fin.withdrawalNoticeDays}
                onChange={set("withdrawalNoticeDays")}
                className={inputCls}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.financial.maxWithdrawal")}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={fin.maxWithdrawalPerRequest}
                onChange={set("maxWithdrawalPerRequest")}
                className={inputCls}
              />
            </ERPFormField>
            <ERPFormField label={t("settings.financial.statutoryReserve")}>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={fin.statutoryReservePercent}
                onChange={set("statutoryReservePercent")}
                className={inputCls}
              />
            </ERPFormField>
          </ERPFormGrid>
        </ERPFormSection>
        <SaveBar pending={pending} onSave={onSave} />
      </ERPFormLayout>
    </div>
  );
}

function GovernanceTab({
  gov,
  setGov,
  newMeetingType,
  setNewMeetingType,
  save,
  pending,
}: BodyProps & { save: (p: Record<string, unknown>) => void; pending: boolean }) {
  const { t } = useLocale();
  const setNum =
    (
      k:
        | "monthlyMeetingDay"
        | "depositDueDate"
        | "gracePeriodDays"
        | "lateDepositGraceMonths"
        | "inactiveAfterMonths"
        | "suspendedAfterMonths",
    ) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setGov((prev) => ({ ...prev, [k]: e.target.value }));

  const penaltyTypeOptions = [
    { value: "VERBAL_WARNING", label: t("settings.governance.verbal") },
    { value: "FUND_DEDUCTION", label: t("settings.governance.fundDeduction") },
    { value: "SUSPENSION", label: t("settings.governance.suspension") },
  ];

  const onSave = () => {
    const inactive = Math.max(1, parseInt(gov.inactiveAfterMonths, 10) || 3);
    const suspended = Math.max(2, parseInt(gov.suspendedAfterMonths, 10) || 6);

    if (suspended <= inactive) {
      toast.error(
        `Suspension threshold (${suspended} months) must be strictly greater than inactivity threshold (${inactive} months).`,
      );
      return;
    }

    save({
      governance: {
        monthlyMeetingDay: Math.max(1, Math.min(28, parseInt(gov.monthlyMeetingDay, 10) || 1)),
        depositDueDate: Math.max(1, Math.min(28, parseInt(gov.depositDueDate, 10) || 1)),
        gracePeriodDays: Math.max(0, parseInt(gov.gracePeriodDays, 10) || 0),
        lateDepositGraceMonths: Math.max(0, parseInt(gov.lateDepositGraceMonths, 10) || 1),
        inactiveAfterMonths: inactive,
        suspendedAfterMonths: suspended,
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
  };

  return (
    <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6 space-y-6">
      <ERPFormLayout>
        <ERPFormSection
          title={t("settings.governance.title")}
          description={t("settings.governance.description")}
        >
          {/* Cadence & Deposit Deadlines */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
              Cadence & Deposit Deadlines
            </h3>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("settings.governance.monthlyMeetingDay")} hint="Day of the month (1-28)">
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={gov.monthlyMeetingDay}
                  onChange={setNum("monthlyMeetingDay")}
                  className={inputCls}
                />
              </ERPFormField>
              <ERPFormField label={t("settings.governance.depositDueDate")} hint="Monthly deadline (1-28)">
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={gov.depositDueDate}
                  onChange={setNum("depositDueDate")}
                  className={inputCls}
                />
              </ERPFormField>
            </ERPFormGrid>

            <ERPFormGrid columns={2}>
              <ERPFormField label={t("settings.governance.gracePeriodDays")} hint="Buffer for current month">
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={gov.gracePeriodDays}
                  onChange={setNum("gracePeriodDays")}
                  className={inputCls}
                />
              </ERPFormField>
              <ERPFormField
                label={t("settings.governance.lateDepositGraceMonths")}
                hint={t("settings.governance.lateDepositGraceMonthsNote")}
              >
                <input
                  type="number"
                  min="0"
                  max="6"
                  value={gov.lateDepositGraceMonths}
                  onChange={setNum("lateDepositGraceMonths")}
                  className={inputCls}
                />
              </ERPFormField>
            </ERPFormGrid>
          </div>

          {/* Membership Discipline Thresholds */}
          <div className="space-y-4 pt-4 border-t border-border/80">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
              Membership Lifecycle Thresholds
            </h3>
            <ERPFormGrid columns={2}>
              <ERPFormField
                label={t("settings.governance.inactiveAfterMonths")}
                hint={t("settings.governance.inactiveAfterMonthsNote")}
              >
                <input
                  type="number"
                  min="1"
                  max="36"
                  value={gov.inactiveAfterMonths}
                  onChange={setNum("inactiveAfterMonths")}
                  className={inputCls}
                />
              </ERPFormField>
              <ERPFormField
                label={t("settings.governance.suspendedAfterMonths")}
                hint={t("settings.governance.suspendedAfterMonthsNote")}
              >
                <input
                  type="number"
                  min="2"
                  max="60"
                  value={gov.suspendedAfterMonths}
                  onChange={setNum("suspendedAfterMonths")}
                  className={inputCls}
                />
              </ERPFormField>
            </ERPFormGrid>
          </div>
        </ERPFormSection>

        {/* Meeting Classification Types */}
        <ERPFormSection title={t("settings.governance.meetingTypes")} description="Authorized categories for scheduling assembly and governance sessions.">
          <div className="flex flex-wrap gap-2 mb-3">
            {gov.meetingTypes.map((mt) => (
              <span
                key={mt}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/80 text-xs font-medium text-foreground bg-muted/40 shadow-xs"
              >
                {mt}
                <button
                  type="button"
                  aria-label={`Remove ${mt}`}
                  onClick={() =>
                    setGov((p) => ({
                      ...p,
                      meetingTypes: p.meetingTypes.filter((x) => x !== mt),
                    }))
                  }
                  className="text-muted-foreground hover:text-rose-500 transition-colors p-0.5 rounded-full hover:bg-rose-50 dark:hover:bg-rose-950/30"
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
              placeholder="e.g. EXTRAORDINARY_GENERAL_MEETING"
              className={cn(inputCls, "flex-1")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const v = newMeetingType.trim().toUpperCase().replace(/\s+/g, "_");
                  if (v && !gov.meetingTypes.includes(v)) {
                    setGov((p) => ({ ...p, meetingTypes: [...p.meetingTypes, v] }));
                    setNewMeetingType("");
                  }
                }
              }}
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

        {/* Penalty Rules Tier Escalation */}
        <ERPFormSection
          title={t("settings.governance.penaltyRules")}
          description="Graduated disciplinary schedule for meeting absences and governance breaches."
        >
          <div className="space-y-3">
            {gov.penaltyRules.map((rule, idx) => (
              <div
                key={rule.tier}
                className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_1fr_auto] gap-3 items-end p-3.5 rounded-xl border border-border/80 bg-muted/20"
              >
                <div className="pb-2.5">
                  <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-1 rounded">
                    {t("settings.governance.tier", { n: rule.tier })}
                  </span>
                </div>
                <ERPFormField label={t("settings.governance.ruleTitle")}>
                  <input
                    value={rule.title}
                    onChange={(e) =>
                      setGov((p) => ({
                        ...p,
                        penaltyRules: p.penaltyRules.map((r, i) =>
                          i === idx ? { ...r, title: e.target.value } : r,
                        ),
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
                        penaltyRules: p.penaltyRules.map((r, i) =>
                          i === idx ? { ...r, type: v ?? r.type } : r,
                        ),
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
                          i === idx
                            ? { ...r, deductionAmount: parseFloat(e.target.value) || 0 }
                            : r,
                        ),
                      }))
                    }
                    className={inputCls}
                  />
                </ERPFormField>
                <label className="flex items-center gap-2 pb-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!rule.isPercentage}
                    onChange={(e) =>
                      setGov((p) => ({
                        ...p,
                        penaltyRules: p.penaltyRules.map((r, i) =>
                          i === idx ? { ...r, isPercentage: e.target.checked } : r,
                        ),
                      }))
                    }
                    className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                  />
                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                    {t("settings.governance.isPercentage")}
                  </span>
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

function SystemTab({
  sys,
  setSys,
  save,
  pending,
  setLocale,
  setTheme,
}: BodyProps & { save: (p: Record<string, unknown>) => void; pending: boolean }) {
  const { t } = useLocale();

  const languageOptions = [
    { value: "English", label: "English" },
    { value: "Bengali", label: "বাংলা (Bengali)" },
    { value: "Urdu", label: "اردو (Urdu)" },
    { value: "Hindi", label: "हिन्दी (Hindi)" },
  ];

  const themeOptions = [
    { value: "System Default", label: t("settings.system.themeSystem") },
    { value: "Light", label: t("settings.system.themeLight") },
    { value: "Dark", label: t("settings.system.themeDark") },
  ];

  const refreshIntervalOptions = [
    { value: "Real-time", label: t("settings.system.realtime") },
    { value: "1 minute", label: t("settings.system.refreshIntervals.1min") },
    { value: "5 minutes", label: t("settings.system.refreshIntervals.5min") },
    { value: "15 minutes", label: "15 minutes" },
    { value: "30 minutes", label: "30 minutes" },
  ];

  const dateFormatOptions = [
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY (e.g. 31/12/2026)" },
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY (e.g. 12/31/2026)" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD (e.g. 2026-12-31)" },
  ];

  const onSave = () => {
    save({
      system: {
        language: sys.language || "English",
        refreshInterval: sys.refreshInterval || "Real-time",
        theme: sys.theme || "Light",
        dateFormat: sys.dateFormat || "DD/MM/YYYY",
        isMaintenanceMode: sys.isMaintenanceMode,
      },
    });
  };

  return (
    <div className="bg-card rounded-xl border border-border/80 shadow-sm p-6">
      <ERPFormLayout>
        <ERPFormSection title={t("settings.system.title")} description={t("settings.system.description")}>
          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.system.language")}>
              <AppDropdown
                options={languageOptions}
                value={sys.language || null}
                onChange={(v) => {
                  const lang = v ?? "English";
                  setSys((p) => ({ ...p, language: lang }));
                  if (lang === "English") setLocale("en");
                  else if (lang === "Bengali") setLocale("bn");
                  else if (lang === "Urdu") setLocale("ur");
                  else if (lang === "Hindi") setLocale("hi");
                }}
                placeholder={t("settings.system.language")}
              />
            </ERPFormField>
            <ERPFormField label={t("settings.system.theme")}>
              <AppDropdown
                options={themeOptions}
                value={sys.theme || null}
                onChange={(v) => {
                  const theme = v ?? "Light";
                  setSys((p) => ({ ...p, theme }));
                  if (theme === "Dark") setTheme("dark");
                  else if (theme === "Light") setTheme("light");
                  else setTheme("system");
                }}
                placeholder={t("settings.system.theme")}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormGrid columns={2}>
            <ERPFormField label={t("settings.system.refreshInterval")}>
              <AppDropdown
                options={refreshIntervalOptions}
                value={sys.refreshInterval || null}
                onChange={(v) => setSys((p) => ({ ...p, refreshInterval: v ?? "" }))}
                placeholder={t("settings.system.refreshInterval")}
              />
            </ERPFormField>
            <ERPFormField label={t("settings.system.dateFormat")}>
              <AppDropdown
                options={dateFormatOptions}
                value={sys.dateFormat || null}
                onChange={(v) => setSys((p) => ({ ...p, dateFormat: v ?? "" }))}
                placeholder={t("settings.system.dateFormat")}
              />
            </ERPFormField>
          </ERPFormGrid>

          <ERPFormField
            label={t("settings.system.maintenanceMode")}
            hint={t("settings.system.maintenanceNote")}
          >
            <div className="flex items-center gap-3 p-3.5 rounded-lg border border-border/80 bg-muted/20">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sys.isMaintenanceMode}
                  onChange={(e) => setSys((p) => ({ ...p, isMaintenanceMode: e.target.checked }))}
                  className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
                />
                <span className="text-xs font-medium text-foreground">
                  {sys.isMaintenanceMode ? "Enabled (Restricted Access)" : "Disabled (Standard Operations)"}
                </span>
              </label>
              <StatusBadge tone={sys.isMaintenanceMode ? "rose" : "emerald"}>
                {sys.isMaintenanceMode ? t("common.active") : "Normal"}
              </StatusBadge>
            </div>
          </ERPFormField>
        </ERPFormSection>
        <SaveBar pending={pending} onSave={onSave} />
      </ERPFormLayout>
    </div>
  );
}

export type { SettingsTab };
