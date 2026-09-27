"use client";

import React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusTone } from "./status-badge";
import { Skeleton } from "./skeleton";

export interface MetricBreakdown {
  label: string;
  count: number | string;
  color?: "emerald" | "amber" | "rose" | "cyan" | "indigo" | "purple" | "slate";
  percentage?: number;
}

export interface ERPMetricCardProps {
  label?: string;
  title?: string;
  value: string | number;
  change?: string;
  trend?: { value: number | string; isPositive: boolean };
  isPositive?: boolean;
  note?: string;
  description?: string;
  helperText?: string;
  currency?: string;
  icon?: React.ReactNode | React.ComponentType<{ className?: string; size?: number }>;
  tone?: StatusTone;
  breakdowns?: MetricBreakdown[];
  footer?: React.ReactNode;
  isLoading?: boolean;
  className?: string;
}

const breakdownColors: Record<string, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
  indigo: "bg-indigo-500",
  purple: "bg-purple-500",
  slate: "bg-slate-400 dark:bg-slate-600",
};

export function ERPMetricCard({
  label,
  title,
  value,
  change,
  trend,
  isPositive = true,
  note,
  description,
  helperText,
  currency,
  icon: Icon,
  tone,
  breakdowns,
  footer,
  isLoading = false,
  className,
}: ERPMetricCardProps) {
  const displayLabel = label ?? title ?? "";
  const resolvedIsPositive = trend ? Boolean(trend.isPositive) : isPositive;
  const resolvedChange = trend ? `${trend.value}%` : change;
  const desc = helperText ?? description;
  const valueText = String(value ?? "");

  // Pathshala-Pro length-based text shrink keeps large figures inside the card
  const valueSizeClass =
    valueText.length <= 10
      ? "text-2xl"
      : valueText.length <= 15
        ? "text-xl"
        : valueText.length <= 22
          ? "text-lg"
          : "text-base";

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-col rounded-xl border border-border/50 bg-card p-4 shadow-xs",
          className,
        )}
        aria-busy="true"
      >
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <Skeleton className="mt-4 h-8 w-28" />
        <Skeleton className="mt-2 h-2.5 w-36" />
      </div>
    );
  }

  const renderIcon = () => {
    if (!Icon) return null;
    if (React.isValidElement(Icon)) return Icon;
    if (typeof Icon === "function" || (typeof Icon === "object" && Icon !== null)) {
      const Component = Icon as React.ComponentType<{ className?: string; size?: number }>;
      return <Component size={16} className="text-primary" />;
    }
    return null;
  };

  return (
    <div
      className={cn(
        "p-4 rounded-xl border border-border/50 bg-card text-card-foreground flex-1 min-w-[200px] shadow-xs flex flex-col justify-between min-h-[104px] transition-all duration-200 hover:border-border/80",
        className,
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {displayLabel}
          </span>
          {Icon ? (
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              {renderIcon()}
            </div>
          ) : null}
        </div>

        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className={cn("font-bold tracking-tight font-mono text-foreground", valueSizeClass)}>
            {value}
          </h3>
          {currency && (
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {currency}
            </span>
          )}
          {resolvedChange !== undefined && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold font-mono",
                resolvedIsPositive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
              )}
            >
              {resolvedIsPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {resolvedChange}
            </span>
          )}
          {note && (
            <span className="text-xs font-semibold text-primary">{note}</span>
          )}
        </div>

        {desc && (
          <p className="text-[11px] font-medium mt-1 text-muted-foreground">
            {desc}
          </p>
        )}
      </div>

      {/* Optional breakdown bars (Pathshala-Pro ERP pattern) */}
      {breakdowns && breakdowns.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
          {breakdowns.map((b, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{b.label}</span>
                <span className="font-mono font-semibold text-foreground">{b.count}</span>
              </div>
              {b.percentage !== undefined && (
                <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", breakdownColors[b.color || "emerald"])}
                    style={{ width: `${Math.min(100, Math.max(0, b.percentage))}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {footer && <div className="mt-2 pt-2 border-t border-border/60">{footer}</div>}
    </div>
  );
}
