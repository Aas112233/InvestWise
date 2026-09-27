"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, Radio, ShieldAlert, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { Button, Input } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { TopSheet } from "@/components/ui/top-sheet";

interface BroadcastNotice {
  id: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  active: boolean;
  adminEmail: string;
  createdAt: string;
  expiresAt?: string;
}

export default function AdminNoticesPage() {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("info");

  const { data, isLoading } = useQuery<{ success: boolean; data: BroadcastNotice[] }>({
    queryKey: ["admin", "notices"],
    queryFn: () => apiClient<{ success: boolean; data: BroadcastNotice[] }>("/admin/notices"),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient("/admin/notices", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), message: message.trim(), severity }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "notices"] });
      setCreateOpen(false);
      setTitle("");
      setMessage("");
      toast.success(t("admin.notices.created", { defaultValue: "Broadcast announcement posted" }));
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : t("admin.notices.failed", { defaultValue: "Failed to post notice" })
      ),
  });

  const notices = data?.data ?? [];

  const severityTone = (sev: string): "cyan" | "amber" | "rose" => {
    if (sev === "critical") return "rose";
    if (sev === "warning") return "amber";
    return "cyan";
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel", { defaultValue: "SuperAdmin Panel" })}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            {t("admin.notices.title", { defaultValue: "System Broadcasts & Notices" })}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
          >
            <Plus size={14} />
            {t("admin.notices.create", { defaultValue: "New Broadcast" })}
          </Button>
        </div>
      </div>

      {/* Broadcast list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-muted-foreground bg-card rounded-xl border border-border/80">
            {t("common.loading", { defaultValue: "Loading broadcasts…" })}
          </div>
        ) : notices.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl border border-border/80 space-y-3">
            <Radio className="h-8 w-8 mx-auto text-muted-foreground/50 animate-pulse" />
            <p className="text-sm font-semibold text-foreground">
              {t("admin.notices.emptyTitle", { defaultValue: "No active broadcasts" })}
            </p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {t("admin.notices.emptyDesc", {
                defaultValue: "Broadcast system alerts, planned downtime notices, or policy updates to all tenant organizations.",
              })}
            </p>
          </div>
        ) : (
          notices.map((notice) => (
            <div
              key={notice.id}
              className="p-4 sm:p-5 rounded-xl border border-border/80 bg-card space-y-2.5 shadow-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge tone={severityTone(notice.severity)} label={notice.severity} />
                  <h3 className="text-sm font-bold text-foreground">{notice.title}</h3>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {notice.createdAt ? new Date(notice.createdAt).toLocaleString() : ""}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {notice.message}
              </p>
              <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {t("admin.notices.postedBy", { defaultValue: "Posted by:" })} {notice.adminEmail}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/60">{notice.id}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Modal */}
      <TopSheet
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("admin.notices.createTitle", { defaultValue: "Broadcast New Announcement" })}
        subtitle={t("admin.notices.createSubtitle", {
          defaultValue: "This alert will be broadcasted platform-wide across all tenant consoles.",
        })}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="button"
              size="sm"
              loading={createMutation.isPending}
              disabled={createMutation.isPending || !title.trim() || !message.trim()}
              onClick={() => createMutation.mutate()}
            >
              {t("admin.notices.postAction", { defaultValue: "Broadcast Now" })}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 p-4">
          <label className="block text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.notices.titleField", { defaultValue: "Announcement Title" })}</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Scheduled Maintenance Window (Sunday 02:00 UTC)"
              className="text-xs"
            />
          </label>

          <label className="block text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.notices.severityField", { defaultValue: "Severity" })}</span>
            <div className="flex gap-2">
              {(["info", "warning", "critical"] as const).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverity(sev)}
                  className={`flex-1 py-1.5 px-3 rounded-lg border text-xs font-semibold capitalize transition-all ${
                    severity === sev
                      ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                      : "border-border/80 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </label>

          <label className="block text-xs font-medium text-foreground space-y-1">
            <span>{t("admin.notices.messageField", { defaultValue: "Announcement Body" })}</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="We will be performing scheduled database optimizations. Access will be read-only for 15 minutes."
              className="w-full px-3 py-2 rounded-lg border border-border/80 bg-card text-foreground placeholder:text-muted-foreground text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>
        </div>
      </TopSheet>
    </div>
  );
}
