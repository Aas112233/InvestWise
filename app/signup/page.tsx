"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, CheckCircle2, Eye, EyeOff, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { fundTypeLabelKey } from "@/components/funds/shared";
import { ApiError, apiClient } from "@/lib/api-client";
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
} from "@/lib/org-setup";
import { cn } from "@/lib/utils";
import {
  ERPFormField,
  ERPFormGrid,
  ERPFormLayout,
  ERPFormSection,
} from "@/components/ui/erp-form-layout";

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
}

type WindowWithTurnstile = Window & { turnstile?: TurnstileApi };

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const TURNSTILE_SCRIPT_ID = "cf-turnstile-api";

// Mirrors SHARE_VALUE_RE in app/api/auth/signup/route.ts and the decimal(15,2)
// column: money is captured, validated and sent as a string, never a float.
const SHARE_VALUE_RE = /^\d{1,10}(\.\d{1,2})?$/;

const signupSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(120),
    adminName: z.string().trim().min(2).max(120),
    email: z.string().trim().min(5).max(254).email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(1),
    baseCurrency: z.string().min(1),
    shareValue: z.string().trim().regex(SHARE_VALUE_RE, "amount"),
    dateFormat: z.string().min(1),
    fiscalYearStart: z.string().min(1),
    fiscalYearEnd: z.string().min(1),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "passwordMismatch",
  })
  .refine((v) => v.fiscalYearStart !== v.fiscalYearEnd, {
    path: ["fiscalYearEnd"],
    message: "fiscalYearMismatch",
  });

type SignupForm = z.infer<typeof signupSchema>;

// Mirrors validatePasswordStrength (lib/utils/password.ts) so the meter tells
// the truth about what the server will accept: 8+ chars, upper, lower, digit,
// special. Duplicated from app/register deliberately — the two pages are on
// different flows and a shared meter is not worth a new module yet.
function strengthScore(password: string): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[@$!%*?&#^()_+\-=[\]{}|;:,.<>/~`]/.test(password)) score += 1;
  return score;
}

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

// Public self-serve onboarding: creates a tenant, its first Admin, its standard
// institutional funds and its financial configuration (currency, share value,
// date format, fiscal year) in one call — POST /api/auth/signup. It does not
// sign anyone in; the visitor lands on /login and authenticates through the
// audited path.
//
// The financial fields arrive pre-set to the platform defaults rather than
// blank. That is a deliberate exception to AGENTS.md §15 (no pre-selections):
// §15 guards money entry against guessed values in the ledger screens, whereas
// these are reversible configuration the owner can change in Settings, and a
// first-time organization owner is exactly the person who should not have to
// invent a share value.
//
// Bot protection is enforced at the API. When NEXT_PUBLIC_TURNSTILE_SITE_KEY is
// configured the widget renders and submit stays disabled until it yields a
// token; in production the endpoint refuses signup without one.
export default function SignupPage() {
  const { t } = useLocale();
  const [showPassword, setShowPassword] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  // Optional extra funds named at signup, layered on top of the standard seeded
  // set. Managed outside RHF because they are an unbounded-length list of
  // optional rows; only name + type leave the browser, and the server ignores
  // anything incomplete and re-validates the rest.
  const [extraFunds, setExtraFunds] = useState<{ name: string; type: string }[]>([]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const widgetRef = useRef<HTMLDivElement>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  useEffect(() => {
    if (!siteKey || typeof window === "undefined") return;
    const w = window as WindowWithTurnstile;
    let cancelled = false;

    const render = () => {
      if (cancelled || !w.turnstile || !widgetRef.current) return;
      w.turnstile.render(widgetRef.current, {
        sitekey: siteKey,
        appearance: "always",
        callback: (token: string) => setCaptchaToken(token),
        // Tokens are single use: clear ours whenever Cloudflare retires one,
        // so a retry always submits a fresh proof instead of a dead token.
        "expired-callback": () => setCaptchaToken(null),
        "error-callback": () => setCaptchaToken(null),
      });
    };

    if (w.turnstile) {
      render();
      return () => {
        cancelled = true;
      };
    }

    let script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = `${TURNSTILE_SRC}?render=explicit`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => {
      cancelled = true;
      script?.removeEventListener("load", render);
    };
  }, [siteKey]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema) as any,
    defaultValues: {
      organizationName: "",
      adminName: "",
      email: "",
      password: "",
      confirmPassword: "",
      baseCurrency: DEFAULT_CURRENCY,
      shareValue: DEFAULT_SHARE_VALUE,
      dateFormat: DEFAULT_DATE_FORMAT,
      fiscalYearStart: DEFAULT_FISCAL_YEAR_START,
      fiscalYearEnd: DEFAULT_FISCAL_YEAR_END,
    },
  });

  const password = watch("password") ?? "";
  const baseCurrency = watch("baseCurrency") ?? DEFAULT_CURRENCY;
  const dateFormat = watch("dateFormat") ?? DEFAULT_DATE_FORMAT;
  const fiscalYearStart = watch("fiscalYearStart") ?? "";
  const fiscalYearEnd = watch("fiscalYearEnd") ?? "";
  const score = strengthScore(password);
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

  const currencyOptions: DropdownOption[] = useMemo(() => CURRENCIES.map((c) => ({ ...c })), []);
  const dateFormatOptions: DropdownOption[] = useMemo(
    () => DATE_FORMATS.map((f) => ({ value: f, label: f })),
    [],
  );
  // Same value/label pairing the tenant Settings screen uses: the stored value
  // is the English month name, the label is localized.
  const monthOptions: DropdownOption[] = useMemo(
    () => FISCAL_MONTHS.map(({ short, full }) => ({ value: full, label: t(`common.months.${short}`) })),
    [t],
  );
  // Same label source the Funds screen uses, so a signup type reads identically
  // after login (reuses funds.types.* rather than a new vocabulary).
  const fundTypeOptions: DropdownOption[] = useMemo(
    () => SIGNUP_FUND_TYPES.map((v) => ({ value: v, label: t(fundTypeLabelKey(v)) })),
    [t],
  );

  const onSubmit = async (values: SignupForm) => {
    try {
      await apiClient<{ success: boolean; message?: string }>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          organizationName: values.organizationName.trim(),
          adminName: values.adminName.trim(),
          email: values.email.trim(),
          password: values.password,
          confirmPassword: values.confirmPassword,
          baseCurrency: values.baseCurrency,
          shareValue: values.shareValue.trim(),
          dateFormat: values.dateFormat,
          fiscalYearStart: values.fiscalYearStart,
          fiscalYearEnd: values.fiscalYearEnd,
          // Send only rows the owner actually filled (name + type). Opening
          // balances are never taken from the client (§12).
          funds: extraFunds
            .filter((f) => f.name.trim().length > 0 && f.type.length > 0)
            .map((f) => ({ name: f.name.trim(), type: f.type })),
          turnstileToken: captchaToken ?? undefined,
        }),
      });
      // Localized copy is authoritative; the server `message` is an English
      // duplicate and would defeat ur/hi/bn.
      setCreated(values.email.trim());
      toast.success(t("auth.signup.successTitle"));
    } catch (err) {
      // Unmasked server message (Rule §11) — a rejected email, a closed
      // registration or a rate limit must be readable, not "Something went
      // wrong". Any failed attempt also retires the captcha token server-side,
      // so ask for a new one.
      toast.error(err instanceof ApiError ? err.message : t("auth.signup.failed"));
      if (siteKey) {
        setCaptchaToken(null);
        (window as WindowWithTurnstile).turnstile?.reset();
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-2xl bg-card rounded-2xl border border-border/80 shadow-sm p-8">
        <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
          <Building2 size={20} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("auth.signup.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 mb-6">{t("auth.signup.subtitle")}</p>

        {created ? (
          <div className="space-y-5">
            <div
              role="status"
              className="flex items-start gap-2.5 px-4 py-4 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm"
            >
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{t("auth.signup.successTitle")}</p>
                <p className="text-xs mt-0.5 opacity-80">{t("auth.signup.successDetails", { email: created })}</p>
              </div>
            </div>
            <Link
              href="/login"
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:opacity-90 text-primary-foreground text-sm font-medium transition-opacity"
            >
              <ShieldCheck size={15} />
              {t("auth.signup.signIn")}
            </Link>
          </div>
        ) : (
          <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
            <ERPFormLayout>
              <ERPFormSection title={t("auth.signup.accountSection")}>
                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("auth.signup.orgName")} required error={errors.organizationName ? t("auth.signup.orgNameRequired") : undefined}>
                    <input
                      type="text"
                      autoComplete="organization"
                      placeholder={t("auth.signup.orgNamePlaceholder")}
                      {...register("organizationName")}
                      className={inputCls}
                    />
                  </ERPFormField>
                  <ERPFormField label={t("auth.signup.adminName")} required error={errors.adminName ? t("auth.signup.nameRequired") : undefined}>
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder={t("auth.signup.adminNamePlaceholder")}
                      {...register("adminName")}
                      className={inputCls}
                    />
                  </ERPFormField>
                </ERPFormGrid>

                <ERPFormField label={t("auth.signup.email")} required error={errors.email ? t("auth.login.emailInvalid") : undefined}>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder={t("auth.login.emailPlaceholder")}
                    {...register("email")}
                    className={inputCls}
                  />
                </ERPFormField>

                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("auth.signup.password")} required error={errors.password ? t("auth.signup.strengthHint") : undefined}>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        {...register("password")}
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
                    {password.length > 0 && (
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
                          {strengthLabel} — {t("auth.signup.strengthHint")}
                        </p>
                      </div>
                    )}
                  </ERPFormField>
                  <ERPFormField label={t("auth.signup.confirmPassword")} required error={errors.confirmPassword ? t("auth.signup.passwordMismatch") : undefined}>
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
                title={t("settings.financial.title")}
                description={t("auth.signup.financialSectionHint")}
              >
                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("settings.financial.baseCurrency")} required>
                    <AppDropdown
                      options={currencyOptions}
                      value={baseCurrency}
                      onChange={(v) => setValue("baseCurrency", v ?? DEFAULT_CURRENCY, { shouldValidate: true })}
                      clearable={false}
                      placeholder={t("auth.signup.selectCurrency")}
                    />
                  </ERPFormField>
                  <ERPFormField
                    label={t("auth.signup.shareValue", { currency: baseCurrency })}
                    required
                    hint={t("auth.signup.shareValueHint")}
                    error={errors.shareValue ? t("auth.signup.invalidAmount") : undefined}
                  >
                    <input
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
                  <ERPFormField label={t("settings.system.dateFormat")} required>
                    <AppDropdown
                      options={dateFormatOptions}
                      value={dateFormat}
                      onChange={(v) => setValue("dateFormat", v ?? DEFAULT_DATE_FORMAT, { shouldValidate: true })}
                      clearable={false}
                      placeholder={t("settings.system.dateFormat")}
                    />
                  </ERPFormField>
                  <ERPFormField label={t("settings.financial.fiscalYearStart")} required>
                    <AppDropdown
                      options={monthOptions}
                      value={fiscalYearStart || null}
                      onChange={(v) => setValue("fiscalYearStart", v ?? "", { shouldValidate: true })}
                      clearable={false}
                      placeholder={t("erp.fiscalMonth.selectMonth")}
                    />
                  </ERPFormField>
                  <ERPFormField
                    label={t("settings.financial.fiscalYearEnd")}
                    required
                    error={errors.fiscalYearEnd ? t("auth.signup.fiscalYearMismatch") : undefined}
                  >
                    <AppDropdown
                      options={monthOptions}
                      value={fiscalYearEnd || null}
                      onChange={(v) => setValue("fiscalYearEnd", v ?? "", { shouldValidate: true })}
                      clearable={false}
                      placeholder={t("erp.fiscalMonth.selectMonth")}
                    />
                  </ERPFormField>
                </ERPFormGrid>
              </ERPFormSection>

              <ERPFormSection
                title={t("auth.signup.fundsSectionTitle")}
                description={t("auth.signup.fundsSectionHint")}
              >
                {extraFunds.map((fund, index) => (
                  <ERPFormGrid columns={2} key={index}>
                    <ERPFormField label={t("funds.modal.name")}>
                      <input
                        type="text"
                        autoComplete="off"
                        placeholder={t("funds.modal.namePlaceholder")}
                        value={fund.name}
                        onChange={(e) =>
                          setExtraFunds((prev) =>
                            prev.map((f, i) => (i === index ? { ...f, name: e.target.value } : f)),
                          )
                        }
                        className={inputCls}
                      />
                    </ERPFormField>
                    <ERPFormField label={t("funds.modal.type")}>
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
                            placeholder={t("funds.modal.selectType")}
                          />
                        </div>
                        <button
                          type="button"
                          aria-label={t("auth.signup.removeFund")}
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
                    {t("auth.signup.addFund")}
                  </button>
                )}
              </ERPFormSection>

              {siteKey && (
                <div
                  ref={widgetRef}
                  role="group"
                  aria-label="Bot verification"
                  className="flex justify-center pt-1 min-h-[68px]"
                />
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || (siteKey !== "" && !captchaToken)}
                  className="inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-primary hover:opacity-90 disabled:opacity-60 text-primary-foreground text-sm font-medium transition-opacity disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t("auth.signup.creating")}</span>
                    </>
                  ) : (
                    <span>{t("auth.signup.submit")}</span>
                  )}
                </button>
              </div>
            </ERPFormLayout>

            <p className="text-center text-xs text-muted-foreground mt-4">{t("auth.signup.adminNote")}</p>
          </form>
        )}

        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-1.5 text-xs text-primary hover:opacity-75 transition-opacity"
        >
          {t("auth.signup.backToLogin")}
        </Link>
      </div>
    </div>
  );
}
