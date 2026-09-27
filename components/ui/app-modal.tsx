"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

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
}: AppModalProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [animationState, setAnimationState] = useState<"entering" | "open" | "exiting" | "closed">("closed");
  const backdropRef = useRef<HTMLDivElement>(null);

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
      if (e.key === "Escape") onClose();
    };
    if (isOpen) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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
        onClick={onClose}
        aria-hidden
      />

      {/* Animated Modal Content — top slide down + scale */}
      <div
        role="dialog"
        aria-modal
        aria-labelledby="app-modal-title"
        aria-describedby={description ? "app-modal-description" : undefined}
        className={cn(
          "relative z-50 w-full my-auto sm:my-4 rounded-xl border border-border/80 bg-card p-6 shadow-xl shadow-black/10 overflow-hidden",
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
            onClick={onClose}
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
    </div>,
    document.body,
  );
}
