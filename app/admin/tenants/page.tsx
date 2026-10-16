"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import {
  CURRENCIES,
  DATE_FORMATS,
  DEFAULT_CURRENCY,
  DEFAULT_DATE_FORMAT,
  DEFAULT_FISCAL_YEAR_END,
  DEFAULT_FISCAL_YEAR_START,
  DEFAULT_SHARE_VALUE,
  FISCAL_MONTHS,
  MAX_EXTRA_FUNDS,
  SIGNUP_FUND_TYPES,
  passwordStrengthScore,
} from "@/lib/org-setup";
import { fundTypeLabelKey } from "@/components/funds/shared";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { ERPDataTable, type ERPColumn } from "@/components/ui/erp-data-table";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { TopSheet } from "@/components/ui/top-sheet";
import { Button, Input } from "@/components/ui";
import {
  ERPFormField,
  ERPFormGrid,
  ERPFormLayout,
  ERPFormSection,
} from "@/components/ui/erp-form-layout";
import { NumericInput } from "@/components/ui/numeric-input";
import { cn } from "@/lib/utils";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  isMaintenanceMode: boolean;
  maxUsers: number;
  createdAt: string;
  userCount?: number;
}

interface TenantListResponse {
  data: Tenant[];
  meta: { total: number; page: number; limit: number; pages: number };
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

// ── Onboarding form (#105) ──────────────────────────────────────────
// Mirrors the public signup page field-for-field and lib/tenant-provision.ts
// rule-for-rule (SLUG_PATTERN, SHARE_VALUE_RE, fiscal-month vocabulary), so
// the SuperAdmin panel validates exactly what provisioning accepts and the
// two onboarding paths cannot drift.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const SHARE_VALUE_RE = /^\d{1,10}(\.\d{1,2})?$/;
const MAX_USERS_RE = /^\d{1,6}$/;

const onboardSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().regex(SLUG_RE, "slugInvalid"),
    plan: z.string().min(1),
    maxUsers: z.string().trim().regex(MAX_USERS_RE, "maxUsersInvalid"),
    adminName: z.string().trim().max(120),
    adminEmail: z.string().trim().min(5).max(254).email(),
    adminPassword: z.string().min(8),
    confirmPassword: z.string().min(1),
    baseCurrency: z.string().min(1),
    shareValue: z.string().trim().regex(SHARE_VALUE_RE, "shareValue"),
    dateFormat: z.string().min(1),
    fiscalYearStart: z.string().min(1),
    fiscalYearEnd: z.string().min(1),
  })
  .refine((v) => v.adminPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "confirmPassword",
  })
  .refine((v) => v.fiscalYearStart !== v.fiscalYearEnd, {
    path: ["fiscalYearEnd"],
    message: "fiscalYearEnd",
  });

type OnboardForm = z.infer<typeof onboardSchema>;

// Same URL-safe derivation lib/tenant-provision.ts applies when the slug is
// left blank, so the editable preview shows what the server would have chosen.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

const DEFAULT_ONBOARD_FORM: OnboardForm = {
  name: "",
  slug: "",
  plan: "standard",
  maxUsers: "100",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
  confirmPassword: "",
  baseCurrency: DEFAULT_CURRENCY,
  shareValue: DEFAULT_SHARE_VALUE,
  dateFormat: DEFAULT_DATE_FORMAT,
  fiscalYearStart: DEFAULT_FISCAL_YEAR_START,
  fiscalYearEnd: DEFAULT_FISCAL_YEAR_END,
};

export default function AdminTenantsPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // Onboarding form state (#105): react-hook-form + zod, an extra-funds list
  // and a success view — the same shape as the public signup page.
  const [onboarded, setOnboarded] = useState<{ name: string; email: string } | null>(null);
  const [extraFunds, setExtraFunds] = useState<{ name: string; type: string }[]>([]);
  const [slugEdited, setSlugEdited] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirm, setConfirm] = useState<{ tenant: Tenant; action: "suspend" | "delete" } | null>(null);

  const { data, isLoading } = useQuery<TenantListResponse>({
    queryKey: ["admin", "tenants", { page, pageSize, search }],
    queryFn: () =>
      apiClient<TenantListResponse>("/admin/tenants", { params: { page, limit: pageSize, search } }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
    void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
  };

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiClient(`/admin/tenants/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      toast.success(t("admin.tenants.updated", { defaultValue: "Tenant updated" }));
    },
    onError: (err) => toast.error(errMsg(err, t("admin.tenants.updateFailed", { defaultValue: "Update failed" }))),
  });

  // Full onboarding: tenant + org-admin login + settings + 14-day trial in one
  // transaction (POST /admin/tenants/onboard). The plain tenant-create endpoint
  // leaves a tenant with no admin user and no subscription, so the panel only
  // exposes the complete flow. Since #105 the payload also carries the
  // financial configuration and optional extra funds — the same fields public
  // signup offers — all deep-validated by provisioning.
  const onboardForm = useForm<OnboardForm>({
    resolver: zodResolver(onboardSchema) as any,
    defaultValues: DEFAULT_ONBOARD_FORM,
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = onboardForm;

  // Plan options come from the billing catalogue; a catalogue that cannot be
  // loaded degrades to the default plan rather than blocking onboarding.
  const { data: plansData } = useQuery<{ data: { slug: string; name: string; isActive: boolean }[] }>({
    queryKey: ["admin", "plans"],
    queryFn: () => apiClient<{ data: { slug: string; name: string; isActive: boolean }[] }>("/admin/plans"),
    staleTime: 60_000,
  });

  const planOptions: DropdownOption[] = useMemo(() => {
    const rows = (plansData?.data ?? []).filter((p) => p.isActive !== false);
    const opts = rows.map((p) => ({ value: p.slug, label: p.name }));
    return opts.length > 0 ? opts : [{ value: "standard", label: "standard" }];
  }, [plansData]);

  const currencyOptions: DropdownOption[] = useMemo(() => CURRENCIES.map((c) => ({ ...c })), []);
  const dateFormatOptions: DropdownOption[] = useMemo(() => DATE_FORMATS.map((f) => ({ value: f, label: f })), []);
  const monthOptions: DropdownOption[] = useMemo(
    () => FISCAL_MONTHS.map(({ short, full }) => ({ value: full, label: t(`common.months.${short}`) })),
    [t],
  );
  const fundTypeOptions: DropdownOption[] = useMemo(
    () => SIGNUP_FUND_TYPES.map((v) => ({ value: v, label: t(fundTypeLabelKey(v)) })),
    [t],
  );

  // Auto-derive the slug from the organization name until the operator edits
  // it — the same derivation provisioning would apply if the field were blank.
  const orgName = watch("name") ?? "";
  useEffect(() => {
    if (!createOpen || slugEdited) return;
    setValue("slug", slugify(orgName), { shouldValidate: false });
  }, [orgName, slugEdited, createOpen, setValue]);

  const adminPassword = watch("adminPassword") ?? "";
  const score = passwordStrengthScore(adminPassword);
  const strengthLabel =
    score <= 1
      ? t("auth.signup.strengthWeak")
      : score === 2
        ? t("auth.signup.strengthFair")
        : score === 3
          ? t("auth.signup.strengthGood")
          : t("auth.signup.strengthStrong");
  const strengthTone =
    score <= 1 ? "bg-rose-500" : score === 2 ? "bg-amber-500" : score === 3 ? "bg-cyan-500" : "bg-emerald-500";

  const resetOnboard = () => {
    reset(DEFAULT_ONBOARD_FORM);
    setExtraFunds([]);
    setOnboarded(null);
    setSlugEdited(false);
    setShowPassword(false);
  };

  const onboardSubmit = handleSubmit(async (values) => {
    try {
      await apiClient("/admin/tenants/onboard", {
        method: "POST",
        body: JSON.stringify({
          name: values.name.trim(),
          slug: values.slug.trim(),
          plan: values.plan,
          ...(values.maxUsers.trim() ? { maxUsers: Number(values.maxUsers) } : {}),
          ...(values.adminName.trim() ? { adminName: values.adminName.trim() } : {}),
          adminEmail: values.adminEmail.trim(),
          adminPassword: values.adminPassword,
          // Same financial block signup sends; provisioning validates it and
          // falls back to platform defaults for anything omitted.
          financial: {
            baseCurrency: values.baseCurrency,
            shareValue: values.shareValue.trim(),
            dateFormat: values.dateFormat,
            fiscalYearStart: values.fiscalYearStart,
            fiscalYearEnd: values.fiscalYearEnd,
          },
          // Only complete rows leave the browser; opening balances are never
          // taken from the client (§12).
          funds: extraFunds
            .filter((f) => f.name.trim().length > 0 && f.type.length > 0)
            .map((f) => ({ name: f.name.trim(), type: f.type })),
        }),
      });
      invalidate();
      setOnboarded({ name: values.name.trim(), email: values.adminEmail.trim() });
      toast.success(t("admin.tenants.onboarded", { defaultValue: "Tenant onboarded" }));
    } catch (err) {
      // Unmasked server message (Rule §11) — a taken slug, a duplicate email or
      // an unknown plan must be readable, not "Something went wrong".
      toast.error(errMsg(err, t("admin.tenants.onboardFailed", { defaultValue: "Onboarding failed" })));
    }
  });

  // The dialog is explicitly destructive, so this is the platform wipe
  // (?force=true) rather than the guarded delete that refuses while the
  // tenant still has users or business data.
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/admin/tenants/${id}`, { method: "DELETE", params: { force: true } }),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      toast.success(t("admin.tenants.deleted", { defaultValue: "Tenant deleted" }));
    },
    onError: (err) => toast.error(errMsg(err, t("admin.tenants.deleteFailed", { defaultValue: "Delete failed" }))),
  });

  const busy = patchMutation.isPending || deleteMutation.isPending;

  const columns: ERPColumn<Tenant>[] = [
    {
      key: "name",
      header: t("admin.tenants.name", { defaultValue: "Tenant" }),
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={`/admin/tenants/${row.id}`}
            className="text-xs font-semibold text-foreground hover:text-primary transition-colors hover:underline truncate block"
          >
            {row.name}
          </Link>
          <p className="text-[11px] text-muted-foreground font-mono truncate">{row.slug}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: t("admin.tenants.plan", { defaultValue: "Plan" }),
      render: (row) => <span className="text-xs text-slate-600 dark:text-slate-300">{row.plan}</span>,
    },
    {
      key: "users",
      header: t("admin.tenants.users", { defaultValue: "Users" }),
      align: "right",
      render: (row) => <span className="text-xs tabular-nums">{row.userCount ?? "—"}</span>,
    },
    {
      key: "status",
      header: t("admin.tenants.status", { defaultValue: "Status" }),
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={row.status === "active" ? "emerald" : "rose"} label={row.status} />
          {row.isMaintenanceMode && <StatusBadge tone="amber" label="maintenance" />}
        </div>
      ),
    },
    {
      key: "actions",
      header: t("admin.tenants.actions", { defaultValue: "Actions" }),
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            disabled={busy}
            title={row.status === "active" ? "Suspend" : "Activate"}
            onClick={() =>
              row.status === "active"
                ? setConfirm({ tenant: row, action: "suspend" })
                : patchMutation.mutate({ id: row.id, body: { status: "active" } })
            }
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {row.status === "active" ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
          </button>
          <button
            type="button"
            disabled={busy}
            title="Toggle maintenance"
            onClick={() => patchMutation.mutate({ id: row.id, body: { isMaintenanceMode: !row.isMaintenanceMode } })}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Wrench size={15} />
          </button>
          <button
            type="button"
            disabled={busy}
            title="Force delete"
            onClick={() => setConfirm({ tenant: row, action: "delete" })}
            className="p-1.5 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel")}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground">
            {t("admin.tenants.title", { defaultValue: "Tenants" })}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("admin.tenants.search", { defaultValue: "Search tenants…" })}
            className="w-52 h-9 text-xs"
          />
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
          >
            <Plus size={14} />
            {t("admin.tenants.create", { defaultValue: "New Tenant" })}
          </Button>
        </div>
      </div>

      <ERPDataTable<Tenant>
        data={data?.data ?? []}
        columns={columns}
        loading={isLoading}
        rowKey={(row) => row.id}
        page={page}
        pageSize={pageSize}
        totalCount={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyMessage={t("admin.tenants.empty", { defaultValue: "No tenants found" })}
      />

      <TopSheet
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("admin.tenants.onboardTitle", { defaultValue: "Onboard tenant" })}
        isDirty={!onboarded && (onboardForm.formState.isDirty || extraFunds.length > 0)}
        onDiscard={() => {
          setCreateOpen(false);
          resetOnboard();
        }}
        wide
        footer={
          onboarded ? (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setCreateOpen(false);
                  resetOnboard();
                }}
              >
                {t("admin.tenants.onboardDone", { defaultValue: "Done" })}
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button
                type="submit"
                form="onboard-tenant-form"
                size="sm"
                loading={isSubmitting}
                disabled={isSubmitting}
              >
                {t("admin.tenants.onboardSubmit", { defaultValue: "Onboard tenant" })}
              </Button>
            </div>
          )
        }
      >
        <p className="px-4 pt-4 text-xs text-muted-foreground">
          {t("admin.tenants.onboardDesc", {
            defaultValue:
              "Creates the tenant, its admin login, settings and a 14-day trial in one step.",
          })}
        </p>

        {onboarded ? (
          <div className="p-4">
            <div
              role="status"
              className="flex items-start gap-2.5 px-4 py-4 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm"
            >
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{t("admin.tenants.onboardSuccessTitle", { defaultValue: "Tenant onboarded" })}</p>
                <p className="text-xs mt-0.5 opacity-80">
                  {t("admin.tenants.onboardSuccessDesc", {
                    defaultValue: "{name} is ready — the org admin can sign in with the credentials you set.",
                    name: onboarded.name,
                    email: onboarded.email,
                  })}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <form id="onboard-tenant-form" method="post" onSubmit={onboardSubmit} noValidate>
            <ERPFormLayout className="px-4 pb-4 pt-2">
              <ERPFormSection title={t("auth.signup.accountSection", { defaultValue: "Account" })}>
                <ERPFormGrid columns={2}>
                  <ERPFormField
                    label={t("auth.signup.orgName", { defaultValue: "Organization name" })}
                    required
                    error={errors.name ? t("auth.signup.orgNameRequired", { defaultValue: "Organization name is required" }) : undefined}
                  >
                    <input
                      type="text"
                      autoComplete="organization"
                      placeholder={t("auth.signup.orgNamePlaceholder", { defaultValue: "Acme Investments Ltd." })}
                      {...register("name")}
                      className={inputCls}
                    />
                  </ERPFormField>
                  <ERPFormField
                    label={t("admin.tenants.fieldSlug", { defaultValue: "Slug" })}
                    required
                    hint={t("admin.tenants.slugAutoHint", { defaultValue: "Auto-generated from the organization name — editable." })}
                    error={errors.slug ? t("admin.tenants.slugInvalid", { defaultValue: "Use lowercase letters, digits and hyphens (3–63 characters)." }) : undefined}
                  >
                    <input
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="acme-investments"
                      {...register("slug", { onChange: () => setSlugEdited(true) })}
                      className={cn(inputCls, "font-mono")}
                    />
                  </ERPFormField>
                </ERPFormGrid>

                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("admin.tenants.fieldPlan", { defaultValue: "Plan" })} required>
                    <AppDropdown
                      options={planOptions}
                      value={watch("plan") || null}
                      onChange={(v) => setValue("plan", v ?? "standard", { shouldValidate: true })}
                      clearable={false}
                      placeholder={t("admin.tenants.fieldPlan", { defaultValue: "Plan" })}
                    />
                  </ERPFormField>
                  <ERPFormField
                    label={t("admin.tenants.fieldMaxUsers", { defaultValue: "Max users" })}
                    required
                    error={errors.maxUsers ? t("admin.tenants.maxUsersInvalid", { defaultValue: "Enter a whole number between 1 and 100000." }) : undefined}
                  >
                    <NumericInput
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="100"
                      {...register("maxUsers")}
                      className={cn(inputCls, "font-mono")}
                    />
                  </ERPFormField>
                </ERPFormGrid>

                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("admin.tenants.adminName", { defaultValue: "Admin name" })}>
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder={t("auth.signup.adminNamePlaceholder", { defaultValue: "Full name" })}
                      {...register("adminName")}
                      className={inputCls}
                    />
                  </ERPFormField>
                  <ERPFormField
                    label={t("admin.tenants.adminEmail", { defaultValue: "Admin email" })}
                    required
                    error={errors.adminEmail ? t("auth.login.emailInvalid", { defaultValue: "Enter a valid email address" }) : undefined}
                  >
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="admin@acme-investments.com"
                      {...register("adminEmail")}
                      className={inputCls}
                    />
                  </ERPFormField>
                </ERPFormGrid>

                <ERPFormGrid columns={2}>
                  <ERPFormField
                    label={t("admin.tenants.adminPassword", { defaultValue: "Admin password" })}
                    required
                    error={errors.adminPassword ? t("auth.signup.strengthHint", { defaultValue: "At least 8 characters with upper, lower, digit and special." }) : undefined}
                  >
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        {...register("adminPassword")}
                        className={cn(inputCls, "pr-10")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        tabIndex={-1}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    {adminPassword.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="flex gap-1" aria-hidden="true">
                          {[0, 1, 2, 3].map((i) => (
                            <span
                              key={i}
                              className={cn("h-1.5 flex-1 rounded-full", i < score ? strengthTone : "bg-slate-200 dark:bg-slate-700")}
                            />
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {strengthLabel} — {t("auth.signup.strengthHint", { defaultValue: "At least 8 characters with upper, lower, digit and special." })}
                        </p>
                      </div>
                    )}
                  </ERPFormField>
                  <ERPFormField
                    label={t("auth.signup.confirmPassword", { defaultValue: "Confirm password" })}
                    required
                    error={errors.confirmPassword ? t("auth.signup.passwordMismatch", { defaultValue: "Passwords do not match" }) : undefined}
                  >
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      {...register("confirmPassword")}
                      className={inputCls}
                    />
                  </ERPFormField>
                </ERPFormGrid>
              </ERPFormSection>

              <ERPFormSection
                title={t("settings.financial.title", { defaultValue: "Financial configuration" })}
                description={t("auth.signup.financialSectionHint", { defaultValue: "Pre-filled with the platform defaults — everything is editable later in Settings." })}
              >
                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("settings.financial.baseCurrency", { defaultValue: "Base currency" })} required>
                    <AppDropdown
                      options={currencyOptions}
                      value={watch("baseCurrency") || DEFAULT_CURRENCY}
                      onChange={(v) => setValue("baseCurrency", v ?? DEFAULT_CURRENCY, { shouldValidate: true })}
                      clearable={false}
                      placeholder={t("auth.signup.selectCurrency", { defaultValue: "Select currency" })}
                    />
                  </ERPFormField>
                  <ERPFormField
                    label={t("auth.signup.shareValue", { defaultValue: "Share value ({currency})", currency: watch("baseCurrency") || DEFAULT_CURRENCY })}
                    required
                    hint={t("auth.signup.shareValueHint", { defaultValue: "Value of one share in the base currency." })}
                    error={errors.shareValue ? t("auth.signup.invalidAmount", { defaultValue: "Enter a valid amount" }) : undefined}
                  >
                    <NumericInput
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="1000.00"
                      {...register("shareValue")}
                      className={cn(inputCls, "font-mono")}
                    />
                  </ERPFormField>
                </ERPFormGrid>

                <ERPFormGrid columns={3}>
                  <ERPFormField label={t("settings.system.dateFormat", { defaultValue: "Date format" })} required>
                    <AppDropdown
                      options={dateFormatOptions}
                      value={watch("dateFormat") || DEFAULT_DATE_FORMAT}
                      onChange={(v) => setValue("dateFormat", v ?? DEFAULT_DATE_FORMAT, { shouldValidate: true })}
                      clearable={false}
                    />
                  </ERPFormField>
                  <ERPFormField label={t("settings.financial.fiscalYearStart", { defaultValue: "Fiscal year start" })} required>
                    <AppDropdown
                      options={monthOptions}
                      value={watch("fiscalYearStart") || null}
                      onChange={(v) => setValue("fiscalYearStart", v ?? "", { shouldValidate: true })}
                      clearable={false}
                      placeholder={t("erp.fiscalMonth.selectMonth", { defaultValue: "Select month" })}
                    />
                  </ERPFormField>
                  <ERPFormField
                    label={t("settings.financial.fiscalYearEnd", { defaultValue: "Fiscal year end" })}
                    required
                    error={errors.fiscalYearEnd ? t("auth.signup.fiscalYearMismatch", { defaultValue: "Fiscal year start and end must differ" }) : undefined}
                  >
                    <AppDropdown
                      options={monthOptions}
                      value={watch("fiscalYearEnd") || null}
                      onChange={(v) => setValue("fiscalYearEnd", v ?? "", { shouldValidate: true })}
                      clearable={false}
                      placeholder={t("erp.fiscalMonth.selectMonth", { defaultValue: "Select month" })}
                    />
                  </ERPFormField>
                </ERPFormGrid>
              </ERPFormSection>

              <ERPFormSection
                title={t("auth.signup.fundsSectionTitle", { defaultValue: "Additional funds" })}
                description={t("auth.signup.fundsSectionHint", { defaultValue: "Optional extra funds layered on top of the standard set." })}
              >
                {extraFunds.map((fund, index) => (
                  <ERPFormGrid columns={2} key={index}>
                    <ERPFormField label={t("funds.modal.name", { defaultValue: "Fund name" })}>
                      <input
                        type="text"
                        autoComplete="off"
                        placeholder={t("funds.modal.namePlaceholder", { defaultValue: "Fund name" })}
                        value={fund.name}
                        onChange={(e) =>
                          setExtraFunds((prev) =>
                            prev.map((f, i) => (i === index ? { ...f, name: e.target.value } : f)),
                          )
                        }
                        className={inputCls}
                      />
                    </ERPFormField>
                    <ERPFormField label={t("funds.modal.type", { defaultValue: "Fund type" })}>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <AppDropdown
                            options={fundTypeOptions}
                            value={fund.type || null}
                            onChange={(v) =>
                              setExtraFunds((prev) =>
                                prev.map((f, i) => (i === index ? { ...f, type: v ?? "" } : f)),
                              )
                            }
                            placeholder={t("funds.modal.selectType", { defaultValue: "Select type" })}
                          />
                        </div>
                        <button
                          type="button"
                          aria-label={t("auth.signup.removeFund", { defaultValue: "Remove fund" })}
                          onClick={() => setExtraFunds((prev) => prev.filter((_, i) => i !== index))}
                          className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </ERPFormField>
                  </ERPFormGrid>
                ))}
                {extraFunds.length < MAX_EXTRA_FUNDS && (
                  <button
                    type="button"
                    onClick={() => setExtraFunds((prev) => [...prev, { name: "", type: "" }])}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:opacity-75 transition-opacity"
                  >
                    <Plus size={14} />
                    {t("auth.signup.addFund", { defaultValue: "Add fund" })}
                  </button>
                )}
              </ERPFormSection>

              <p className="text-center text-xs text-muted-foreground">
                <Building2 size={12} className="inline mr-1 -mt-0.5" />
                {t("auth.signup.adminNote", { defaultValue: "The first user becomes the organization Admin." })}
              </p>
            </ERPFormLayout>
          </form>
        )}
      </TopSheet>

      <ERPConfirmDialog
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm?.action === "delete"
            ? t("admin.tenants.deleteTitle", { defaultValue: "Force delete tenant?" })
            : t("admin.tenants.suspendTitle", { defaultValue: "Suspend tenant?" })
        }
        description={
          confirm?.action === "delete"
            ? t("admin.tenants.deleteDesc", {
                defaultValue: "This irreversibly wipes all tenant data. The default tenant is protected.",
              })
            : t("admin.tenants.suspendDesc", {
                defaultValue: "Users in this tenant will be blocked until reactivated.",
              })
        }
        confirmLabel={
          confirm?.action === "delete"
            ? t("common.delete", { defaultValue: "Delete" })
            : t("admin.tenants.suspend", { defaultValue: "Suspend" })
        }
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="destructive"
        pending={patchMutation.isPending || deleteMutation.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.action === "delete") deleteMutation.mutate(confirm.tenant.id);
          else patchMutation.mutate({ id: confirm.tenant.id, body: { status: "suspended" } });
        }}
      />
    </div>
  );
}
