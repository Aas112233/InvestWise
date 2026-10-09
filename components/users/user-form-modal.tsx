"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { PERMISSION_SCREENS, SCREEN_LABEL_KEY, TENANT_ASSIGNABLE_ROLES, type TenantUser } from "./types";

// Create/edit user sheet. Permissions matrix edits explicit per-user
// overrides (WRITE/READ/NONE); an unset screen inherits the role baseline
// (lib/roles.ts roleBaselineGrant) and is omitted from the payload.
export function UserFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: TenantUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const isEdit = initial !== null;

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2, "users.validation.nameMin").max(255),
        email: isEdit
          ? z.string().optional()
          : z.string().trim().min(1, "users.validation.emailRequired").email("users.validation.emailInvalid"),
        password: isEdit
          ? z.string().optional()
          : z.string().min(1, "users.form.passwordRequired"),
      }),
    [isEdit],
  );

  type FormValues = z.infer<typeof formSchema>;

  const [role, setRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<string, string | null>>({});

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) as any });

  useEffect(() => {
    if (!open) return;
    setRole(initial ? initial.role : null);
    setPermissions(
      initial
        ? Object.fromEntries(PERMISSION_SCREENS.map((s) => [s, initial.permissions?.[s] ?? null]))
        : Object.fromEntries(PERMISSION_SCREENS.map((s) => [s, null])),
    );
    reset({ name: initial?.name ?? "", email: initial?.email ?? "", password: "" });
  }, [open, initial, reset]);

  const roleOptions: DropdownOption[] = useMemo(
    () => TENANT_ASSIGNABLE_ROLES.map((r) => ({ value: r, label: t(`users.roleLabels.${r}`) })),
    [t],
  );

  const levelOptions: DropdownOption[] = useMemo(
    () => [
      { value: "NONE", label: t("users.permLevels.NONE") },
      { value: "READ", label: t("users.permLevels.READ") },
      { value: "WRITE", label: t("users.permLevels.WRITE") },
    ],
    [t],
  );

  const onSubmit = async (values: FormValues) => {
    try {
      const explicitPermissions: Record<string, string> = {};
      for (const screen of PERMISSION_SCREENS) {
        const level = permissions[screen];
        if (level) explicitPermissions[screen] = level;
      }

      if (isEdit && initial) {
        await apiClient(`/auth/users/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: values.name,
            role: role ?? initial.role,
            permissions: explicitPermissions,
          }),
        });
        toast.success(t("users.form.updatedToast", { name: values.name }));
      } else {
        await apiClient("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: values.name,
            email: values.email,
            password: values.password,
            role: role ?? undefined,
            permissions: Object.keys(explicitPermissions).length > 0 ? explicitPermissions : undefined,
          }),
        });
        toast.success(t("users.form.createdToast", { name: values.name }));
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("users.errors.saveFailed"));
    }
  };

  const showPermissions = role !== "Admin";

  return (
    <TopSheet
      open={open}
      onClose={onClose}
      title={isEdit ? t("users.form.titleEdit") : t("users.form.titleAdd")}
    >
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <ERPFormLayout>
          <ERPFormSection title={t("users.form.accountTitle")}>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("users.form.name")} required error={errors.name?.message ? t(errors.name.message) : undefined}>
                <input type="text" autoComplete="name" {...register("name")} className={inputCls} />
              </ERPFormField>
              {isEdit ? (
                <ERPFormField label={t("users.form.email")}>
                  <input type="email" value={initial?.email ?? ""} readOnly disabled className={inputCls} />
                </ERPFormField>
              ) : (
                <ERPFormField label={t("users.form.email")} required error={errors.email?.message ? t(errors.email.message) : undefined}>
                  <input type="email" autoComplete="email" {...register("email")} className={inputCls} />
                </ERPFormField>
              )}
            </ERPFormGrid>
            <ERPFormGrid columns={2}>
              {!isEdit && (
                <ERPFormField label={t("users.form.password")} required error={errors.password?.message ? t(errors.password.message) : undefined}>
                  <input type="password" autoComplete="new-password" {...register("password")} className={inputCls} />
                </ERPFormField>
              )}
              <ERPFormField label={t("users.form.role")} required error={!role ? t("users.form.selectRole") : undefined}>
                <AppDropdown
                  options={roleOptions}
                  value={role}
                  onChange={(v) => setRole(v)}
                  placeholder={t("users.form.selectRole")}
                />
              </ERPFormField>
            </ERPFormGrid>
            {!isEdit && <p className="text-[11px] text-slate-400">{t("users.form.passwordPolicyNote")}</p>}
          </ERPFormSection>

          {showPermissions && (
            <ERPFormSection title={t("users.form.permissions")}>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 pb-2">
                {t("users.form.permissionsNote")}
              </p>
              <div className="divide-y divide-border/60">
                {PERMISSION_SCREENS.map((screen) => (
                  <div key={screen} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-xs text-foreground">{t(SCREEN_LABEL_KEY[screen] ?? screen)}</span>
                    <div className="w-44 shrink-0">
                      <AppDropdown
                        options={levelOptions}
                        value={permissions[screen] ?? null}
                        onChange={(v) => setPermissions((prev) => ({ ...prev, [screen]: v }))}
                        placeholder={t("users.form.inherit")}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </ERPFormSection>
          )}

          {role === "Admin" && (
            <p className="text-[11px] text-slate-400">{t("users.form.adminFullAccessNote")}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              loading={isSubmitting}
              loadingLabel={t("users.form.saving")}
              disabled={!role}
            >
              {t("users.form.save")}
            </Button>
          </div>
        </ERPFormLayout>
      </form>
    </TopSheet>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";
