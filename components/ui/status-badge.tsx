"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// Status pills: emerald (active/success), amber (pending/warning),
// rose (failed/suspended/destructive), cyan (info), slate (neutral).
export type StatusTone = "emerald" | "amber" | "rose" | "cyan" | "slate";
export type StatusVariant = "success" | "error" | "warning" | "info" | "neutral" | "emerald" | "amber" | "rose";

const toneClasses: Record<StatusTone, string> = {
  emerald:
    "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]",
  amber:
    "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border-[var(--status-warning-border)]",
  rose:
    "bg-[var(--status-error-bg)] text-[var(--status-error-text)] border-[var(--status-error-border)]",
  cyan:
    "bg-[var(--status-info-bg)] text-[var(--status-info-text)] border-[var(--status-info-border)]",
  slate:
    "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border-[var(--status-neutral-border)]",
};

const dotClasses: Record<StatusTone, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  cyan: "bg-teal-500",
  slate: "bg-slate-400",
};

const variantToToneMap: Record<StatusVariant, StatusTone> = {
  success: "emerald",
  error: "rose",
  warning: "amber",
  info: "cyan",
  neutral: "slate",
  emerald: "emerald",
  amber: "amber",
  rose: "rose",
};

export function StatusBadge({
  tone,
  variant,
  children,
  /** Text alternative to `children` used by feature call sites. */
  label,
  dot = true,
  className,
}: {
  tone?: StatusTone;
  variant?: StatusVariant;
  children?: ReactNode;
  label?: string;
  dot?: boolean;
  className?: string;
}) {
  const resolvedTone: StatusTone = tone ?? (variant ? variantToToneMap[variant] : "slate");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap shadow-2xs",
        toneClasses[resolvedTone],
        className,
      )}
    >
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClasses[resolvedTone])} />}
      {children ?? label}
    </span>
  );
}
