"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";

const forgotSchema = z.object({ email: z.string().email() });
type ForgotForm = z.infer<typeof forgotSchema>;

// Password recovery request flow. Posts to POST /api/auth/forgot-password
// (backend-owned contract); the server message is always shown unmasked.
export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({ resolver: zodResolver(forgotSchema) });

  const onSubmit = async (values: ForgotForm) => {
    try {
      const res = await apiClient<{ success: boolean; message?: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: values.email.trim() }),
      });
      setSentTo(values.email.trim());
      toast.success(res.message ?? t("auth.forgot.success"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("auth.login.serverError"));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border/80 shadow-sm p-8">
        <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
          <Mail size={20} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("auth.forgot.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 mb-6">
          {t("auth.forgot.subtitle")}
        </p>

        {sentTo ? (
          <div role="status" className="flex items-start gap-2.5 px-4 py-4 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{t("auth.forgot.success")}</p>
              <p className="text-xs mt-0.5 opacity-80">{t("auth.forgot.successDetails", { email: sentTo })}</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="forgot-email" className="block text-xs font-medium text-foreground">
                {t("auth.forgot.email")}
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                placeholder={t("auth.login.emailPlaceholder")}
                {...register("email")}
                className="w-full px-3 py-2.5 rounded-lg border text-sm bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
              />
              {errors.email && (
                <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
                  {t("auth.login.emailInvalid")}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:opacity-90 disabled:opacity-60 text-primary-foreground text-sm font-medium transition-opacity disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>{t("auth.forgot.sending")}</span>
                </>
              ) : (
                <span>{t("auth.forgot.submit")}</span>
              )}
            </button>
          </form>
        )}

        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:opacity-75 transition-opacity"
        >
          <ArrowLeft size={13} />
          {t("auth.forgot.backToLogin")}
        </Link>
      </div>
    </div>
  );
}
