"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ERPFormSection({
  title,
  description,
  children,
  className,
  headerAction,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-card p-5 shadow-2xs space-y-4 text-card-foreground",
        className,
      )}
    >
      {(title || description || headerAction) && (
        <div className="flex items-start justify-between gap-4 pb-3 border-b border-border/50">
          <div className="space-y-0.5">
            {title && (
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                {title}
              </h4>
            )}
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function ERPFormGrid({
  columns,
  cols,
  children,
  className,
}: {
  columns?: 1 | 2 | 3 | 4;
  cols?: 1 | 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  const count = cols ?? columns ?? 2;
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        count === 2 && "sm:grid-cols-2",
        count === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        count === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ERPFormField({
  label,
  required = false,
  error,
  hint,
  children,
  htmlFor,
  action,
}: {
  label?: ReactNode;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <label
            htmlFor={htmlFor}
            className="block text-xs font-semibold text-foreground/90"
          >
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-[11px] font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function ERPFormLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-5", className)}>{children}</div>;
}

export function ERPFormActions({
  children,
  className,
  sticky = false,
}: {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2.5 pt-4",
        sticky &&
          "sticky bottom-0 z-10 border-t border-border/80 bg-card py-3 px-6 -mx-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
