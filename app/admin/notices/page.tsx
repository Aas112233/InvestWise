"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pencil, Plus, Power, Radio, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import { Button, Input } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { TopSheet } from "@/components/ui/top-sheet";
import { ERPConfirmDialog } from "@/components/ui/erp-confirm-dialog";
import { ERPFormField } from "@/components/ui/erp-form-layout";

type Severity = "info" | "warning" | "critical";

interface BroadcastNotice {
  id: string;
  title: string;
  message: string;
  severity: Severity;
  active: boolean;
  adminEmail: string;
  createdAt: string;
  expiresAt?: string | null;
}

interface DraftNotice {
  title: string;
  message: string;
  severity: Severity;
  active: boolean;
}

const EMPTY_DRAFT: DraftNotice = { title: "", message: "", severity: "info", active: true };

export default function AdminNoticesPage() {
  const { t } = useLocale();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<DraftNotice | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [retractTarget, setRetractTarget] = useState<BroadcastNotice | null>(null);
  const [toggleTarget, setToggleTarget] = useState<BroadcastNotice | null>(null);

  const { data, isLoading } = useQuery<{ success: boolean; data: BroadcastNotice[] }>({
    queryKey: ["admin", "notices"],
    queryFn: () => apiClient<{ success: boolean; data: BroadcastNotice[] }>("/admin/notices"),
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: (input: { id: string | null; body: DraftNotice }) =>
      input.id
        ? apiClient(`/admin/notices/${input.id}`, {
            method: "PATCH",
            body: JSON.stringify(input.body),
          })
        : apiClient("/admin/notices", { method: "POST", body: JSON.stringify(input.body) }),
    onSuccess: (_res, input) => {
      void qc.invalidateQueries({ queryKey: ["admin", "notices"] });
      setDraft(null);
      setEditingId(null);
      toast.success(
        input.id
          ? t("admin.notices.updated", { defaultValue: "Broadcast updated" })
          : t("admin.notices.created", { defaultValue: "Broadcast announcement posted" })
      );
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.notices.failed", { defaultValue: "Failed to post notice" })
      ),
  });

  const retractMutation = useMutation({
    mutationFn: (id: string) => apiClient(`/admin/notices/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "notices"] });
      setRetractTarget(null);
      toast.success(t("admin.notices.retracted", { defaultValue: "Broadcast retracted" }));
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.notices.retractFailed", { defaultValue: "Failed to retract notice" })
      ),
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      apiClient(`/admin/notices/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: input.active }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "notices"] });
      setToggleTarget(null);
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError
          ? err.message
          : t("admin.notices.failed", { defaultValue: "Failed to update notice" })
      ),
  });

  const notices = data?.data ?? [];

  const severityTone = (sev: string): "cyan" | "amber" | "rose" => {
    if (sev === "critical") return "rose";
    if (sev === "warning") return "amber";
    return "cyan";
  };

  const openEdit = (n: BroadcastNotice) => {
    setEditingId(n.id);
    setDraft({ title: n.title, message: n.message, severity: n.severity, active: n.active });
  };

  const isEditing = editingId !== null;
  const canSave = draft !== null && draft.title.trim().length > 0 && draft.message.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/80">
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
            {t("nav.superadminPanel", { defaultValue: "SuperAdmin Panel" })}
          </p>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            {t("admin.notices.title", { defaultValue: "System Broadcasts & Notices" })}
          </h1>
        </div>

        <Button
          size="sm"
          onClick={() => {
            setEditingId(null);
            setDraft(EMPTY_DRAFT);
          }}
          className="gap-1.5"
        >
          <Plus size={14} />
          {t("admin.notices.create", { defaultValue: "New Broadcast" })}
        </Button>
      </div>

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
                defaultValue:
                  "Broadcast system alerts, planned downtime notices, or policy updates to all tenant organizations.",
              })}
            </p>
          </div>
        ) : (
          notices.map((notice) => (
            <div
              key={notice.id}
              className={`p-4 sm:p-5 rounded-xl border bg-card space-y-2.5 shadow-xs ${
                notice.active ? "border-border/80" : "border-border/40 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge tone={severityTone(notice.severity)} label={notice.severity} />
                  <h3 className="text-sm font-bold text-foreground">{notice.title}</h3>
                  {!notice.active && (
                    <StatusBadge
                      tone="slate"
                      label={t("admin.notices.inactive", { defaultValue: "inactive" })}
                    />
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(notice)}
                    title={t("admin.notices.edit", { defaultValue: "Edit broadcast" })}
                    aria-label={`${t("admin.notices.edit", { defaultValue: "Edit broadcast" })}: ${notice.title}`}
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setToggleTarget(notice)}
                    title={
                      notice.active
                        ? t("admin.notices.deactivate", { defaultValue: "Deactivate" })
                        : t("admin.notices.activate", { defaultValue: "Reactivate" })
                    }
                    aria-label={`${
                      notice.active
                        ? t("admin.notices.deactivate", { defaultValue: "Deactivate" })
                        : t("admin.notices.activate", { defaultValue: "Reactivate" })
                    }: ${notice.title}`}
                  >
                    <Power size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRetractTarget(notice)}
                    title={t("admin.notices.retract", { defaultValue: "Retract permanently" })}
                    aria-label={`${t("admin.notices.retract", { defaultValue: "Retract permanently" })}: ${notice.title}`}
                    className="text-rose-600 hover:text-rose-700"
                  >
                    <Trash2 size={13} />
                  </Button>
                  <span className="font-mono text-[11px] text-muted-foreground ml-1 hidden sm:inline">
                    {notice.createdAt ? new Date(notice.createdAt).toLocaleString() : ""}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {notice.message}
              </p>
              <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {t("admin.notices.postedBy", { defaultValue: "Posted by:" })}{" "}
                  {notice.adminEmail}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/60">{notice.id}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <TopSheet
        isOpen={draft !== null}
        onClose={() => {
          setDraft(null);
          setEditingId(null);
        }}
        title={
          isEditing
            ? t("admin.notices.editTitle", { defaultValue: "Edit Broadcast" })
            : t("admin.notices.createTitle", { defaultValue: "Broadcast New Announcement" })
        }
        subtitle={t("admin.notices.createSubtitle", {
          defaultValue: "This alert will be broadcasted platform-wide across all tenant consoles.",
        })}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="button"
              size="sm"
              loading={saveMutation.isPending}
              disabled={!canSave || saveMutation.isPending}
              onClick={() => draft && saveMutation.mutate({ id: editingId, body: draft })}
            >
              {isEditing
                ? t("common.save", { defaultValue: "Save changes" })
                : t("admin.notices.postAction", { defaultValue: "Broadcast Now" })}
            </Button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-4 p-4">
            <ERPFormField
              label={t("admin.notices.titleField", { defaultValue: "Announcement Title" })}
              required
            >
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={t("admin.notices.titlePlaceholder", {
                  defaultValue: "Scheduled Maintenance Window (Sunday 02:00 UTC)",
                })}
                className="text-xs"
              />
            </ERPFormField>

            <ERPFormField
              label={t("admin.notices.severityField", { defaultValue: "Severity" })}
              required
            >
              <div className="flex gap-2">
                {(["info", "warning", "critical"] as const).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setDraft({ ...draft, severity: sev })}
                    className={`flex-1 py-1.5 px-3 rounded-lg border text-xs font-semibold capitalize transition-all ${
                      draft.severity === sev
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                        : "border-border/80 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </ERPFormField>

            <ERPFormField
              label={t("admin.notices.messageField", { defaultValue: "Announcement Body" })}
              required
            >
              <textarea
                value={draft.message}
                onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                rows={4}
                placeholder={t("admin.notices.messagePlaceholder", {
                  defaultValue:
                    "We will be performing scheduled database optimizations. Access will be read-only for 15 minutes.",
                })}
                className="w-full px-3 py-2 rounded-lg border border-border/80 bg-card text-foreground placeholder:text-muted-foreground text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </ERPFormField>

            {isEditing && (
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                {t("admin.notices.keepActive", { defaultValue: "Active (visible to tenants)" })}
              </label>
            )}
          </div>
        )}
      </TopSheet>

      <ERPConfirmDialog
        isOpen={toggleTarget !== null}
        onClose={() => setToggleTarget(null)}
        title={
          toggleTarget?.active
            ? t("admin.notices.deactivateTitle", { defaultValue: "Deactivate this broadcast?" })
            : t("admin.notices.activateTitle", { defaultValue: "Reactivate this broadcast?" })
        }
        description={
          toggleTarget?.active
            ? t("admin.notices.deactivateDesc", {
                defaultValue:
                  "It stops being shown to tenants but stays in the list so you can bring it back.",
              })
            : t("admin.notices.activateDesc", {
                defaultValue: "It becomes visible to tenants again.",
              })
        }
        confirmLabel={
          toggleTarget?.active
            ? t("admin.notices.deactivate", { defaultValue: "Deactivate" })
            : t("admin.notices.activate", { defaultValue: "Reactivate" })
        }
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant={toggleTarget?.active ? "destructive" : "primary"}
        pending={toggleMutation.isPending}
        onConfirm={() => {
          if (toggleTarget) {
            toggleMutation.mutate({ id: toggleTarget.id, active: !toggleTarget.active });
          }
        }}
      />

      <ERPConfirmDialog
        isOpen={retractTarget !== null}
        onClose={() => setRetractTarget(null)}
        title={t("admin.notices.retractTitle", { defaultValue: "Retract this broadcast?" })}
        description={t("admin.notices.retractDesc", {
          defaultValue:
            "It disappears for every tenant and cannot be restored. A record of the retraction is kept in the platform action log.",
        })}
        confirmLabel={t("admin.notices.retract", { defaultValue: "Retract permanently" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        confirmVariant="destructive"
        pending={retractMutation.isPending}
        onConfirm={() => {
          if (retractTarget) retractMutation.mutate(retractTarget.id);
        }}
      />
    </div>
  );
}
