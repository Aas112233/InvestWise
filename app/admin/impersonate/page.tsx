"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { Button, Input } from "@/components/ui";

interface ImpersonateResult {
  token: string;
  expiresIn: string;
  tenantId: string | null;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

// Support sessions: issue a 30-minute token AS the target user (impersonatedBy
// attribution is embedded + audit-logged server-side). Platform operators
// cannot be impersonated. Paste the target user ID (UUID).
export default function AdminImpersonatePage() {
  const { t } = useLocale();
  const [userId, setUserId] = useState("");
  const [session, setSession] = useState<(ImpersonateResult & { email: string }) | null>(null);
  const [copied, setCopied] = useState(false);

  const issueMutation = useMutation({
    mutationFn: () =>
      apiClient<{ success: boolean; data: ImpersonateResult & { email?: string } }>("/admin/impersonate", {
        method: "POST",
        body: JSON.stringify({ userId: userId.trim() }),
      }),
    onSuccess: (res) => {
      setSession({ ...res.data, email: res.data.email ?? "" });
      setCopied(false);
      toast.success(t("admin.impersonate.issued", { defaultValue: "Support session issued (30 minutes)" }));
    },
    onError: (err) => toast.error(errMsg(err, t("admin.impersonate.issueFailed", { defaultValue: "Issue failed" }))),
  });

  const revokeMutation = useMutation({
    mutationFn: (token: string) =>
      apiClient("/admin/impersonate", { method: "DELETE", body: JSON.stringify({ token }) }),
    onSuccess: () => {
      setSession(null);
      setUserId("");
      toast.success(t("admin.impersonate.revoked", { defaultValue: "Session revoked" }));
    },
    onError: (err) => toast.error(errMsg(err, t("admin.impersonate.revokeFailed", { defaultValue: "Revoke failed" }))),
  });

  const copyToken = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.token);
      setCopied(true);
    } catch {
      toast.error(t("admin.impersonate.copyFailed", { defaultValue: "Copy failed — select the token manually" }));
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="pb-2 border-b border-border/80">
        <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
          {t("nav.superadminPanel")}
        </p>
        <h1 className="text-lg font-bold tracking-tight text-foreground">
          {t("admin.impersonate.title", { defaultValue: "Impersonate User" })}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          {t("admin.impersonate.desc", {
            defaultValue: "Open a 30-minute support session as a tenant user. Every action is audit-logged under your admin identity.",
          })}
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border/80 shadow-xs p-4 space-y-3">
        <label className="block text-xs font-medium text-foreground space-y-1">
          <span>{t("admin.impersonate.userId", { defaultValue: "Target user ID (UUID)" })}</span>
          <div className="flex gap-2">
            <Input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              disabled={session !== null || issueMutation.isPending}
              className="flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              disabled={!userId.trim() || issueMutation.isPending || session !== null}
              loading={issueMutation.isPending}
              onClick={() => issueMutation.mutate()}
              className="gap-1.5"
            >
              <KeyRound size={13} />
              {t("admin.impersonate.issue", { defaultValue: "Issue Session" })}
            </Button>
          </div>
        </label>

        {session && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {t("admin.impersonate.active", { defaultValue: "Active support session" })}
              {session.email ? ` — ${session.email}` : ""}
            </p>
            <textarea
              readOnly
              value={session.token}
              rows={3}
              className="w-full px-2 py-1.5 rounded-lg border border-border/80 bg-card text-foreground font-mono text-[11px] break-all outline-none"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyToken()}
                className="gap-1.5"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied
                  ? t("admin.impersonate.copied", { defaultValue: "Copied" })
                  : t("admin.impersonate.copy", { defaultValue: "Copy Token" })}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={revokeMutation.isPending}
                loading={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(session.token)}
                className="gap-1.5"
              >
                {!revokeMutation.isPending && <XCircle size={13} />}
                {t("admin.impersonate.revoke", { defaultValue: "Revoke Session" })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
