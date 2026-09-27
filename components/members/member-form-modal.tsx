"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import type { Member } from "@/types";

const MEMBER_ROLES = [
  "Admin",
  "Administrator",
  "Manager",
  "Audit",
  "Investor",
  "Associate Member",
  "Member",
] as const;

function roleLabelKey(role: string): string {
  switch (role) {
    case "Admin":
    case "Administrator":
      return "members.adminRole";
    case "Manager":
      return "members.managerRole";
    case "Audit":
      return "members.auditRole";
    case "Investor":
      return "members.investorRole";
    case "Associate Member":
      return "roles.associateMember";
    default:
      return "members.memberRole";
  }
}

const formSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().optional(),
  role: z.string().min(1),
  shares: z.number().int().min(1),
  nidOrPassport: z.string().trim().optional(),
  fatherName: z.string().trim().optional(),
  address: z.string().trim().optional(),
  nomineeName: z.string().trim().optional(),
  nomineeRelation: z.string().trim().optional(),
  nomineePhone: z.string().trim().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

// Add/Edit member modal. Shares are set once at creation and locked
// afterwards (derived from the ledger), so the edit form omits them.
export function MemberFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Member | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const isEdit = initial !== null;

  const roleOptions: DropdownOption[] = useMemo(
    () => MEMBER_ROLES.map((r) => ({ value: r, label: t(roleLabelKey(r)) })),
    [t],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      role: "",
      shares: 1,
      nidOrPassport: "",
      fatherName: "",
      address: "",
      nomineeName: "",
      nomineeRelation: "",
      nomineePhone: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: initial?.name ?? "",
      email: initial?.email ?? "",
      phone: initial?.phone ?? "",
      role: initial?.role ?? "",
      shares: initial?.shares ?? 1,
      nidOrPassport: "",
      fatherName: "",
      address: "",
      nomineeName: "",
      nomineeRelation: "",
      nomineePhone: "",
    });
  }, [open, initial, reset]);

  const role = watch("role") ?? "";

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && initial) {
        await apiClient(`/members/${initial.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: values.name,
            email: values.email,
            phone: values.phone || null,
            role: values.role,
            nidOrPassport: values.nidOrPassport || null,
            fatherName: values.fatherName || null,
            address: values.address || null,
            nomineeName: values.nomineeName || null,
            nomineeRelation: values.nomineeRelation || null,
            nomineePhone: values.nomineePhone || null,
          }),
        });
        toast.success(t("members.form.updatedToast", { name: values.name }));
      } else {
        await apiClient("/members", {
          method: "POST",
          body: JSON.stringify({
            name: values.name,
            email: values.email,
            phone: values.phone || null,
            role: values.role,
            shares: values.shares,
            nidOrPassport: values.nidOrPassport || null,
            fatherName: values.fatherName || null,
            address: values.address || null,
            nomineeName: values.nomineeName || null,
            nomineeRelation: values.nomineeRelation || null,
            nomineePhone: values.nomineePhone || null,
          }),
        });
        toast.success(t("members.form.createdToast", { name: values.name }));
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("members.errors.saveFailed"));
    }
  };

  return (
    <TopSheet
      open={open}
      onClose={onClose}
      title={isEdit ? t("members.form.titleEdit") : t("members.form.titleAdd")}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <ERPFormLayout>
          <ERPFormSection title={t("members.form.titleAdd")}>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("members.form.name")} required error={errors.name?.message}>
                <input type="text" autoComplete="name" {...register("name")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.email")} required error={errors.email?.message}>
                <input type="email" autoComplete="email" {...register("email")} className={inputCls} />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("members.form.phone")} error={errors.phone?.message}>
                <input type="tel" autoComplete="tel" {...register("phone")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.role")} required error={errors.role ? t("members.form.selectRole") : undefined}>
                <AppDropdown
                  options={roleOptions}
                  value={role || null}
                  onChange={(v) => setValue("role", v ?? "", { shouldValidate: true })}
                  placeholder={t("members.form.selectRole")}
                />
              </ERPFormField>
            </ERPFormGrid>
            {!isEdit ? (
              <ERPFormGrid columns={2}>
                <ERPFormField label={t("members.form.shares")} required error={errors.shares?.message}>
                  <input type="number" min={1} step={1} {...register("shares", { valueAsNumber: true })} className={inputCls} />
                </ERPFormField>
                <ERPFormField label={t("members.form.nid")}>
                  <input type="text" {...register("nidOrPassport")} className={inputCls} />
                </ERPFormField>
              </ERPFormGrid>
            ) : (
              <p className="text-[11px] text-slate-400">{t("members.form.sharesLockedNote")}</p>
            )}
          </ERPFormSection>

          <ERPFormSection title={t("members.detail.contactTitle")}>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("members.form.father")}>
                <input type="text" {...register("fatherName")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.address")}>
                <input type="text" {...register("address")} className={inputCls} />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFormGrid columns={3}>
              <ERPFormField label={t("members.form.nominee")}>
                <input type="text" {...register("nomineeName")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.nomineeRelation")}>
                <input type="text" {...register("nomineeRelation")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.nomineePhone")}>
                <input type="tel" {...register("nomineePhone")} className={inputCls} />
              </ERPFormField>
            </ERPFormGrid>
          </ERPFormSection>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={isSubmitting} loadingLabel={t("members.form.saving")}>
              {t("members.form.save")}
            </Button>
          </div>
        </ERPFormLayout>
      </form>
    </TopSheet>
  );
}
