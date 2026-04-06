import React from 'react';

interface SummaryMetricCardProps {
 label: string;
 value: string | number;
 note?: string;
 description?: string;
 icon?: React.ReactNode;
 variant?: 'light' | 'dark';
 size?: 'compact' | 'regular';
 className?: string;
 labelClassName?: string;
 valueClassName?: string;
 noteClassName?: string;
 descriptionClassName?: string;
}

const SummaryMetricCard: React.FC<SummaryMetricCardProps> = ({
 label,
 value,
 note,
 description,
 icon,
 variant = 'light',
 size = 'compact',
 className = '',
 labelClassName = '',
 valueClassName = '',
 noteClassName = '',
 descriptionClassName = '',
}) => {
 const isDark = variant === 'dark';
 const isCompact = size === 'compact';

 return (
 <div
 className={[
 isCompact
 ? 'rounded-[1.75rem] p-4 lg:p-5 card-shadow flex flex-col justify-between min-h-[118px]'
 : 'rounded-[2.5rem] p-6 lg:p-7 card-shadow flex flex-col justify-between min-h-[170px]',
 isDark
 ? 'bg-dark text-white'
 : 'bg-white dark:bg-[#1A221D] border border-gray-100 dark:border-white/5 text-dark dark:text-white',
 className,
 ].join(' ')}
 >
 <div className="flex items-start justify-between gap-3">
 <p
 className={[
 isCompact ? 'text-[10px] font-black uppercase tracking-widest mb-2' : 'text-[11px] font-black uppercase tracking-widest mb-3',
 isDark ? 'text-white/30' : 'text-gray-500',
 labelClassName,
 ].join(' ')}
 >
 {label}
 </p>
 {icon ? <div className="shrink-0">{icon}</div> : null}
 </div>

 <div className="flex items-end gap-2 flex-wrap">
 <span
 className={[
 'font-black tracking-tighter leading-none',
 isDark ? 'text-brand' : 'text-dark dark:text-white',
 isCompact
 ? typeof value === 'number' || String(value).length <= 10
 ? 'text-3xl sm:text-4xl'
 : 'text-2xl sm:text-3xl'
 : typeof value === 'number' || String(value).length <= 10
 ? 'text-4xl sm:text-5xl'
 : 'text-3xl sm:text-4xl',
 valueClassName,
 ].join(' ')}
 >
 {value}
 </span>

 {note ? (
 <span
 className={[
 isCompact ? 'pb-0.5 font-black tracking-tight' : 'pb-1 font-black tracking-tight',
 isDark
 ? isCompact ? 'text-white/70 text-xs sm:text-sm' : 'text-white/70 text-sm sm:text-base'
 : isCompact ? 'text-brand text-sm sm:text-base' : 'text-brand text-base sm:text-lg',
 noteClassName,
 ].join(' ')}
 >
 {note}
 </span>
 ) : null}
 </div>

 {description ? (
 <p
 className={[
 isDark ? 'text-white/40' : 'text-gray-400/80',
 isCompact ? 'text-[9px] font-black uppercase tracking-widest mt-2' : 'text-[10px] font-black uppercase tracking-widest mt-3',
 descriptionClassName,
 ].join(' ')}
 >
 {description}
 </p>
 ) : null}
 </div>
 );
};

export default SummaryMetricCard;
