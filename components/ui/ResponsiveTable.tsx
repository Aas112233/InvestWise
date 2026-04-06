import React from 'react';
import { motion } from 'framer-motion';

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
 <div className="flex items-center justify-center py-20">
 <div className="text-center">
 <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
 <p className="text-xs font-black text-gray-400 uppercase tracking-widest">
 Loading Data...
 </p>
 </div>
 </div>
 );
 }

 if (data.length === 0) {
 return (
 <div className="flex items-center justify-center py-20">
 <div className="text-center">
 <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center">
 <svg
 viewBox="0 0 24 24"
 fill="none"
 className="w-10 h-10 text-gray-400"
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
 <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
 {emptyMessage}
 </p>
 <p className="text-xs text-gray-400 dark:text-gray-500">
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
 <div className={`hidden md:block overflow-x-auto ${className}`}>
 <table className="w-full border-collapse">
 <thead>
 <tr className="bg-gray-50/30 dark:bg-white/5 text-[11px] font-black text-gray-500 uppercase tracking-widest">
 {columns.map((column) => (
 <th
 key={column.key}
 className={`px-10 py-6 ${
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
 <tbody className="divide-y divide-gray-50 dark:divide-white/5">
 {data.map((item, index) => (
 <motion.tr
 key={rowKey?.(item, index) || `row-${index}`}
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: index * 0.03 }}
 onClick={() => onRowClick?.(item, index)}
 className={`hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group ${
 onRowClick ? 'cursor-pointer' : ''
 }`}
 >
 {columns.map((column) => (
 <td
 key={column.key}
 className={`px-10 py-6 ${
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
 </motion.tr>
 ))}
 </tbody>
 </table>
 </div>

 {/* Mobile Card View */}
 <div className={`md:hidden space-y-4 ${className}`}>
 {data.map((item, index) => {
 const cardContent = getMobileCardContent(item, index);

 return (
 <motion.div
 key={rowKey?.(item, index) || `mobile-card-${index}`}
 initial={{ opacity: 0, y: 10, scale: 0.98 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 transition={{ delay: index * 0.05 }}
 onClick={() => onRowClick?.(item, index)}
 className={`bg-white dark:bg-[#1A221D] rounded-2xl p-6 border border-gray-100 dark:border-white/5 shadow-sm ${
 onRowClick ? 'cursor-pointer active:scale-98' : ''
 } transition-all`}
 >
 {/* Card Header */}
 <div className="mb-4">
 <div className="text-base font-black text-dark dark:text-white mb-1">
 {cardContent.title}
 </div>
 {cardContent.subtitle && (
 <div className="text-sm text-gray-500 dark:text-gray-400">
 {cardContent.subtitle}
 </div>
 )}
 </div>

 {/* Card Details - Show non-hidden columns */}
 <div className="space-y-2 mb-4">
 {columns
 .filter(col => !col.hideOnMobile && col.key !== 'actions')
 .map(column => (
 <div key={column.key} className="flex items-center justify-between text-xs">
 <span className="font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
 {column.header}
 </span>
 <span className="font-black text-dark dark:text-white">
 {column.render
 ? column.render(item, index)
 : item[column.key]}
 </span>
 </div>
 ))}
 </div>

 {/* Card Actions */}
 {cardContent.actions && (
 <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100 dark:border-white/5">
 {cardContent.actions}
 </div>
 )}
 </motion.div>
 );
 })}
 </div>
 </>
 );
}

export default ResponsiveTable;
