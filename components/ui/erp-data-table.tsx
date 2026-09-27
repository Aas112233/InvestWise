"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";
import { useLocale } from "@/lib/i18n";

export interface ERPColumn<T> {
  key: string;
  header: React.ReactNode;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  render?(item: T, index: number): React.ReactNode;
  className?: string;
  cellClassName?: string | BivariantCellClass<T>;
}

interface BivariantCellClassShim<T> {
  bivarianceHack(item: T): string;
}
export type BivariantCellClass<T> = BivariantCellClassShim<T>["bivarianceHack"];

export const PAGE_SIZES = [10, 20, 50, 100] as const;

export interface ERPDataTableProps<T> {
  data: T[];
  columns: ERPColumn<T>[];
  loading?: boolean;
  isLoading?: boolean;
  loadingRowCount?: number;
  emptyMessage?: React.ReactNode;
  emptyAction?: React.ReactNode;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (field: string) => void;
  rowKey?: (item: T, index: number) => string | number;
  rowClassName?: (item: T) => string;
  // Server-driven pagination footer. Omit for client-paginated snapshots.
  page?: number;
  pageSize?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export function ERPDataTable<T>({
  data,
  columns,
  loading = false,
  isLoading,
  loadingRowCount = 6,
  emptyMessage,
  emptyAction,
  emptyActionLabel,
  onEmptyAction,
  sortBy,
  sortOrder,
  onSort,
  rowKey,
  rowClassName,
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
}: ERPDataTableProps<T>) {
  const { t } = useLocale();
  const defaultEmptyMessage = emptyMessage ?? t("erp.dataTable.emptyMessage", { defaultValue: "No data found" });
  const rowsPerPageLabel = t("erp.dataTable.rowsPerPage", { defaultValue: "Rows" });
  const previousPageLabel = t("erp.dataTable.previousPage", { defaultValue: "Previous page" });
  const nextPageLabel = t("erp.dataTable.nextPage", { defaultValue: "Next page" });
  const isTableLoading = loading || isLoading || false;
  const getKey = rowKey ?? ((item: any, idx: number) => item?.id ?? item?._id ?? idx);
  const resolvedEmptyAction =
    emptyAction ??
    (emptyActionLabel && onEmptyAction ? (
      <button
        type="button"
        onClick={onEmptyAction}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs"
      >
        {emptyActionLabel}
      </button>
    ) : null);
  const showFooter = page !== undefined && pageSize !== undefined && totalCount !== undefined;
  const totalPages = showFooter && pageSize > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  const startRow = showFooter && totalCount > 0 ? (page - 1) * pageSize + 1 : 0;
  const endRow = showFooter ? Math.min(page * pageSize, totalCount) : 0;

  return (
    <div className="w-full bg-card rounded-xl border border-border/80 shadow-xs overflow-hidden">
      <div className="overflow-x-auto w-full">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/80">
              {columns.map((col) => {
                const alignmentClass =
                  col.align === "center"
                    ? "text-center"
                    : col.align === "right"
                      ? "text-right"
                      : "text-left";
                const isSortable = col.sortable && onSort;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-3.5 py-2.5 border-r border-border/60 last:border-r-0 select-none",
                      alignmentClass,
                      isSortable &&
                        "cursor-pointer hover:text-foreground transition-colors group",
                      col.className,
                    )}
                    onClick={isSortable ? () => onSort(col.key) : undefined}
                    aria-sort={
                      isSortable && sortBy === col.key
                        ? sortOrder === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    <div
                      className={cn(
                        "flex items-center gap-1.5",
                        col.align === "center"
                          ? "justify-center"
                          : col.align === "right"
                            ? "justify-end"
                            : "justify-start",
                      )}
                    >
                      {col.header}
                      {isSortable &&
                        (sortBy !== col.key ? (
                          <ArrowUpDown
                            size={11}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
                          />
                        ) : sortOrder === "asc" ? (
                          <ArrowUp size={11} className="text-primary" />
                        ) : (
                          <ArrowDown size={11} className="text-primary" />
                        ))}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {isTableLoading ? (
              Array.from({ length: loadingRowCount }).map((_, rIdx) => (
                <tr key={`loading-row-${rIdx}`} className="border-b border-border/60">
                  {columns.map((col, cIdx) => (
                    <td
                      key={`loading-col-${cIdx}`}
                      className="px-3.5 py-3 border-r border-border/60 last:border-r-0"
                    >
                      {cIdx === 0 ? (
                        <div className="flex items-center gap-2">
                          <Skeleton width="1.75rem" height="1.75rem" borderRadius="9999px" />
                          <div className="space-y-1 flex-1">
                            <Skeleton width="75%" height="0.75rem" borderRadius="0.25rem" />
                            <Skeleton width="45%" height="0.55rem" borderRadius="0.25rem" />
                          </div>
                        </div>
                      ) : cIdx === columns.length - 1 ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Skeleton width="1.5rem" height="1.5rem" borderRadius="0.25rem" />
                          <Skeleton width="1.5rem" height="1.5rem" borderRadius="0.25rem" />
                        </div>
                      ) : (
                        <Skeleton
                          width={`${Math.max(35, (((rIdx + cIdx) * 19) % 55) + 35)}%`}
                          height="0.75rem"
                          borderRadius="0.25rem"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Inbox size={22} className="text-muted-foreground/60" />
                    <div className="text-xs font-medium text-muted-foreground">{emptyMessage}</div>
                    {resolvedEmptyAction}
                  </div>
                </td>
              </tr>
            ) : (
              data.map((item, index) => (
                <tr
                  key={getKey(item, index)}
                  className={cn(
                    "hover:bg-muted/40 transition-colors",
                    rowClassName?.(item),
                  )}
                >
                  {columns.map((col) => {
                    const alignmentClass =
                      col.align === "center"
                        ? "text-center"
                        : col.align === "right"
                          ? "text-right"
                          : "text-left";
                    const customCellClass =
                      typeof col.cellClassName === "function"
                        ? col.cellClassName(item)
                        : (col.cellClassName ?? "");
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3.5 py-2.5 text-xs text-foreground border-r border-border/60 last:border-r-0",
                          alignmentClass,
                          customCellClass,
                        )}
                      >
                        {col.render
                          ? col.render(item, index)
                          : ((item as Record<string, React.ReactNode>)[col.key] ?? null)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {showFooter && onPageChange && (
        <div className="px-4 py-3 border-t border-border/80 bg-card flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-muted-foreground">
            {totalCount === 0 ? "0 of 0" : `${startRow}–${endRow} of ${totalCount}`}
          </span>
          <div className="flex items-center gap-3">
            {onPageSizeChange && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {rowsPerPageLabel}
                </span>
                <div className="flex gap-1">
                  {PAGE_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onPageSizeChange(size)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all border border-border/80",
                        pageSize === size
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1}
                aria-label={previousPageLabel}
                className="p-1.5 rounded-lg border border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-[11px] font-medium text-muted-foreground px-1">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages}
                aria-label={nextPageLabel}
                className="p-1.5 rounded-lg border border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
