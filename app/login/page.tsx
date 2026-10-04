"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
  TrendingUp,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth, type AuthUser } from "@/lib/auth-context";
import { LOCALES, useLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { loginSchema } from "@/lib/utils/validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type LoginForm = z.infer<typeof loginSchema>;
type ErrorType = "credentials" | "network" | "server" | "validation" | null;

const REMEMBER_KEY = "investwise:rememberEmail";

function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
      <rect width="28" height="28" rx="6" fill="#0f172a" />
      <rect x="5" y="18" width="3" height="5" rx="0.5" fill="#38bdf8" opacity="0.4" />
      <rect x="9.5" y="14" width="3" height="9" rx="0.5" fill="#38bdf8" opacity="0.6" />
      <rect x="14" y="16" width="3" height="7" rx="0.5" fill="#38bdf8" opacity="0.8" />
      <rect x="18.5" y="9" width="3" height="14" rx="0.5" fill="#38bdf8" />
      <path
        d="M5 18 L11 11 L16 15 L23 7"
        stroke="#38bdf8"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      onClick={() => {
        const active = theme === "system" ? resolvedTheme : theme;
        setTheme(active === "dark" ? "light" : "dark");
      }}
      aria-label={t("layout.toggleTheme", { defaultValue: "Toggle theme" })}
      title={t("layout.toggleTheme", { defaultValue: "Toggle theme" })}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        !mounted && "invisible",
      )}
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-teal-400" />
    </button>
  );
}

function LocaleSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <div
      role="group"
      aria-label="Language"
      className="flex items-center rounded-lg border border-border/70 bg-card p-0.5"
    >
      {LOCALES.map((l: Locale) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={cn(
            "rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
            locale === l
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// Enterprise login portal (behavioral port of client/components/Login.tsx).
// Wired to POST /api/auth/login; JWTs land in HttpOnly cookies server-side.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useAuth();
  const { t } = useLocale();
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<{ type: ErrorType; message: string; details?: string } | null>(
    null,
  );
  const [shake, setShake] = useState(false);

  const redirect = searchParams.get("redirect") || "/";
  const year = new Date().getFullYear();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setValue("email", saved);
        setRememberMe(true);
      }
    } catch {
      // storage unavailable
    }
    if (searchParams.get("session") === "timeout" || searchParams.get("session") === "expired") {
      setError({
        type: "server",
        message: t("auth.login.sessionExpired"),
        details: t("auth.login.sessionExpiredDetails"),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const onSubmit = async (values: LoginForm) => {
    setError(null);
    try {
      const data = await apiClient<AuthUser & { tenantId?: string } & Record<string, unknown>>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ email: values.email, password: values.password }) },
      );
      try {
        if (rememberMe) localStorage.setItem(REMEMBER_KEY, values.email);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        // storage unavailable
      }
      setUser({
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        tenantId: typeof data.tenantId === "string" ? data.tenantId : undefined,
        permissions: (data.permissions ?? {}) as Record<string, string>,
      });
      toast.success(t("common.success"));
      router.replace(redirect);
    } catch (err) {
      triggerShake();
      if (err instanceof ApiError) {
        const status = err.status;
        if (status === 0 || err.message.includes("Failed to fetch")) {
          setError({
            type: "network",
            message: t("auth.login.connectionFailed"),
            details: t("auth.login.connectionFailedDetails"),
          });
        } else if (status === 401) {
          setError({
            type: "credentials",
            message: t("auth.login.invalidCredentials"),
            details: err.message || t("auth.login.invalidDetails"),
          });
        } else if (status === 429) {
          setError({
            type: "server",
            message: t("auth.login.lockedOut"),
            details: err.message || t("auth.login.lockedOutDetails"),
          });
        } else if (status === 403 || status === 423) {
          setError({ type: "server", message: t("auth.login.accessDenied"), details: err.message });
        } else if (status >= 500) {
          setError({
            type: "server",
            message: t("auth.login.serverError"),
            details: t("auth.login.serverErrorDetails"),
          });
        } else {
          // Unmasked server message (Rule §11).
          setError({
            type: "server",
            message: err.message || t("auth.login.authFailed"),
          });
        }
      } else {
        setError({ type: "server", message: t("auth.login.serverError") });
      }
    }
  };

  const fieldError = errors.email?.message || errors.password?.message;
  const isFieldErr =
    error?.type === "credentials" || error?.type === "validation" || !!fieldError;

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 text-foreground sm:p-6 lg:p-8">
      {/* Ambient brand glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl dark:bg-primary/[0.12]"
      />

      <Card className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-2xl border-border/70 bg-card shadow-2xl shadow-black/[0.06] lg:grid-cols-[1.05fr_1fr]">
        {/* ── Brand / marketing panel ── */}
        <aside className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
          {/* Adaptive canvas: light tinted surface, deep navy in dark mode */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-primary/[0.1] via-secondary/40 to-background dark:from-[#0b1222] dark:via-[#080d17] dark:to-[#080d17]"
          />
          {/* Ledger column rules */}
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden dark:block"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 120px)",
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 dark:hidden"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(15,23,42,0.05) 0px, rgba(15,23,42,0.05) 1px, transparent 1px, transparent 120px)",
            }}
          />
          {/* Dot grid */}
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden dark:block"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "26px 26px",
            }}
          />

          <div className="relative z-10">
            <div className="flex items-center gap-2.5">
              <LogoMark />
              <span className="text-sm font-semibold tracking-tight text-foreground dark:text-white/90">
                Invest<span className="text-primary dark:text-sky-400">Wise</span>
              </span>
            </div>
          </div>

          <div className="relative z-10 max-w-sm">
            <h2 className="text-2xl font-semibold leading-snug tracking-tight text-foreground dark:text-white">
              {t("auth.login.title")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground dark:text-white/60">
              {t("auth.login.brandTagline")}
            </p>

            <ul className="mt-8 space-y-3">
              <li className="flex items-center gap-2.5 text-sm text-foreground/80 dark:text-white/70">
                <ShieldCheck className="size-4 flex-shrink-0 text-primary dark:text-sky-400" />
                {t("auth.login.brandTrust")}
              </li>
              <li className="flex items-center gap-2.5 text-sm text-foreground/80 dark:text-white/70">
                <TrendingUp className="size-4 flex-shrink-0 text-primary dark:text-sky-400" />
                {t("auth.login.monthlyPerformance")}
              </li>
            </ul>
          </div>

          <div className="relative z-10 flex items-center justify-between">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground dark:text-white/25">
              © {year} InvestWise
            </p>
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground dark:text-white/25">
              {t("auth.login.footerVersion")}
            </p>
          </div>
        </aside>

        {/* ── Form panel ── */}
        <div className={cn("flex flex-col p-6 sm:p-10", shake && "animate-shake")}>
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-2.5 lg:hidden">
              <LogoMark className="size-6" />
              <span className="text-sm font-semibold tracking-tight">
                Invest<span className="text-primary">Wise</span>
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
          </div>

          <div className="mb-8">
            <h1 className="mb-1.5 text-2xl font-semibold tracking-tight text-foreground">
              {t("auth.login.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("auth.login.subtitle")}</p>
          </div>

          {error && (
            <div
              role="alert"
              className={cn(
                "mb-6 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
                error.type === "network"
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/10 dark:text-amber-400"
                  : error.type === "validation"
                    ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-900/10 dark:text-sky-400"
                    : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/10 dark:text-rose-400",
              )}
            >
              <span className="mt-0.5 flex-shrink-0">
                {error.type === "network" ? (
                  <WifiOff size={14} />
                ) : error.type === "credentials" ? (
                  <XCircle size={14} />
                ) : (
                  <AlertCircle size={14} />
                )}
              </span>
              <div>
                <p className="font-medium">{error.message}</p>
                {error.details && <p className="mt-0.5 text-xs opacity-75">{error.details}</p>}
              </div>
            </div>
          )}

          <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <label
                htmlFor="login-email"
                className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t("auth.login.email")}
              </label>
              <div className="relative">
                <Mail
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder={t("auth.login.emailPlaceholder")}
                  {...register("email")}
                  aria-invalid={!!(errors.email || error?.type === "validation")}
                  className={cn(
                    "h-11 rounded-xl pl-9 pr-3 text-sm",
                    isFieldErr && "border-rose-400 focus-visible:border-rose-400 dark:border-rose-500",
                  )}
                />
              </div>
              {(errors.email || (error?.type === "validation" && !errors.password)) && (
                <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
                  {errors.email?.message ?? t("auth.login.emailRequired")}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="login-password"
                  className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {t("auth.login.password")}
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-primary transition-opacity hover:opacity-75"
                >
                  {t("auth.login.forgotPassword")}
                </Link>
              </div>
              <div className="relative">
                <Lock
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register("password")}
                  aria-invalid={!!errors.password}
                  className={cn(
                    "h-11 rounded-xl pl-9 pr-10 text-sm",
                    isFieldErr && "border-rose-400 focus-visible:border-rose-400 dark:border-rose-500",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {errors.password && (
                <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
                  {t("auth.login.passwordRequired")}
                </p>
              )}
            </div>

            {/* Remember me */}
            <label className="flex cursor-pointer select-none items-center gap-2.5">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="size-4 cursor-pointer rounded border-border accent-primary"
              />
              <span className="text-xs text-muted-foreground">{t("auth.login.rememberMe")}</span>
            </label>

            <Button
              type="submit"
              size="lg"
              loading={isSubmitting}
              loadingText={t("auth.login.signingIn")}
              className="h-11 w-full rounded-xl text-sm"
            >
              {t("auth.login.submit")}
              <ArrowRight size={15} className="ml-1.5" />
            </Button>
          </form>

          <div className="mt-auto pt-8">
            <div className="mb-4 flex items-center justify-center">
              <span className="h-px w-full max-w-xs bg-border/70" />
            </div>
            {/* Self-serve onboarding: creates a tenant + its Admin on a trial
                (POST /api/auth/signup), then the visitor signs in here. */}
            <p className="text-center text-sm text-muted-foreground">
              {t("auth.login.noAccount")}{" "}
              <Link
                href="/signup"
                className="font-semibold text-primary transition-opacity hover:opacity-75"
              >
                {t("auth.login.signupNow")}
              </Link>
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
