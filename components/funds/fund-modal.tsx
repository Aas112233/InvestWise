"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { fundTypeLabelKey, type FundRow } from "./shared";

// Backend fund types (server/src/modules/funds/service.ts). PROJECT funds
// are auto-created with projects, so creation offers the other three.
const FUND_TYPES = ["DEPOSIT", "PRIMARY", "OTHER"] as const;
const FUND_STATUSES = ["ACTIVE", "INACTIVE", "CLOSED"] as const;

const fundSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().min(1),
  description: z.string().trim().optional(),
  minimumBalance: z
    .string()
    .trim()
    .regex(/^(\d+(\.\d{1,2})?)?$/, "minBalance")
    .optional(),
  initialBalance: z
    .string()
    .trim()
    .regex(/^(\d+(\.\d{1,2})?)?$/, "initialBalance")
    .optional(),
  status: z.string().optional(),
});

type FundForm = z.infer<typeof fundSchema>;

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

export function FundModal({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: FundRow | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const isEdit = initial !== null;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FundForm>({
    resolver: zodResolver(fundSchema),
    defaultValues: { name: "", type: "", description: "", minimumBalance: "", initialBalance: "", status: "ACTIVE" },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: initial?.name ?? "",
      type: initial?.type ?? "",
      description: initial?.description ?? "",
      minimumBalance:
        initial?.minimumBalance !== null && initial?.minimumBalance !== undefined
          ? String(initial.minimumBalance)
          : "",
      initialBalance: "",
      status: initial?.status ?? "ACTIVE",
    });
  }, [open, initial, reset]);

  const type = watch("type") ?? "";
  const status = watch("status") ?? "";

  const typeOptions = FUND_TYPES.map((v) => ({ value: v, label: t(fundTypeLabelKey(v)) }));
  const statusOptions = FUND_STATUSES.map((v) => ({
    value: v,
    label: v === "ACTIVE" ? t("common.active") : v === "INACTIVE" ? t("members.statusLabels.inactive") : t("funds.statusArchived"),
  }));

  const onSubmit = async (values: FundForm) => {
    try {
      if (isEdit && initial) {
        await apiClient(`/funds/${initial.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: values.name,
            type: values.type,
            description: values.description || null,
            status: values.status || undefined,
            // minimumBalance is carried for treasury policy; the current
            // update contract ignores unknown fields (column exists, transfer
            // enforcement reads it).
            minimumBalance: values.minimumBalance?.trim() || undefined,
          }),
        });
        toast.success(t("funds.modal.updatedToast", { name: values.name }));
      } else {
        await apiClient("/funds", {
          method: "POST",
          body: JSON.stringify({
            name: values.name,
            type: values.type,
            description: values.description || undefined,
            initialBalance: values.initialBalance?.trim() ? Number(values.initialBalance) : undefined,
            minimumBalance: values.minimumBalance?.trim() || undefined,
          }),
        });
        toast.success(t("funds.modal.createdToast", { name: values.name }));
      }
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("funds.loadFailed"));
    }
  };

  return (
    <TopSheet open={open} onClose={onClose} title={isEdit ? t("funds.modal.titleEdit") : t("funds.modal.titleNew")}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <ERPFormLayout>
          <ERPFormSection title={isEdit ? t("funds.modal.titleEdit") : t("funds.modal.titleNew")}>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("funds.modal.name")} required error={errors.name?.message}>
                <input type="text" placeholder={t("funds.modal.namePlaceholder")} {...register("name")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("funds.modal.type")} required error={errors.type ? t("funds.modal.selectType") : undefined}>
                <AppDropdown
                  options={typeOptions}
                  value={type || null}
                  onChange={(v) => setValue("type", v ?? "", { shouldValidate: true })}
                  placeholder={t("funds.modal.selectType")}
                />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFormField label={t("funds.modal.description")}>
              <input type="text" placeholder={t("funds.modal.descPlaceholder")} {...register("description")} className={inputCls} />
            </ERPFormField>
            <ERPFormGrid columns={isEdit ? 3 : 2}>
              <ERPFormField label={t("funds.modal.minBalance")} hint={t("funds.modal.minBalanceNote")}>
                <input type="text" inputMode="decimal" placeholder="0.00" {...register("minimumBalance")} className={`${inputCls} font-mono`} />
              </ERPFormField>
              {!isEdit && (
                <ERPFormField label={t("funds.modal.initialBalance")} hint={t("funds.modal.initialNote")}>
                  <input type="text" inputMode="decimal" placeholder="0.00" {...register("initialBalance")} className={`${inputCls} font-mono`} />
                </ERPFormField>
              )}
              {isEdit && (
                <ERPFormField label={t("funds.columns.status")}>
                  <AppDropdown
                    options={statusOptions}
                    value={status || null}
                    onChange={(v) => setValue("status", v ?? "")}
                    placeholder={t("funds.columns.status")}
                    clearable={false}
                  />
                </ERPFormField>
              )}
            </ERPFormGrid>
          </ERPFormSection>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={isSubmitting} loadingLabel={t("funds.modal.saving")}>
              {t("funds.modal.submit")}
            </Button>
          </div>
        </ERPFormLayout>
      </form>
    </TopSheet>
  );
}
