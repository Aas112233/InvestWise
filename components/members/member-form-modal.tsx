"use client";

import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { MEMBER_ROLES, memberRoleLabel } from "@/lib/member-roles";
import type { Member } from "@/types";

const formSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  // Phone is NOT NULL in the schema — required on create and edit alike.
  phone: z.string().trim().min(1),
  role: z.string().min(1),
  shares: z.number().int().min(1),
  nidOrPassport: z.string().trim().optional(),
  fatherName: z.string().trim().optional(),
  address: z.string().trim().optional(),
  nomineeName: z.string().trim().optional(),
  nomineeRelation: z.string().trim().optional(),
  nomineeNidOrPassport: z.string().trim().optional(),
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

  // Edit mode MUST prefill from the full record. List rows omit the KYC/
  // nominee fields by design (PII masking), so saving from a list-row prefill
  // would null them server-side — a destructive data wipe. Fetch the detail
  // (same query key as MemberDetailSheet, so it's usually cached) and only
  // allow saving once it has loaded.
  const detailQuery = useQuery({
    queryKey: ["members", initial?.id],
    queryFn: () => apiClient<{ success: boolean; data: Member }>(`/members/${initial?.id}`),
    enabled: open && isEdit && Boolean(initial?.id),
  });
  const full: Member | null = detailQuery.data?.data ?? null;

  const roleOptions: DropdownOption[] = useMemo(
    () => MEMBER_ROLES.map((r) => ({ value: r, label: t(memberRoleLabel(r)) })),
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
      nomineeNidOrPassport: "",
      nomineePhone: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    // In edit mode only prefill once the FULL record is available — never
    // from the masked list row (its blank PII fields must not be submitted).
    if (isEdit && !full) return;
    const source = isEdit ? full : null;
    reset({
      name: source?.name ?? initial?.name ?? "",
      email: source?.email ?? initial?.email ?? "",
      phone: source?.phone ?? initial?.phone ?? "",
      role: source?.role ?? initial?.role ?? "",
      shares: source?.shares ?? initial?.shares ?? 1,
      nidOrPassport: source?.nidOrPassport ?? "",
      fatherName: source?.fatherName ?? "",
      address: source?.address ?? "",
      nomineeName: source?.nomineeName ?? "",
      nomineeRelation: source?.nomineeRelation ?? "",
      nomineeNidOrPassport: source?.nomineeNidOrPassport ?? "",
      nomineePhone: source?.nomineePhone ?? "",
    });
  }, [open, initial, full, isEdit, reset]);

  const role = watch("role") ?? "";

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && initial) {
        await apiClient(`/members/${initial.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: values.name,
            email: values.email,
            phone: values.phone.trim(),
            role: values.role,
            nidOrPassport: values.nidOrPassport || null,
            fatherName: values.fatherName || null,
            address: values.address || null,
            nomineeName: values.nomineeName || null,
            nomineeRelation: values.nomineeRelation || null,
            nomineeNidOrPassport: values.nomineeNidOrPassport || null,
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
            phone: values.phone.trim(),
            role: values.role,
            shares: values.shares,
            nidOrPassport: values.nidOrPassport || null,
            fatherName: values.fatherName || null,
            address: values.address || null,
            nomineeName: values.nomineeName || null,
            nomineeRelation: values.nomineeRelation || null,
            nomineeNidOrPassport: values.nomineeNidOrPassport || null,
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
      {isEdit && detailQuery.isPending ? (
        <div className="space-y-3 py-4">
          <Skeleton width="100%" height="4rem" />
          <Skeleton width="100%" height="6rem" />
          <Skeleton width="100%" height="8rem" />
        </div>
      ) : isEdit && detailQuery.isError ? (
        <div className="py-8 text-center space-y-3">
          <p className="text-sm text-slate-500">{t("members.errors.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => detailQuery.refetch()}>
            {t("members.refresh")}
          </Button>
        </div>
      ) : (
      <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
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
              <ERPFormField label={t("members.form.phone")} required error={errors.phone ? t("members.form.phoneRequired") : undefined}>
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
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("members.form.nominee")}>
                <input type="text" {...register("nomineeName")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.nomineeRelation")}>
                <input type="text" {...register("nomineeRelation")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.nomineeNid")}>
                <input type="text" {...register("nomineeNidOrPassport")} className={inputCls} />
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
      )}
    </TopSheet>
  );
}
