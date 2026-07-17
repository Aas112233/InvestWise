import React from 'react';

/**
 * Responsive Table Component
 * Transforms to card layout on mobile devices
 */

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T, index: number) => React.ReactNode;
  className?: string;
  hideOnMobile?: boolean;
  align?: 'left' | 'center' | 'right';
}

interface ResponsiveTableProps<T> {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  emptyMessage?: string;
  rowKey?: (item: T, index: number) => string;
  onRowClick?: (item: T, index: number) => void;
  className?: string;
  mobileCardRenderer?: (item: T) => {
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
  };
}

function ResponsiveTable<T extends Record<string, any>>({
  data,
  columns,
  loading = false,
  emptyMessage = 'No data available',
  rowKey,
  onRowClick,
  className = '',
  mobileCardRenderer
}: ResponsiveTableProps<T>) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Loading Data...
          </p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded bg-gray-50 dark:bg-slate-800 flex items-center justify-center border border-gray-200 dark:border-gray-700">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-6 h-6 text-gray-400"
            >
              <path
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
            {emptyMessage}
          </p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            Try adjusting your filters or add new data
          </p>
        </div>
      </div>
    );
  }

  const getMobileCardContent = (item: T, index: number) => {
    if (mobileCardRenderer) {
      return mobileCardRenderer(item);
    }

    // Default: use first column as title, second as subtitle
    const firstVisibleColumns = columns.filter(col => !col.hideOnMobile).slice(0, 2);
    return {
      title: firstVisibleColumns[0]?.render
        ? firstVisibleColumns[0].render(item, index)
        : item[firstVisibleColumns[0]?.key],
      subtitle: firstVisibleColumns[1]?.render
        ? firstVisibleColumns[1].render(item, index)
        : item[firstVisibleColumns[1]?.key],
      actions: columns.find(col => col.key === 'actions')?.render?.(item, index)
    };
  };

  return (
    <>
      {/* Desktop Table View */}
      <div className={`hidden md:block overflow-x-auto w-full ${className}`}>
        <table className="w-full border-collapse border border-gray-200 dark:border-gray-800">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800/70 text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-800">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-3 py-2 border-r border-gray-200 dark:border-gray-800 last:border-r-0 ${
                    column.align === 'center' ? 'text-center' :
                    column.align === 'right' ? 'text-right' :
                    'text-left'
                  } ${column.hideOnMobile ? 'hidden md:table-cell' : ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {data.map((item, index) => (
              <tr
                key={rowKey?.(item, index) || `row-${index}`}
                onClick={() => onRowClick?.(item, index)}
                className={`hover:bg-slate-50 dark:hover:bg-slate-850 transition-all ${
                  onRowClick ? 'cursor-pointer' : ''
                }`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 text-xs border-r border-gray-200 dark:border-gray-800 last:border-r-0 ${
                      column.align === 'center' ? 'text-center' :
                      column.align === 'right' ? 'text-right' :
                      ''
                    } ${column.hideOnMobile ? 'hidden md:table-cell' : ''} ${column.className || ''}`}
                  >
                    {column.render
                      ? column.render(item, index)
                      : item[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className={`md:hidden space-y-3 ${className}`}>
        {data.map((item, index) => {
          const cardContent = getMobileCardContent(item, index);

          return (
            <div
              key={rowKey?.(item, index) || `mobile-card-${index}`}
              onClick={() => onRowClick?.(item, index)}
              className={`bg-white dark:bg-slate-900 rounded p-4 border border-gray-200 dark:border-gray-800 shadow-sm ${
                onRowClick ? 'cursor-pointer active:bg-slate-50 dark:active:bg-slate-800/50' : ''
              } transition-all`}
            >
              {/* Card Header */}
              <div className="mb-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-white mb-0.5">
                  {cardContent.title}
                </div>
                {cardContent.subtitle && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {cardContent.subtitle}
                  </div>
                )}
              </div>

              {/* Card Details - Show non-hidden columns */}
              <div className="space-y-1.5 mb-3">
                {columns
                  .filter(col => !col.hideOnMobile && col.key !== 'actions')
                  .map(column => (
                    <div key={column.key} className="flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[10px]">
                        {column.header}
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {column.render
                          ? column.render(item, index)
                          : item[column.key]}
                      </span>
                    </div>
                  ))}
              </div>

              {/* Card Actions */}
              {cardContent.actions && (
                <div className="flex items-center justify-end gap-1.5 pt-2.5 border-t border-gray-150 dark:border-gray-800">
                  {cardContent.actions}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default ResponsiveTable;
