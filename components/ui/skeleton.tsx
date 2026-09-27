"use client";

import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type SkeletonVariant = "text" | "circular" | "rectangular" | "rounded";

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
  count?: number;
  /** Shorthand that only fills borderRadius when it is not given explicitly. */
  variant?: SkeletonVariant;
}

const VARIANT_RADIUS: Record<SkeletonVariant, string> = {
  text: "0.25rem",
  circular: "9999px",
  rectangular: "0px",
  rounded: "0.375rem",
};

// Base primitive. Behavioral port of client/components/ui/Skeleton.tsx.
export function Skeleton({
  width = "100%",
  height = "1rem",
  borderRadius,
  className,
  count = 1,
  variant = "rounded",
}: SkeletonProps) {
  const radius = borderRadius ?? VARIANT_RADIUS[variant];
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            "bg-slate-200/80 dark:bg-slate-800/80 animate-pulse-subtle motion-reduce:animate-none",
            className,
          )}
          style={{ width, height, borderRadius: radius }}
        />
      ))}
    </>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "p-4 rounded-xl border border-border/80 bg-card shadow-sm flex-1 min-w-[180px] space-y-3",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton width="45%" height="0.75rem" borderRadius="0.25rem" />
        <Skeleton width="25%" height="0.75rem" borderRadius="0.25rem" />
      </div>
      <div className="flex items-baseline gap-2 pt-1">
        <Skeleton width="60%" height="1.75rem" borderRadius="0.375rem" />
        <Skeleton width="20%" height="0.875rem" borderRadius="0.25rem" />
      </div>
    </div>
  );
}

// Loading twin for ERPMetricCard grids (replaces StatCardGridSkeleton).
export function CardGridSkeleton({ count = 5 }: { count?: number }) {
  const { t } = useLocale();
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4"
    >
      <span className="sr-only">{t("common.loading")}</span>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function TableRowSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <tr className="border-b border-slate-200 dark:border-slate-800">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          {i === 0 ? (
            <div className="flex items-center gap-3">
              <Skeleton variant="circular" width="2rem" height="2rem" className="shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton width="80%" height="0.875rem" borderRadius="0.25rem" />
                <Skeleton width="50%" height="0.65rem" borderRadius="0.25rem" />
              </div>
            </div>
          ) : i === columns - 1 ? (
            <div className="flex items-center justify-end gap-2">
              <Skeleton width="1.75rem" height="1.75rem" borderRadius="0.375rem" />
              <Skeleton width="1.75rem" height="1.75rem" borderRadius="0.375rem" />
            </div>
          ) : (
            <Skeleton
              width={i % 2 === 0 ? "70%" : "50%"}
              height="0.875rem"
              borderRadius="0.25rem"
            />
          )}
        </td>
      ))}
    </tr>
  );
}

// Loading twin for ERPDataTable (replaces TableSkeleton).
export function TableSkeleton({
  rows = 6,
  columns = 6,
  showHeader = true,
  className,
}: {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(
        "w-full bg-card rounded-xl border border-border/80 shadow-sm overflow-hidden",
        className,
      )}
    >
      <span className="sr-only">{t("common.loading")}</span>
      {showHeader && (
        <div className="px-4 py-3.5 border-b border-border/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-muted/30">
          <div className="flex items-center gap-2 w-full sm:w-72">
            <Skeleton width="100%" height="2.25rem" borderRadius="0.5rem" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton width="5rem" height="2rem" borderRadius="0.375rem" />
            <Skeleton width="6rem" height="2rem" borderRadius="0.375rem" />
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-4 py-3">
                  <Skeleton width="60%" height="0.75rem" borderRadius="0.25rem" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {Array.from({ length: rows }).map((_, i) => (
              <TableRowSkeleton key={i} columns={columns} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <Skeleton width="12rem" height="0.875rem" borderRadius="0.25rem" />
        <div className="flex items-center gap-2">
          <Skeleton width="2rem" height="2rem" borderRadius="0.375rem" />
          <Skeleton width="2rem" height="2rem" borderRadius="0.375rem" />
          <Skeleton width="2rem" height="2rem" borderRadius="0.375rem" />
        </div>
      </div>
    </div>
  );
}
