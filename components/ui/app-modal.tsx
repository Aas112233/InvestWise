"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n";
import { Button } from "./button";
import { ERPConfirmDialog } from "./erp-confirm-dialog";

export interface AppModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "full";
  /**
   * When true, dismissing the modal (backdrop, X, Escape) first asks for
   * confirmation instead of silently throwing away what the user typed
   * (report issue 7). Call the `markDirty`/`markSaved` callbacks the modal
   * passes to `children` to drive this.
   */
  isDirty?: boolean;
  /** Called after the user confirms discarding their input. */
  onDiscard?: () => void;
}

const ANIMATION_DURATION = 200;

export function AppModal({
  isOpen,
  onClose,
  title,
  description,
  icon,
  footer,
  children,
  className,
  maxWidth = "md",
  isDirty = false,
  onDiscard,
}: AppModalProps) {
  const { t } = useLocale();
  const [isMounted, setIsMounted] = useState(false);
  const [animationState, setAnimationState] = useState<"entering" | "open" | "exiting" | "closed">("closed");
  const backdropRef = useRef<HTMLDivElement>(null);
  /**
   * Set on backdrop `pointerdown`, cleared on `pointerup`. The modal only
   * closes when BOTH ends of the click land on the backdrop.
   *
   * Plain `onClick` on the backdrop was closing the dialog when the user
   * pressed down inside a portaled child (e.g. a dropdown menu rendered
   * outside the modal's DOM subtree) and released over the backdrop — the
   * browser then dispatched `click` on the backdrop, destroying the form and
   * everything typed into it (report issue 6). Requiring the press to also
   * START on the backdrop makes an in-flight drag from a child harmless.
   */
  const backdropPointerDown = useRef(false);

  // Unsaved-changes guard (report issue 7). `isDirtyRef` shadows the prop so
  // the close path reads the latest value without re-creating handlers.
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
    if (isOpen) {
      setIsMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimationState("entering");
          const timer = setTimeout(() => setAnimationState("open"), ANIMATION_DURATION);
          return () => clearTimeout(timer);
        });
      });
      document.body.style.overflow = "hidden";
    } else if (isMounted) {
      setAnimationState("exiting");
      const timer = setTimeout(() => {
        setAnimationState("closed");
        setIsMounted(false);
        document.body.style.overflow = "unset";
      }, ANIMATION_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isMounted]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape is also a dismissal — respect the unsaved-changes guard.
      if (e.key === "Escape") requestClose();
    };
    if (isOpen) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  if (!isMounted || typeof document === "undefined") return null;

  const isVisible = animationState === "entering" || animationState === "open";

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
    full: "max-w-[95vw]",
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Animated Backdrop — fade in/out with blur */}
      <div
        ref={backdropRef}
        className={cn(
          "fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity",
          isVisible
            ? "opacity-100 duration-250 ease-out"
            : "opacity-0 duration-200 ease-in",
        )}
        onPointerDown={(e) => {
          // Only a primary-button press that begins on the backdrop counts.
          backdropPointerDown.current = e.button === 0 && e.target === e.currentTarget;
        }}
        onClick={(e) => {
          // Close only when the gesture both started and ended on the backdrop
          // — see `backdropPointerDown` above (report issue 6).
          const startOnBackdrop = backdropPointerDown.current;
          backdropPointerDown.current = false;
          if (e.target === e.currentTarget && startOnBackdrop) requestClose();
        }}
        aria-hidden
      />

      {/* Animated Modal Content — top slide down + scale */}
      <div
        role="dialog"
        aria-modal
        aria-labelledby="app-modal-title"
        aria-describedby={description ? "app-modal-description" : undefined}
        className={cn(
          "relative z-50 w-full my-auto sm:my-4 rounded-xl border border-border/80 dark:border-white/10 bg-card p-6 shadow-xl shadow-black/10 overflow-hidden",
          "transition-all",
          isVisible
            ? "duration-300 ease-out opacity-100 scale-100 translate-y-0"
            : "duration-200 ease-in opacity-0 scale-95 -translate-y-8",
          maxWidthClasses[maxWidth],
          className,
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 mb-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            {icon && (
              <div className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
                {icon}
              </div>
            )}
            <div className="space-y-0.5">
              <h2 id="app-modal-title" className="text-base font-bold tracking-tight text-foreground">
                {title}
              </h2>
              {description && (
                <p id="app-modal-description" className="text-xs text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors -mr-1 -mt-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="max-h-[75vh] overflow-y-auto px-0.5">{children}</div>

        {/* Sticky Footer */}
        {footer && (
          <div className="mt-4 border-t border-border/60 pt-4 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>

      {/* Unsaved-changes confirmation (report issue 7). Rendered as a sibling
          portal so it stacks above the modal (z-[110] vs z-50). */}
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
    </div>,
    document.body,
  );
}
