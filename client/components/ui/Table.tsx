import React from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, RefreshCw } from 'lucide-react';

export interface TableColumn<T> {
  key: string;
  header: React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  render?: (item: T, index: number) => React.ReactNode;
  className?: string;
  cellClassName?: string | ((item: T) => string);
}

export interface TableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: React.ReactNode;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  rowKey: (item: T, index: number) => string | number;
  rowClassName?: (item: T) => string;
}

export function Table<T>({
  data,
  columns,
  loading = false,
  loadingMessage = 'Loading...',
  emptyMessage = 'No data found',
  sortBy,
  sortOrder,
  onSort,
  rowKey,
  rowClassName,
}: TableProps<T>) {
  
  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) {
      return <ArrowUpDown size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />;
    }
    return sortOrder === 'asc' ? <ArrowUp size={11} className="text-blue-600 dark:text-blue-400" /> : <ArrowDown size={11} className="text-blue-600 dark:text-blue-400" />;
  };

  return (
    <div className="overflow-x-auto w-full">
      <table className="w-full border-collapse border border-gray-200 dark:border-gray-800">
        <thead>
          <tr className="bg-slate-55 dark:bg-slate-800/70 text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-800">
            {columns.map((col) => {
              const alignmentClass = 
                col.align === 'center' ? 'text-center' : 
                col.align === 'right' ? 'text-right' : 'text-left';
              
              const isSortable = col.sortable && onSort;
              const thClasses = `px-3 py-2 ${alignmentClass} border-r border-gray-200 dark:border-gray-800 last:border-r-0 ${
                isSortable ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors group' : ''
              } ${col.className || ''}`;

              return (
                <th 
                  key={col.key} 
                  className={thClasses}
                  onClick={() => isSortable ? onSort(col.key) : undefined}
                >
                  <div className={`flex items-center gap-1.5 ${
                    col.align === 'center' ? 'justify-center' : 
                    col.align === 'right' ? 'justify-end' : 'justify-start'
                  }`}>
                    {col.header}
                    {isSortable && <SortIcon column={col.key} />}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center border-b border-gray-200 dark:border-gray-800">
                <div className="flex flex-col items-center gap-2">
                  <RefreshCw className="animate-spin text-blue-600 dark:text-blue-400" size={24} />
                  <p className="text-xs font-medium text-slate-400">{loadingMessage}</p>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center border-b border-gray-200 dark:border-gray-800">
                <div className="text-xs font-medium text-slate-400">
                  {emptyMessage}
                </div>
              </td>
            </tr>
          ) : (
            data.map((item, index) => (
              <tr 
                key={rowKey(item, index)} 
                className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all ${
                  rowClassName ? rowClassName(item) : ''
                }`}
              >
                {columns.map((col) => {
                  const alignmentClass = 
                    col.align === 'center' ? 'text-center' : 
                    col.align === 'right' ? 'text-right' : 'text-left';
                  
                  const customCellClass = typeof col.cellClassName === 'function' 
                    ? col.cellClassName(item) 
                    : col.cellClassName || '';

                  return (
                    <td key={col.key} className={`px-3 py-2 text-xs text-slate-850 dark:text-slate-200 ${alignmentClass} border-r border-gray-200 dark:border-gray-800 last:border-r-0 ${customCellClass}`}>
                      {col.render 
                        ? col.render(item, index) 
                        : (item as any)[col.key] as React.ReactNode}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
