"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ERPFormField, ERPFormLayout, ERPFormSection } from "@/components/ui/erp-form-layout";
import { TopSheet } from "@/components/ui/top-sheet";
import { ApiError, apiClient } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import type { TenantUser } from "./types";

const inputCls =
  "w-full px-3 py-2 rounded-xl border text-xs bg-card border-border/80 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-colors";

/**
 * Password input with a reveal toggle. Both fields here are typed to be handed
 * to someone else, so being able to confirm what was actually typed matters
 * more than the usual "show my own password" convenience.
 */
function RevealInput({
  value,
  onChange,
  ariaLabel,
  showLabel,
  hideLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={`${inputCls} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

// Admin-issued credential reset for a tenant user (locked-out account recovery).
export function ResetPasswordModal({
  target,
  onClose,
}: {
  target: TenantUser | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (target) {
      setPassword("");
      setConfirm("");
    }
  }, [target]);

  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length > 0 && password === confirm && !pending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !canSubmit) return;
    setPending(true);
    try {
      await apiClient(`/auth/users/${target.id}`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      toast.success(t("users.form.resetToast", { name: target.name }));
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("users.errors.saveFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <TopSheet open={target !== null} onClose={pending ? () => undefined : onClose} title={t("users.form.titleReset")}>
      <form method="post" onSubmit={onSubmit} noValidate>
        <ERPFormLayout>
          <ERPFormSection title={t("users.form.resetFor", { name: target?.name ?? "" })}>
            <ERPFormField label={t("users.form.newPassword")} required>
              <RevealInput
                value={password}
                onChange={setPassword}
                ariaLabel={t("users.form.newPassword")}
                showLabel={t("users.form.showPassword", { defaultValue: "Show password" })}
                hideLabel={t("users.form.hidePassword", { defaultValue: "Hide password" })}
              />
            </ERPFormField>
            <ERPFormField
              label={t("users.form.confirmPassword")}
              required
              error={mismatch ? t("users.form.passwordMismatch") : undefined}
            >
              <RevealInput
                value={confirm}
                onChange={setConfirm}
                ariaLabel={t("users.form.confirmPassword")}
                showLabel={t("users.form.showPassword", { defaultValue: "Show password" })}
                hideLabel={t("users.form.hidePassword", { defaultValue: "Hide password" })}
              />
            </ERPFormField>
            <p className="text-[11px] text-slate-400">{t("users.form.passwordPolicyNote")}</p>
          </ERPFormSection>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={pending} disabled={!canSubmit}>
              {t("users.form.resetConfirm")}
            </Button>
          </div>
        </ERPFormLayout>
      </form>
    </TopSheet>
  );
}
