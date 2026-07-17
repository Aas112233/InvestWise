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
          ? 'rounded p-4 border flex flex-col justify-between min-h-[96px] shadow-sm'
          : 'rounded p-5 border flex flex-col justify-between min-h-[128px] shadow-sm',
        isDark
          ? 'bg-slate-900 border-slate-800 text-white'
          : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-800 text-slate-900 dark:text-white',
        className,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={[
            'text-[10px] font-semibold uppercase tracking-wider',
            isDark ? 'text-slate-400' : 'text-slate-500',
            labelClassName,
          ].join(' ')}
        >
          {label}
        </p>
        {icon ? <div className="shrink-0 text-slate-400">{icon}</div> : null}
      </div>

      <div className="flex items-baseline gap-2 flex-wrap mt-2">
        <span
          className={[
            'font-semibold tracking-tight font-mono text-2xl sm:text-3xl',
            valueClassName,
          ].join(' ')}
        >
          {value}
        </span>

        {note ? (
          <span
            className={[
              'text-xs font-semibold',
              isDark ? 'text-blue-400' : 'text-blue-600 dark:text-blue-400',
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
            'text-[9px] font-medium uppercase tracking-wider mt-1',
            isDark ? 'text-slate-400' : 'text-slate-400',
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
