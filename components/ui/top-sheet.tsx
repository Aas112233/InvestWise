"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import { ERPConfirmDialog } from "./erp-confirm-dialog";

export interface TopSheetProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  className?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "full";
  /**
   * When true, dismissing the sheet first asks for confirmation instead of
   * silently discarding the user's input (report issue 7).
   */
  isDirty?: boolean;
  /** Called after the user confirms discarding their input. */
  onDiscard?: () => void;
}

const maxWidthClasses: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  full: "max-w-[96vw]",
};

// Portal-rendered top-anchored drawer:
// - Mounted at document.body via createPortal to sit cleanly above sidebar, header, and all layout elements
// - High z-index (z-[100]) with true dark scrim (bg-black/60 dark:bg-black/80) preventing layout grid lines from bleeding through
// - Completely opaque bg-card surface for drawer, header, and footer
export function TopSheet({
  open,
  isOpen,
  onClose,
  title,
  subtitle,
  description,
  children,
  footer,
  wide = false,
  className,
  maxWidth,
  isDirty = false,
  onDiscard,
}: TopSheetProps) {
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  const isVisible = open ?? isOpen ?? false;
  const sub = subtitle ?? description;

  /**
   * Set on backdrop `pointerdown`, cleared on `pointerup`. The sheet closes
   * only when the gesture BOTH starts and ends on the backdrop — a press that
   * begins inside a portaled child (e.g. a dropdown menu) and releases over
   * the backdrop used to fire `click` on the backdrop and destroy the form
   * (report issue 6).
   */
  const backdropPointerDown = useRef(false);

  // Unsaved-changes guard (report issue 7).
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /** Gate every dismissal behind the unsaved-changes confirmation. */
  const requestClose = () => {
    if (isDirtyRef.current) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKey);
    };
  });

  if (!mounted || !isVisible || typeof document === "undefined") return null;

  const content = (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto">
      {/* High-contrast backdrop scrim: completely suppresses background lines and table grids */}
      <div
        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm transition-opacity animate-in fade-in-50"
        onPointerDown={(e) => {
          backdropPointerDown.current = e.button === 0 && e.target === e.currentTarget;
        }}
        onClick={(e) => {
          const startOnBackdrop = backdropPointerDown.current;
          backdropPointerDown.current = false;
          if (e.target === e.currentTarget && startOnBackdrop) requestClose();
        }}
        aria-hidden="true"
      />

      {/* Drawer Container: 100% solid opaque bg-card, elevated above background */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-[101] w-full flex flex-col max-h-[92vh] bg-card text-card-foreground rounded-b-2xl border-b border-x border-border/80 dark:border-white/10 shadow-2xl animate-in slide-in-from-top-4 duration-200 overflow-hidden my-0",
          wide ? "max-w-5xl" : (maxWidth ? maxWidthClasses[maxWidth] : "max-w-4xl"),
          className,
        )}
      >
        {/* Header - 100% solid bg-card */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 px-6 py-4 border-b border-border/80 bg-card">
          <div className="space-y-0.5">
            <h2 className="text-base font-bold tracking-tight text-foreground">
              {title}
            </h2>
            {sub && (
              <p className="text-xs text-muted-foreground">{sub}</p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-card text-card-foreground">
          {children}
        </div>

        {/* Footer - 100% solid bg-card */}
        {footer && (
          <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-border/80 bg-card rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>

      {/* Unsaved-changes confirmation (report issue 7) — sibling portal so it
          stacks above the sheet (z-[110] vs z-[100]). */}
      <ERPConfirmDialog
        isOpen={confirmDiscard}
        title={t("ui.unsavedTitle")}
        description={t("ui.unsavedBody")}
        confirmLabel={t("ui.discardConfirm")}
        cancelLabel={t("ui.discardCancel")}
        onConfirm={() => {
          setConfirmDiscard(false);
          onDiscard?.();
          onClose();
        }}
        onClose={() => setConfirmDiscard(false)}
      />
    </div>
  );

  return createPortal(content, document.body);
}
