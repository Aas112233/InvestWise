import React from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVESTWISE SKELETON LOADING SUITE
 * High-performance, pixel-accurate wireframe skeleton components with smooth
 * shimmer wave animations for seamless perceived loading performance.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. BASE PRIMITIVE SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
  count?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '1rem',
  borderRadius = '0.375rem',
  className = '',
  count = 1,
}) => {
  const elements = Array.from({ length: count });

  return (
    <>
      {elements.map((_, i) => (
        <div
          key={i}
          className={`bg-slate-200/80 dark:bg-slate-800/80 animate-shimmer relative overflow-hidden ${className}`}
          style={{
            width,
            height,
            borderRadius,
          }}
        />
      ))}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. MICRO PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

export const SkeletonText: React.FC<{
  lines?: number;
  className?: string;
  lineHeight?: string;
}> = ({ lines = 2, className = '', lineHeight = '0.875rem' }) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        width={i === lines - 1 && lines > 1 ? '65%' : '100%'}
        height={lineHeight}
        borderRadius="0.25rem"
      />
    ))}
  </div>
);

export const SkeletonAvatar: React.FC<{
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}> = ({ size = 'md', className = '' }) => {
  const sizeMap = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  return (
    <div
      className={`${sizeMap[size]} rounded-full bg-slate-200/80 dark:bg-slate-800/80 animate-shimmer shrink-0 ${className}`}
    />
  );
};

export const SkeletonBadge: React.FC<{
  width?: string;
  height?: string;
  className?: string;
}> = ({ width = '4.5rem', height = '1.25rem', className = '' }) => (
  <Skeleton width={width} height={height} borderRadius="9999px" className={className} />
);

export const SkeletonButton: React.FC<{
  width?: string;
  height?: string;
  className?: string;
}> = ({ width = '6rem', height = '2.25rem', className = '' }) => (
  <Skeleton width={width} height={height} borderRadius="0.5rem" className={className} />
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. STAT CARDS SKELETON (Matches StatCard.tsx & SummaryMetricCard.tsx)
// ─────────────────────────────────────────────────────────────────────────────

export const StatCardSkeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-slate-900 shadow-sm flex-1 min-w-[180px] space-y-3 ${className}`}>
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

export const StatCardGridSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <StatCardSkeleton key={i} />
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. TABLE SKELETON (Used by generic Table.tsx and standalone lists)
// ─────────────────────────────────────────────────────────────────────────────

export const TableRowSkeleton: React.FC<{ columns?: number }> = ({ columns = 6 }) => (
  <tr className="border-b border-gray-150 dark:border-gray-800/80">
    {Array.from({ length: columns }).map((_, i) => (
      <td key={i} className="px-4 py-3.5">
        {i === 0 ? (
          <div className="flex items-center gap-3">
            <SkeletonAvatar size="sm" />
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
            width={i % 2 === 0 ? '70%' : '50%'}
            height="0.875rem"
            borderRadius="0.25rem"
          />
        )}
      </td>
    ))}
  </tr>
);

export const TableSkeleton: React.FC<{
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  className?: string;
}> = ({ rows = 6, columns = 6, showHeader = true, className = '' }) => (
  <div className={`w-full bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden ${className}`}>
    {showHeader && (
      <div className="px-4 py-3.5 border-b border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gray-50/50 dark:bg-slate-800/30">
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
          <tr className="bg-gray-50/80 dark:bg-slate-800/50 border-b border-gray-200 dark:border-gray-800">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="px-4 py-3">
                <Skeleton width="60%" height="0.75rem" borderRadius="0.25rem" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-150 dark:divide-gray-800">
          {Array.from({ length: rows }).map((_, i) => (
            <TableRowSkeleton key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>

    {/* Table Footer / Pagination */}
    <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
      <Skeleton width="12rem" height="0.875rem" borderRadius="0.25rem" />
      <div className="flex items-center gap-2">
        <Skeleton width="2rem" height="2rem" borderRadius="0.375rem" />
        <Skeleton width="2rem" height="2rem" borderRadius="0.375rem" />
        <Skeleton width="2rem" height="2rem" borderRadius="0.375rem" />
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. DASHBOARD SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const DashboardSkeleton: React.FC = () => (
  <div className="space-y-6 pb-8 animate-pulse-subtle">
    {/* Header */}
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-150 dark:border-gray-800">
      <div className="space-y-1.5">
        <Skeleton width="8rem" height="0.75rem" borderRadius="0.25rem" />
        <Skeleton width="18rem" height="1.75rem" borderRadius="0.375rem" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton width="8rem" height="2rem" borderRadius="0.5rem" />
        <Skeleton width="7rem" height="2rem" borderRadius="0.5rem" />
      </div>
    </div>

    {/* Top KPI Stat Cards */}
    <StatCardGridSkeleton count={5} />

    {/* Macro Analytics Tier (Main Chart + Sector Donut) */}
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      {/* Area Chart Skeleton */}
      <div className="xl:col-span-3 bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <Skeleton width="12rem" height="1.125rem" borderRadius="0.25rem" />
            <Skeleton width="16rem" height="0.75rem" borderRadius="0.25rem" />
          </div>
          <Skeleton width="9rem" height="1.75rem" borderRadius="0.375rem" />
        </div>
        <div className="h-[300px] w-full flex items-end gap-3 pt-6 px-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <Skeleton
                width="100%"
                height={`${Math.max(25, ((i * 17) % 80) + 20)}%`}
                borderRadius="0.25rem 0.25rem 0 0"
              />
              <Skeleton width="80%" height="0.65rem" borderRadius="0.25rem" />
            </div>
          ))}
        </div>
      </div>

      {/* Donut Chart Skeleton */}
      <div className="xl:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6 flex flex-col justify-between">
        <div className="space-y-1.5">
          <Skeleton width="14rem" height="1.125rem" borderRadius="0.25rem" />
          <Skeleton width="10rem" height="0.75rem" borderRadius="0.25rem" />
        </div>
        <div className="flex items-center justify-center my-4">
          <div className="w-44 h-44 rounded-full border-8 border-slate-200 dark:border-slate-800 animate-shimmer flex items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-white dark:bg-slate-900" />
          </div>
        </div>
        <div className="space-y-2 pt-2 border-t border-gray-150 dark:border-gray-800">
          <div className="flex justify-between"><Skeleton width="40%" height="0.75rem" /><Skeleton width="20%" height="0.75rem" /></div>
          <div className="flex justify-between"><Skeleton width="35%" height="0.75rem" /><Skeleton width="25%" height="0.75rem" /></div>
          <div className="flex justify-between"><Skeleton width="45%" height="0.75rem" /><Skeleton width="15%" height="0.75rem" /></div>
        </div>
      </div>
    </div>

    {/* Performance & Power Cards Grid */}
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4 h-[380px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="space-y-1.5">
              <Skeleton width="10rem" height="1.125rem" borderRadius="0.25rem" />
              <Skeleton width="14rem" height="0.75rem" borderRadius="0.25rem" />
            </div>
            <Skeleton width="4rem" height="1.25rem" borderRadius="9999px" />
          </div>
          <div className="space-y-3 flex-1 flex flex-col justify-center">
            <Skeleton width="100%" height="2rem" borderRadius="0.375rem" />
            <Skeleton width="100%" height="2rem" borderRadius="0.375rem" />
            <Skeleton width="100%" height="2rem" borderRadius="0.375rem" />
          </div>
          <div className="pt-3 border-t border-gray-150 dark:border-gray-800 flex justify-between">
            <Skeleton width="30%" height="0.75rem" />
            <Skeleton width="20%" height="0.75rem" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. PROJECT MANAGEMENT SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const ProjectCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4 flex flex-col justify-between">
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Skeleton width="35%" height="1.25rem" borderRadius="9999px" />
        <Skeleton width="25%" height="1.25rem" borderRadius="9999px" />
      </div>
      <Skeleton width="85%" height="1.25rem" borderRadius="0.25rem" />
      <SkeletonText lines={2} lineHeight="0.75rem" />
    </div>

    {/* Financial Metrics */}
    <div className="grid grid-cols-2 gap-3 py-3 border-y border-gray-150 dark:border-gray-800">
      <div className="space-y-1">
        <Skeleton width="50%" height="0.65rem" />
        <Skeleton width="80%" height="1rem" />
      </div>
      <div className="space-y-1">
        <Skeleton width="50%" height="0.65rem" />
        <Skeleton width="80%" height="1rem" />
      </div>
    </div>

    {/* Progress Bar & Footer */}
    <div className="space-y-2">
      <div className="flex justify-between">
        <Skeleton width="30%" height="0.65rem" />
        <Skeleton width="15%" height="0.65rem" />
      </div>
      <Skeleton width="100%" height="0.5rem" borderRadius="9999px" />
    </div>
  </div>
);

export const ProjectGridSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div className="space-y-6">
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div className="space-y-1">
        <Skeleton width="8rem" height="0.75rem" />
        <Skeleton width="14rem" height="1.5rem" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton width="12rem" height="2.25rem" borderRadius="0.5rem" />
        <Skeleton width="7rem" height="2.25rem" borderRadius="0.5rem" />
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <ProjectCardSkeleton key={i} />
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. FUNDS MANAGEMENT SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const FundCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
    <div className="flex justify-between items-start">
      <div className="flex items-center gap-3">
        <Skeleton width="2.5rem" height="2.5rem" borderRadius="0.5rem" />
        <div className="space-y-1.5">
          <Skeleton width="10rem" height="1rem" />
          <Skeleton width="6rem" height="0.75rem" />
        </div>
      </div>
      <Skeleton width="4.5rem" height="1.25rem" borderRadius="9999px" />
    </div>

    <div className="space-y-1 pt-2">
      <Skeleton width="40%" height="0.65rem" />
      <Skeleton width="70%" height="1.75rem" />
    </div>

    <div className="flex justify-between items-center pt-3 border-t border-gray-150 dark:border-gray-800">
      <Skeleton width="5rem" height="0.75rem" />
      <div className="flex items-center gap-1.5">
        <Skeleton width="2rem" height="2rem" borderRadius="0.375rem" />
        <Skeleton width="4.5rem" height="2rem" borderRadius="0.375rem" />
      </div>
    </div>
  </div>
);

export const FundsGridSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="space-y-6">
    <div className="flex justify-between items-center">
      <div className="space-y-1">
        <Skeleton width="8rem" height="0.75rem" />
        <Skeleton width="14rem" height="1.5rem" />
      </div>
      <Skeleton width="8rem" height="2.25rem" borderRadius="0.5rem" />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <FundCardSkeleton key={i} />
      ))}
    </div>

    <TableSkeleton rows={4} columns={6} />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. GOVERNANCE & MEETINGS SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const GovernanceSkeleton: React.FC = () => (
  <div className="space-y-6">
    {/* Top Summary Bar */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
      <StatCardSkeleton />
    </div>

    {/* Meeting Header & Filters */}
    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1.5">
          <Skeleton width="14rem" height="1.25rem" />
          <Skeleton width="20rem" height="0.75rem" />
        </div>
        <Skeleton width="8rem" height="2.25rem" borderRadius="0.5rem" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <Skeleton width="100%" height="2.5rem" borderRadius="0.375rem" />
        <Skeleton width="100%" height="2.5rem" borderRadius="0.375rem" />
        <Skeleton width="100%" height="2.5rem" borderRadius="0.375rem" />
      </div>
    </div>

    {/* Attendance Roster Table */}
    <TableSkeleton rows={6} columns={6} />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. REPORTS SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const ReportsSkeleton: React.FC = () => (
  <div className="space-y-6">
    <div className="flex justify-between items-center">
      <div className="space-y-1.5">
        <Skeleton width="10rem" height="0.75rem" />
        <Skeleton width="16rem" height="1.5rem" />
      </div>
      <Skeleton width="10rem" height="2.25rem" borderRadius="0.5rem" />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton width="2.5rem" height="2.5rem" borderRadius="0.5rem" />
            <div className="space-y-1 flex-1">
              <Skeleton width="80%" height="0.875rem" />
              <Skeleton width="50%" height="0.65rem" />
            </div>
          </div>
          <Skeleton width="100%" height="0.75rem" />
          <div className="flex justify-between items-center pt-2 border-t border-gray-150 dark:border-gray-800">
            <Skeleton width="4rem" height="0.65rem" />
            <Skeleton width="5rem" height="1.75rem" borderRadius="0.375rem" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. GOALS SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const GoalsSkeleton: React.FC = () => (
  <div className="space-y-6">
    <div className="flex justify-between items-center">
      <div className="space-y-1">
        <Skeleton width="8rem" height="0.75rem" />
        <Skeleton width="14rem" height="1.5rem" />
      </div>
      <Skeleton width="8rem" height="2.25rem" borderRadius="0.5rem" />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
          <div className="flex justify-between">
            <Skeleton width="40%" height="1.25rem" borderRadius="9999px" />
            <Skeleton width="20%" height="1.25rem" borderRadius="9999px" />
          </div>
          <Skeleton width="80%" height="1.25rem" />
          <SkeletonText lines={2} />
          <div className="space-y-1.5 pt-2">
            <div className="flex justify-between">
              <Skeleton width="30%" height="0.65rem" />
              <Skeleton width="20%" height="0.65rem" />
            </div>
            <Skeleton width="100%" height="0.5rem" borderRadius="9999px" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. DIVIDENDS SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const DividendSkeleton: React.FC = () => (
  <div className="space-y-6">
    {/* Dividend Pool Banner */}
    <div className="bg-gradient-to-r from-blue-600/10 to-indigo-600/10 p-6 rounded-xl border border-blue-200 dark:border-blue-900/40 space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-2">
          <Skeleton width="10rem" height="0.875rem" />
          <Skeleton width="16rem" height="2rem" />
          <Skeleton width="12rem" height="0.75rem" />
        </div>
        <Skeleton width="9rem" height="2.5rem" borderRadius="0.5rem" />
      </div>
    </div>

    {/* Shareholder Allocation Table */}
    <TableSkeleton rows={5} columns={6} />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 12. SETTINGS SKELETON
// ─────────────────────────────────────────────────────────────────────────────

export const SettingsSkeleton: React.FC = () => (
  <div className="space-y-6">
    {/* Tab Bar */}
    <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-2">
      <Skeleton width="6rem" height="2rem" borderRadius="0.375rem" />
      <Skeleton width="6rem" height="2rem" borderRadius="0.375rem" />
      <Skeleton width="6rem" height="2rem" borderRadius="0.375rem" />
      <Skeleton width="6rem" height="2rem" borderRadius="0.375rem" />
    </div>

    {/* Settings Form Card */}
    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6 max-w-4xl">
      <div className="space-y-1.5">
        <Skeleton width="12rem" height="1.25rem" />
        <Skeleton width="20rem" height="0.75rem" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Skeleton width="40%" height="0.75rem" />
          <Skeleton width="100%" height="2.5rem" borderRadius="0.375rem" />
        </div>
        <div className="space-y-2">
          <Skeleton width="40%" height="0.75rem" />
          <Skeleton width="100%" height="2.5rem" borderRadius="0.375rem" />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-150 dark:border-gray-800">
        <Skeleton width="5rem" height="2.25rem" borderRadius="0.375rem" />
        <Skeleton width="7rem" height="2.25rem" borderRadius="0.375rem" />
      </div>
    </div>
  </div>
);

export default Skeleton;
