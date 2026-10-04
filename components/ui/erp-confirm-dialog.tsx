"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button, type ButtonVariant } from "./button";

export interface ERPConfirmDialogProps {
  open?: boolean;
  /** Alias for `open` used by feature call sites. */
  isOpen?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Primary for critical-but-safe actions, destructive for deletes/suspends (Rule §3). */
  confirmVariant?: Extract<ButtonVariant, "primary" | "destructive">;
  pending?: boolean;
  pendingLabel?: string;
  /** Optional content between the description and the actions (e.g. a reason input). */
  extra?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

// Accessible confirmation modal for destructive/critical actions (Rule §3).
// - Mounted at document.body via createPortal to render cleanly over all layout elements
// - Dark scrim backdrop (bg-black/60 dark:bg-black/80) preventing layout lines from showing through
export function ERPConfirmDialog({
  open,
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = "destructive",
  pending = false,
  pendingLabel,
  extra,
  onConfirm,
  onClose,
}: ERPConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);
  const visible = open ?? isOpen ?? false;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKey);
    };
  }, [visible, pending, onClose]);

  if (!mounted || !visible || typeof document === "undefined") return null;

  const content = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      {/* Scrim backdrop */}
      <div
        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in-50"
        onClick={() => {
          if (!pending) onClose();
        }}
        aria-hidden="true"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="erp-confirm-title"
        aria-describedby="erp-confirm-description"
        className="relative z-[111] w-full max-w-md bg-card text-card-foreground rounded-2xl border border-border/80 shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150"
      >
        <div className="px-6 pt-6 pb-4 flex items-start gap-3.5 bg-card">
          <div
            className={cn(
              "p-2.5 rounded-xl shrink-0",
              confirmVariant === "destructive"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
            )}
          >
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0">
            <h2
              id="erp-confirm-title"
              className="text-base font-bold tracking-tight text-foreground"
            >
              {title}
            </h2>
            <p
              id="erp-confirm-description"
              className="text-xs text-muted-foreground mt-1 leading-relaxed"
            >
              {description}
            </p>
          </div>
        </div>
        {extra != null && <div className="px-6 pb-4">{extra}</div>}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border/80 bg-muted/20">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending} autoFocus>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            size="sm"
            onClick={() => void onConfirm()}
            loading={pending}
            loadingLabel={pendingLabel}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
