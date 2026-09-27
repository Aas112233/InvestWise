"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  WifiOff,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth, type AuthUser } from "@/lib/auth-context";
import { LOCALES, useLocale, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { loginSchema } from "@/lib/utils/validation";

type LoginForm = z.infer<typeof loginSchema>;
type ErrorType = "credentials" | "network" | "server" | "validation" | null;

const REMEMBER_KEY = "investwise:rememberEmail";

function LogoMark({ className = "w-7 h-7" }: { className?: string }) {
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

// Enterprise login portal (behavioral port of client/components/Login.tsx).
// Wired to POST /api/auth/login; JWTs land in HttpOnly cookies server-side.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useAuth();
  const { t, locale, setLocale } = useLocale();
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
      setError({ type: "server", message: t("auth.login.sessionExpired"), details: t("auth.login.sessionExpiredDetails") });
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
          setError({ type: "network", message: t("auth.login.connectionFailed"), details: t("auth.login.connectionFailedDetails") });
        } else if (status === 401) {
          setError({ type: "credentials", message: t("auth.login.invalidCredentials"), details: err.message || t("auth.login.invalidDetails") });
        } else if (status === 429) {
          setError({ type: "server", message: t("auth.login.lockedOut"), details: err.message || t("auth.login.lockedOutDetails") });
        } else if (status === 403 || status === 423) {
          setError({ type: "server", message: t("auth.login.accessDenied"), details: err.message });
        } else if (status >= 500) {
          setError({ type: "server", message: t("auth.login.serverError"), details: t("auth.login.serverErrorDetails") });
        } else {
          // Unmasked server message (Rule §11).
          setError({ type: "server", message: err.message || t("auth.login.authFailed") });
        }
      } else {
        setError({ type: "server", message: t("auth.login.serverError") });
      }
    }
  };

  const fieldError = errors.email?.message || errors.password?.message;
  const isFieldErr = error?.type === "credentials" || error?.type === "validation" || !!fieldError;
  const inputCls =
    "w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-2 focus:ring-ring/25 transition-colors";

  return (
    <div className="min-h-screen flex bg-background">
      {/* Form panel */}
      <div
        className={cn(
          "w-full lg:w-[460px] xl:w-[500px] flex flex-col justify-center px-8 sm:px-12 xl:px-14 py-12 border-r border-border/60",
          shake && "animate-shake",
        )}
      >
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-sm font-semibold text-foreground tracking-tight">
              Invest<span className="text-primary">Wise</span>
            </span>
          </div>
          <div className="flex items-center bg-muted/40 p-0.5 rounded-lg border border-border/60" role="group" aria-label="Language">
            {LOCALES.map((l: Locale) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={cn(
                  "px-2 py-1 text-[10px] font-medium rounded-md transition-all",
                  locale === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1.5">
            {t("auth.login.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("auth.login.subtitle")}</p>
        </div>

        {error && (
          <div
            role="alert"
            className={cn(
              "flex items-start gap-2.5 px-3.5 py-3 rounded-lg border text-sm mb-6",
              error.type === "network"
                ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
                : error.type === "validation"
                  ? "bg-sky-50 dark:bg-sky-900/10 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-400"
                  : "bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400",
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
              {error.details && <p className="text-xs mt-0.5 opacity-75">{error.details}</p>}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("auth.login.email")}
            </label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder={t("auth.login.emailPlaceholder")}
                {...register("email")}
                className={cn(inputCls, isFieldErr && "border-rose-400 dark:border-rose-500")}
              />
            </div>
            {(errors.email || (error?.type === "validation" && !errors.password)) && (
              <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
                {errors.email?.message ?? t("auth.login.emailRequired")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="login-password" className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("auth.login.password")}
              </label>
              <Link href="/forgot-password" className="text-xs text-primary hover:opacity-75 transition-opacity">
                {t("auth.login.forgotPassword")}
              </Link>
            </div>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                {...register("password")}
                className={cn(inputCls, "pr-10", isFieldErr && "border-rose-400 dark:border-rose-500")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {errors.password && (
              <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
                {t("auth.login.passwordRequired")}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">{t("auth.login.rememberMe")}</span>
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:bg-primary/90 active:bg-primary/80 disabled:opacity-60 text-primary-foreground text-sm font-medium shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>{t("auth.login.signingIn")}</span>
              </>
            ) : (
              <>
                <span>{t("auth.login.submit")}</span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>

        <div className="mt-12 pt-5 border-t border-border/60 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground/70">{t("auth.login.footerVersion")}</p>
        </div>
      </div>

      {/* Brand panel — quiet dark canvas with an accounting-ledger texture */}
      <div className="hidden lg:flex flex-1 flex-col items-center justify-center bg-[#080d17] relative overflow-hidden px-12">
        {/* Ledger column rules */}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 120px)" }}
        />
        {/* Fine dot grid */}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "26px 26px" }}
        />
        {/* Center vignette */}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse 55% 45% at 50% 50%, transparent 30%, rgba(8,13,23,0.7) 100%)" }}
        />

        <div className="relative z-10 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] shadow-lg shadow-black/30">
            <LogoMark className="w-9 h-9" />
          </div>
          <div className="mt-6 h-px w-10 bg-white/15" />
          <p className="mt-6 text-sm font-semibold tracking-tight text-white/85">
            Invest<span className="text-sky-400">Wise</span>
          </p>
        </div>

        <div className="absolute bottom-6 left-0 right-0 flex justify-center">
          <p className="text-[10px] tracking-wide font-medium text-white/25">© {year} InvestWise</p>
        </div>
      </div>
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
