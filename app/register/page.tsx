"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, ShieldAlert, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AppShell } from "@/components/layout/app-shell";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useLocale } from "@/lib/i18n";
import { isSuperAdminRole, normalizeRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

const ROLE_VALUES = [
  "Admin",
  "Manager",
  "Auditor",
  "Member",
] as const;

// Form-level schema: role is explicitly required (Rule §15 — no pre-selection),
// confirm-password must match. The API shape still satisfies registerSchema.
const inviteSchema = z
  .object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(12),
    confirmPassword: z.string().min(1),
    role: z.string().min(1),
    memberId: z.string().optional(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "passwordMismatch",
  });

type InviteForm = z.infer<typeof inviteSchema>;

function strengthScore(password: string): number {
  let score = 0;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[@$!%*?&#^()_+\-=[\]{}|;:,.<>/~`]/.test(password)) score += 1;
  return score;
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";

// Admin-only user invitation portal. Wired to POST /api/auth/register, which
// enforces Admin access + 12-char complex passwords server-side (Rule §0:
// never weaken what the server requires — the meter mirrors it live).
export default function RegisterPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { t } = useLocale();
  const [showPassword, setShowPassword] = useState(false);

  const roleOptions: DropdownOption[] = useMemo(
    () => ROLE_VALUES.map((r) => ({ value: r, label: r })),
    [],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "", role: "", memberId: "" },
  });

  const password = watch("password") ?? "";
  const role = watch("role") ?? "";
  const score = strengthScore(password);
  const strengthLabel =
    score <= 1
      ? t("auth.register.strengthWeak")
      : score === 2
        ? t("auth.register.strengthFair")
        : score === 3
          ? t("auth.register.strengthGood")
          : t("auth.register.strengthStrong");
  const strengthTone =
    score <= 1 ? "bg-rose-500" : score === 2 ? "bg-amber-500" : score === 3 ? "bg-cyan-500" : "bg-emerald-500";

  if (!authLoading && !user) {
    router.replace("/login?redirect=/register");
    return null;
  }

  const normalizedRole = normalizeRole(user?.role);
  const isAdmin = normalizedRole === "Admin" || isSuperAdminRole(normalizedRole);

  const onSubmit = async (values: InviteForm) => {
    try {
      const res = await apiClient<{ success: boolean; message?: string }>( "/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          password: values.password,
          role: values.role,
          memberId: values.memberId?.trim() || undefined,
        }),
      });
      toast.success(res.message ?? t("auth.register.success", { name: values.name.trim() }));
      reset({ name: "", email: "", password: "", confirmPassword: "", role: "", memberId: "" });
    } catch (err) {
      // Unmasked server message (Rule §11).
      toast.error(err instanceof ApiError ? err.message : t("auth.register.weakPassword"));
    }
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <UserPlus size={18} />
            {t("auth.register.title")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("auth.register.subtitle")}</p>
        </div>

        {!authLoading && !isAdmin ? (
          <div role="alert" className="flex items-start gap-2.5 px-4 py-4 rounded border bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{t("auth.register.adminOnly")}</p>
              <p className="text-xs mt-0.5 opacity-80">{t("auth.register.adminOnlyDetails")}</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="bg-card rounded-xl border border-border/80 shadow-sm p-6" noValidate>
            <ERPFormLayout>
              <ERPFormSection title={t("auth.register.title")}>
                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("auth.register.name")} required error={errors.name ? t("auth.register.nameRequired") : undefined}>
                    <input
                      type="text"
                      autoComplete="name"
                      placeholder={t("auth.register.namePlaceholder")}
                      {...register("name")}
                      className={inputCls}
                    />
                  </ERPFormField>
                  <ERPFormField label={t("auth.register.email")} required error={errors.email?.message}>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder={t("auth.login.emailPlaceholder")}
                      {...register("email")}
                      className={inputCls}
                    />
                  </ERPFormField>
                </ERPFormGrid>
                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("auth.register.password")} required error={errors.password?.message}>
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
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    {password.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="flex gap-1" aria-hidden="true">
                          {[0, 1, 2, 3].map((i) => (
                            <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < score ? strengthTone : "bg-slate-200 dark:bg-slate-700")} />
                          ))}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {strengthLabel} — {t("auth.register.strengthHint")}
                        </p>
                      </div>
                    )}
                  </ERPFormField>
                  <ERPFormField
                    label={t("auth.register.confirmPassword")}
                    required
                    error={errors.confirmPassword ? t("auth.register.passwordMismatch") : undefined}
                  >
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      {...register("confirmPassword")}
                      className={inputCls}
                    />
                  </ERPFormField>
                </ERPFormGrid>
                <ERPFormGrid columns={2}>
                  <ERPFormField label={t("auth.register.role")} required error={errors.role ? t("auth.register.roleRequired") : undefined}>
                    <AppDropdown
                      options={roleOptions}
                      value={role || null}
                      onChange={(v) => setValue("role", v ?? "", { shouldValidate: true })}
                      placeholder={t("auth.register.selectRole")}
                    />
                  </ERPFormField>
                  <ERPFormField label={t("auth.register.memberId")}>
                    <input
                      type="text"
                      placeholder={t("auth.register.memberIdPlaceholder")}
                      {...register("memberId")}
                      className={inputCls}
                    />
                  </ERPFormField>
                </ERPFormGrid>
              </ERPFormSection>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button type="submit" variant="primary" size="sm" loading={isSubmitting} loadingLabel={t("auth.register.creating")}>
                  {t("auth.register.submit")}
                </Button>
              </div>
            </ERPFormLayout>
          </form>
        )}
      </div>
    </AppShell>
  );
}
