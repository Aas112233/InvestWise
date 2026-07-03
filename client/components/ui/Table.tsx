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
      return <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />;
    }
    return sortOrder === 'asc' ? <ArrowUp size={12} className="text-brand" /> : <ArrowDown size={12} className="text-brand" />;
  };

  return (
    <div className="overflow-x-auto px-2">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50/30 dark:bg-white/5 text-[11px] font-black text-gray-500 uppercase tracking-widest">
            {columns.map((col) => {
              const alignmentClass = 
                col.align === 'center' ? 'text-center' : 
                col.align === 'right' ? 'text-right' : 'text-left';
              
              const isSortable = col.sortable && onSort;
              const thClasses = `px-10 py-6 ${alignmentClass} border-b border-r border-gray-200 dark:border-white/10 last:border-r-0 ${
                isSortable ? 'cursor-pointer hover:text-brand transition-colors group' : ''
              } ${col.className || ''}`;

              return (
                <th 
                  key={col.key} 
                  className={thClasses}
                  onClick={() => isSortable ? onSort(col.key) : undefined}
                >
                  <div className={`flex items-center gap-2 ${
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
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-10 py-20 text-center border-b border-gray-200 dark:border-white/10">
                <div className="flex flex-col items-center gap-4">
                  <RefreshCw className="animate-spin text-brand" size={40} />
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest">{loadingMessage}</p>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-10 py-20 text-center border-b border-gray-200 dark:border-white/10">
                <div className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  {emptyMessage}
                </div>
              </td>
            </tr>
          ) : (
            data.map((item, index) => (
              <tr 
                key={rowKey(item, index)} 
                className={`hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group ${
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
                    <td key={col.key} className={`px-10 py-6 ${alignmentClass} border-b border-r border-gray-200 dark:border-white/10 last:border-r-0 ${customCellClass}`}>
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
