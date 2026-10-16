"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
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
import { ACCESS_PRESETS, PERMISSION_SCREENS, SCREEN_LABEL_KEY, TENANT_ASSIGNABLE_ROLES, presetPermissions, type AccessPreset, type TenantUser } from "./types";

// Create/edit user sheet. Permissions matrix edits explicit per-user
// overrides (MANAGE/WRITE/READ/NONE); an unset screen inherits the role
// baseline (lib/roles.ts roleBaselineGrant) and is omitted from the payload.
// On create, an optional member link prefills name/email from the directory
// and is claimed transactionally server-side (app/api/auth/register).
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
  const [memberUuid, setMemberUuid] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    setValue,
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
    setMemberUuid(initial?.memberUuid ?? null);
    setMemberSearch("");
    reset({ name: initial?.name ?? "", email: initial?.email ?? "", password: "" });
  }, [open, initial, reset]);

  // Member directory feed for the link-member picker (create mode only).
  // Unlinked members surface first; already-linked rows are disabled so one
  // member can never fan out to two logins.
  const memberQuery = useQuery({
    queryKey: ["members", { linkPicker: true, search: memberSearch }],
    queryFn: () =>
      apiClient<{ data: Array<{ id: string; memberId: string; name: string; email?: string | null; userId?: string | null }> }>(
        "/members",
        { params: { limit: 100, search: memberSearch || undefined } },
      ),
    enabled: open && !isEdit,
    staleTime: 30_000,
  });
  const memberOptions: DropdownOption[] = useMemo(() => {
    const rows = memberQuery.data?.data ?? [];
    return rows.map((m) => ({
      value: m.id,
      label: `${m.name} (${m.memberId})`,
      caption: m.email ?? undefined,
      disabled: Boolean(m.userId),
    }));
  }, [memberQuery.data]);

  const selectedMember = useMemo(() => {
    const rows = memberQuery.data?.data ?? [];
    return rows.find((m) => m.id === memberUuid) ?? null;
  }, [memberQuery.data, memberUuid]);

  const applyMemberLink = (id: string | null) => {
    setMemberUuid(id);
    if (!id) return;
    const rows = memberQuery.data?.data ?? [];
    const m = rows.find((r) => r.id === id);
    if (!m) return;
    setValue("name", m.name, { shouldValidate: true });
    if (m.email) setValue("email", m.email, { shouldValidate: true });
  };

  const applyPreset = (preset: AccessPreset) => {
    setPermissions(presetPermissions(preset));
  };

  const roleOptions: DropdownOption[] = useMemo(
    () => TENANT_ASSIGNABLE_ROLES.map((r) => ({ value: r, label: t(`users.roleLabels.${r}`) })),
    [t],
  );

  const levelOptions: DropdownOption[] = useMemo(
    () => [
      { value: "NONE", label: t("users.permLevels.NONE") },
      { value: "READ", label: t("users.permLevels.READ") },
      { value: "WRITE", label: t("users.permLevels.WRITE") },
      { value: "MANAGE", label: t("users.permLevels.MANAGE") },
    ],
    [t],
  );

  const presetOptions: Array<{ preset: AccessPreset; label: string }> = useMemo(
    () => [
      { preset: ACCESS_PRESETS.READ_ONLY, label: t("users.form.presetReadOnly") },
      { preset: ACCESS_PRESETS.STANDARD_WRITE, label: t("users.form.presetStandardWrite") },
      { preset: ACCESS_PRESETS.FULL_MANAGE, label: t("users.form.presetFullManage") },
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
            memberUuid: memberUuid ?? undefined,
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
            {!isEdit && (
              <ERPFormField
                label={t("users.form.linkedMember")}
                hint={t("users.form.linkedMemberHint")}
                error={memberQuery.isError ? t("users.errors.membersLoadFailed") : undefined}
              >
                <AppDropdown
                  options={memberOptions}
                  value={memberUuid}
                  onChange={applyMemberLink}
                  onSearch={setMemberSearch}
                  loading={memberQuery.isFetching}
                  placeholder={t("users.form.selectMember")}
                />
              </ERPFormField>
            )}
            {isEdit && initial?.memberName && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 pb-2">
                {t("users.form.currentlyLinked", { name: initial.memberName })}
              </p>
            )}
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
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{t("users.form.presetLabel")}</span>
                {presetOptions.map(({ preset, label }) => (
                  <Button key={preset} variant="outline" size="sm" type="button" onClick={() => applyPreset(preset)}>
                    {label}
                  </Button>
                ))}
              </div>
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
