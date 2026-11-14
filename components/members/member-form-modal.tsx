"use client";

import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AppDropdown, type DropdownOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormGrid, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { TopSheet } from "@/components/ui/top-sheet";
import { NumericInput } from "@/components/ui/numeric-input";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { MEMBER_ROLES, memberRoleLabel } from "@/lib/member-roles";
import { decideRoleLock } from "@/lib/member-role-lock";
import { PROJECT_MEMBER_ROLE } from "@/lib/distribution-rules";
import type { Member } from "@/types";

// #68: messages are i18n KEYS (not raw zod prose) so a Bangla treasurer never
// sees "Too small: expected string to have >=2 characters". Rendered via t()
// at the field; unknown keys fall back to themselves.
const formSchema = z.object({
  name: z.string().trim().min(2, "members.validation.nameMin"),
  email: z.string().trim().min(1, "members.validation.emailRequired").email("members.validation.emailInvalid"),
  // Phone is NOT NULL in the schema — required on create and edit alike.
  phone: z.string().trim().min(1, "members.form.phoneRequired"),
  // #4: role is OPTIONAL by design (server default-on-create / leave-alone-on-
  // update — see lib/member-schema.ts memberRoleField). Requiring it here made
  // "Save" a silent no-op whenever the dropdown was untouched, which read as
  // "the form does nothing". Match the server: an empty role is a valid value.
  role: z.string().optional(),
  // Shares are NOT unconditionally required. A Project Level Member holds no club
  // shares at all — lib/member-schema.ts accepts the field as OPTIONAL and
  // refuses any number except 0 for that category, and this form does not even
  // render the input for it. With a hard min(1) here the PM edit prefilled
  // `shares: 0` (the DB value), the guard failed, and the error was attached to a
  // field that is not on screen: "Save" became a silent no-op with no request
  // sent — the exact failure AGENTS.md warns about when a money rule lives only
  // in a hidden field. The rule now mirrors the server: required and ≥ 1 for
  // categories that buy shares, absent for the exclusive one.
  shares: z
    .number({ error: "members.validation.sharesRequired" })
    .int("members.validation.sharesWhole")
    .optional(),
  // Project-Member extras (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md §3.2): the
  // lifetime deposit cap and, on create, the single bound project. Drafts as
  // strings — an empty box must never coerce to 0 (AGENTS.md §15).
  depositCap: z.string().optional(),
  projectId: z.string().optional(),
  nidOrPassport: z.string().trim().optional(),
  fatherName: z.string().trim().optional(),
  address: z.string().trim().optional(),
  nomineeName: z.string().trim().optional(),
  nomineeRelation: z.string().trim().optional(),
  nomineeNidOrPassport: z.string().trim().optional(),
  nomineePhone: z.string().trim().optional(),
});

type FormValues = z.infer<typeof formSchema>;

/** Cap draft → positive ≤2dp number, or null when empty/invalid. */
function parseCapDraft(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null;
  return n;
}

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

// Add/Edit member modal. Shares are set once at creation and locked
// afterwards (derived from the ledger), so the edit form omits them.
export function MemberFormModal({
  open,
  initial,
  onClose,
  onSaved,
  canOverrideRoleLock = false,
}: {
  open: boolean;
  initial: Member | null;
  onClose: () => void;
  onSaved: () => void;
  /** Authz Admins may override a locked member type with a written reason (lib/member-role-lock.ts). */
  canOverrideRoleLock?: boolean;
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

  // Shares stay editable until a transaction links to the member — the same
  // rule PUT /api/members/[id] enforces server-side (FOR UPDATE guard).
  // Evidence order: the list row's hasTransactions (counts ALL linked txn
  // rows incl. soft-deleted); the detail's recent-deposit list as fallback
  // when editing was opened from the detail sheet. Unknown = locked.
  const detailWithDeposits = full as (Member & { deposits?: unknown[] }) | null;
  const hasNoTransactions =
    initial?.hasTransactions === false ||
    (initial?.hasTransactions === undefined &&
      detailWithDeposits !== null &&
      (detailWithDeposits.deposits?.length ?? 1) === 0);
  const sharesLocked = isEdit && !hasNoTransactions;

  // Member TYPE lock (lib/member-role-lock.ts): same transaction evidence as
  // the shares lock, same decision the PUT route runs. Money-category changes
  // freeze once transactions exist; Admin/Manager/Auditor swaps stay free.
  // The UI mirrors the server — the server decides.
  const originalRole = full?.role ?? initial?.role ?? "";
  const roleTxLocked = isEdit && !hasNoTransactions;
  const [roleOverrideChecked, setRoleOverrideChecked] = useState(false);
  const [roleOverrideReason, setRoleOverrideReason] = useState("");

  const roleOptions: DropdownOption[] = useMemo(
    () =>
      MEMBER_ROLES.map((r) => ({
        value: r,
        label: t(memberRoleLabel(r)),
        disabled:
          roleTxLocked &&
          !roleOverrideChecked &&
          decideRoleLock(originalRole, r).kind === "lock-required",
      })),
    [t, roleTxLocked, roleOverrideChecked, originalRole],
  );

  // Project-Member conditional gate — mirrors the create-route superRefine so
  // the form never accepts what the server would refuse (and vice versa).
  const schema = useMemo(
    () =>
      formSchema.superRefine((v, ctx) => {
        if (v.role !== PROJECT_MEMBER_ROLE) {
          // Every other category funds with shares, so the number is mandatory
          // there — the same split lib/member-schema.ts draws by role.
          if (!Number.isInteger(v.shares) || (v.shares as number) < 1) {
            ctx.addIssue({ code: "custom", path: ["shares"], message: "members.validation.sharesMin" });
          }
          return;
        }
        if (parseCapDraft(v.depositCap) === null) {
          ctx.addIssue({
            code: "custom",
            path: ["depositCap"],
            message: "members.validation.projectCapRequired",
          });
        }
        if (!isEdit && !v.projectId) {
          ctx.addIssue({ code: "custom", path: ["projectId"], message: "members.validation.projectMemberProjectRequired" });
        }
      }),
    [isEdit],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      role: "",
      shares: 1,
      depositCap: "",
      projectId: "",
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
    // The override is a per-edit decision, never a remembered preference.
    setRoleOverrideChecked(false);
    setRoleOverrideReason("");
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
      depositCap: source?.depositCap != null ? String(source.depositCap) : "",
      projectId: "",
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
  const isProjectMember = role === PROJECT_MEMBER_ROLE;
  const projectId = watch("projectId") ?? "";

  // Project picker for the create-time binding, fetched only when it can be
  // needed. Settled/locked projects are hidden here because the create route
  // refuses a binding to one — hiding them prevents a doomed attempt.
  //
  // Filtered to Extra Investor projects (migration 0032): a Project Level Member
  // only exists inside a contract, and a Club Level project has no seat for one.
  // The filter is convenience; POST /api/members is the rule (CLUB_PROJECT_TAKES_NO_PM),
  // so a stale list can offer a club project but cannot create the binding.
  const projectChoices = useQuery({
    // The filter is part of the cache identity: the key used to stay
    // ["projects","member-binding"] while the URL gained ?projectType=, so a list
    // cached before the change (unfiltered, club projects included) would be
    // served to this picker and offer a binding the create route then refuses.
    queryKey: ["projects", "member-binding", "extra_investor"],
    queryFn: () => apiClient<{ success: boolean; data: { id: string; title: string; projectCode?: string | null; isLocked?: boolean }[] }>("/projects?projectType=extra_investor"),
    enabled: open && !isEdit && isProjectMember,
    // A fresh list on every open (the house 30s staleTime would otherwise
    // serve a pre-creation snapshot): cross-tab invalidation
    // (lib/query-client.ts) keeps a live picker current, but a project
    // created while THIS tab was closed broadcast nothing to it.
    staleTime: 0,
  });
  const projectOptions: DropdownOption[] = useMemo(
    () =>
      (projectChoices.data?.data ?? [])
        .filter((p) => !p.isLocked)
        // Codes disambiguate same-titled projects (migration 0031).
        .map((p) => ({ value: p.id, label: `${p.projectCode ? `${p.projectCode} — ` : ""}${p.title}` })),
    [projectChoices.data],
  );

  const onSubmit = async (values: FormValues) => {
    // Type-lock client mirror: a locked money-category change is refused here
    // unless the Admin override is checked AND a reason is written. The PUT
    // route enforces the same rule (plus authz + the transaction check); this
    // only stops an obviously-doomed save before it hits the wire.
    if (isEdit && roleTxLocked && decideRoleLock(originalRole, values.role).kind === "lock-required") {
      if (!canOverrideRoleLock) {
        toast.error(t("members.form.roleLockedNote", { defaultValue: "The member type is locked once this member has transactions (like share numbers)." }));
        return;
      }
      if (!roleOverrideChecked) {
        toast.error(t("members.form.roleOverrideConfirm", { defaultValue: "Tick the Admin override to change a locked member type." }));
        return;
      }
      if (roleOverrideReason.trim().length === 0) {
        toast.error(t("members.form.roleOverrideReasonRequired", { defaultValue: "A reason is required to override the locked member type." }));
        return;
      }
    }
    try {
      if (isEdit && initial) {
        await apiClient(`/members/${initial.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: values.name,
            email: values.email,
            phone: values.phone.trim(),
            role: values.role,
            // Sent only when the Admin override is actually being exercised;
            // the route ignores it for unlocked/unchanged types.
            ...(roleTxLocked &&
            roleOverrideChecked &&
            decideRoleLock(originalRole, values.role).kind === "lock-required"
              ? { roleOverrideReason: roleOverrideReason.trim() }
              : {}),
            // Only send shares while the field is editable — sending the
            // prefill for a locked member trips the server lock for no reason.
            // A Project Member never has editable club shares at all.
            ...(sharesLocked || isProjectMember ? {} : { shares: values.shares }),
            // The schema gate guarantees a parse for Project Members.
            ...(isProjectMember ? { depositCap: parseCapDraft(values.depositCap) } : {}),
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
            role: values.role || undefined,
            // Project Member: cap + bound project in, club shares out (the
            // server forces the 0 and requires both extras — §3.2).
            ...(isProjectMember
              ? { depositCap: parseCapDraft(values.depositCap), projectId: values.projectId }
              : { shares: values.shares }),
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
              <ERPFormField label={t("members.form.name")} required error={errors.name?.message ? t(errors.name.message) : undefined}>
                <input type="text" autoComplete="name" maxLength={255} {...register("name")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.email")} required error={errors.email?.message ? t(errors.email.message) : undefined}>
                <input type="email" autoComplete="email" maxLength={255} {...register("email")} className={inputCls} />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("members.form.phone")} required error={errors.phone ? t("members.form.phoneRequired") : undefined}>
                <input type="tel" autoComplete="tel" maxLength={50} {...register("phone")} className={inputCls} />
              </ERPFormField>
              <ERPFormField
                label={t("members.form.role")}
                error={errors.role ? t("members.form.selectRole") : undefined}
                hint={
                  roleTxLocked && !roleOverrideChecked
                    ? t("members.form.roleLockedNote", {
                        defaultValue: "Type is locked once this member has transactions (like share numbers)",
                      })
                    : undefined
                }
              >
                <AppDropdown
                  options={roleOptions}
                  value={role || null}
                  onChange={(v) => setValue("role", v ?? "", { shouldValidate: true })}
                  placeholder={t("members.form.selectRole")}
                />
              </ERPFormField>
            </ERPFormGrid>
            {roleTxLocked && canOverrideRoleLock && (
              // Admin escape hatch (lib/member-role-lock.ts): the change still
              // goes through the PUT route, which re-checks authz and writes
              // the reason into the audit trail.
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border/80 text-primary focus:ring-primary/40"
                    checked={roleOverrideChecked}
                    onChange={(e) => setRoleOverrideChecked(e.target.checked)}
                  />
                  {t("members.form.roleOverrideLabel", {
                    defaultValue: "Admin override: change this member's locked type",
                  })}
                </label>
                {roleOverrideChecked && (
                  <ERPFormField
                    label={t("members.form.roleOverrideReasonLabel", { defaultValue: "Reason for the change" })}
                    required
                    error={
                      roleOverrideReason.trim().length === 0
                        ? t("members.form.roleOverrideReasonRequired", {
                            defaultValue: "A reason is required to override the locked member type.",
                          })
                        : undefined
                    }
                  >
                    <input
                      type="text"
                      value={roleOverrideReason}
                      onChange={(e) => setRoleOverrideReason(e.target.value)}
                      placeholder={t("members.form.roleOverrideReasonPlaceholder", {
                        defaultValue: "e.g. corrected a category mistake made at enrolment",
                      })}
                      className={inputCls}
                    />
                  </ERPFormField>
                )}
              </div>
            )}
            {isProjectMember ? (
              // The exclusive project category: deposit cap + one bound project
              // replace club shares entirely (§3.2 — no club position to set).
              <ERPFormGrid columns={2}>
                <ERPFormField
                  label={t("members.form.projectCap", { defaultValue: "Deposit cap" })}
                  required
                  hint={t("members.form.projectCapHint", { defaultValue: "Lifetime maximum this member may deposit into the club" })}
                  error={errors.depositCap?.message ? t(errors.depositCap.message) : undefined}
                >
                  <NumericInput type="number" min={0.01} step={0.01} {...register("depositCap")} className={inputCls} />
                </ERPFormField>
                {!isEdit ? (
                  <ERPFormField
                    label={t("members.form.projectBinding", { defaultValue: "Bound project" })}
                    required
                    hint={t("members.form.projectBindingHint", {
                      defaultValue:
                        "Only Extra Investor projects appear: a Project Level Member exists inside a contract, and a Club Level project has no seat for one.",
                    })}
                    error={errors.projectId?.message ? t(errors.projectId.message) : undefined}
                  >
                    <AppDropdown
                      options={projectOptions}
                      value={projectId || null}
                      placeholder={t("members.form.selectProject", { defaultValue: "Select a project" })}
                      onChange={(v) => setValue("projectId", v ?? "", { shouldValidate: true })}
                    />
                  </ERPFormField>
                ) : (
                  <ERPFormField label={t("members.form.projectBinding", { defaultValue: "Bound project" })}>
                    <p className="text-[11px] text-slate-400 pt-2">
                      {t("members.form.projectBindingEditNote", { defaultValue: "Managed from the project's shareholder list" })}
                    </p>
                  </ERPFormField>
                )}
                {!isEdit ? (
                  <ERPFormField label={t("members.form.nid")}>
                    <input type="text" maxLength={100} {...register("nidOrPassport")} className={inputCls} />
                  </ERPFormField>
                ) : null}
              </ERPFormGrid>
            ) : !isEdit ? (
              <ERPFormGrid columns={2}>
                <ERPFormField label={t("members.form.shares")} required error={errors.shares?.message ? t(errors.shares.message) : undefined}>
                  <NumericInput type="number" min={1} step={1} {...register("shares", { valueAsNumber: true })} className={inputCls} />
                </ERPFormField>
                <ERPFormField label={t("members.form.nid")}>
                  <input type="text" {...register("nidOrPassport")} className={inputCls} />
                </ERPFormField>
              </ERPFormGrid>
            ) : sharesLocked ? (
              <p className="text-[11px] text-slate-400">{t("members.form.sharesLockedNote")}</p>
            ) : (
              <ERPFormGrid columns={2}>
                <ERPFormField
                  label={t("members.form.shares")}
                  required
                  hint={t("members.form.sharesEditableNote", {
                    defaultValue: "Editable while this member has no transactions",
                  })}
                  error={errors.shares?.message ? t(errors.shares.message) : undefined}
                >
                  <NumericInput type="number" min={1} step={1} {...register("shares", { valueAsNumber: true })} className={inputCls} />
                </ERPFormField>
              </ERPFormGrid>
            )}
          </ERPFormSection>

          <ERPFormSection title={t("members.detail.contactTitle")}>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("members.form.father")}>
                <input type="text" maxLength={255} {...register("fatherName")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.address")}>
                <input type="text" maxLength={500} {...register("address")} className={inputCls} />
              </ERPFormField>
            </ERPFormGrid>
            <ERPFormGrid columns={2}>
              <ERPFormField label={t("members.form.nominee")}>
                <input type="text" maxLength={255} {...register("nomineeName")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.nomineeRelation")}>
                <input type="text" maxLength={100} {...register("nomineeRelation")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.nomineeNid")}>
                <input type="text" maxLength={100} {...register("nomineeNidOrPassport")} className={inputCls} />
              </ERPFormField>
              <ERPFormField label={t("members.form.nomineePhone")}>
                <input type="tel" maxLength={50} {...register("nomineePhone")} className={inputCls} />
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
