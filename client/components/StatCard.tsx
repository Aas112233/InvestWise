import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string; // Formatted value
  change: string;
  isPositive?: boolean;
  variant?: 'dark' | 'light' | 'brand';
  currency?: string;
  rawValue?: number;
}

const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  change,
  isPositive = true,
  variant = 'light',
  currency,
}) => {
  const isDarkVariant = variant === 'dark';

  return (
    <div
      className={`p-4 rounded border ${
        isDarkVariant
          ? 'bg-slate-900 border-slate-800 text-white'
          : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-gray-800 text-slate-900 dark:text-white'
      } flex-1 min-w-[200px] shadow-sm`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        <div
          className={`flex items-center gap-1 text-[10px] font-semibold ${
            isPositive ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500'
          }`}
        >
          {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {change}
        </div>
      </div>

      <div className="flex items-baseline gap-1.5">
        <h3 className="text-xl sm:text-2xl font-semibold tracking-tight font-mono">
          {value}
        </h3>
        {currency && (
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            {currency}
          </span>
        )}
      </div>
    </div>
  );
};

export default StatCard;
