import React from 'react';
import { motion } from 'framer-motion';

/**
 * Skeleton Loading Components
 * Premium placeholder loaders that improve perceived performance
 */

// ==========================================
// BASE SKELETON COMPONENT
// ==========================================

interface SkeletonProps {
 width?: string | number;
 height?: string | number;
 borderRadius?: string;
 className?: string;
 animation?: 'pulse' | 'wave' | 'none';
 count?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
 width = '100%',
 height = '1rem',
 borderRadius = '0.5rem',
 className = '',
 animation = 'wave',
 count = 1
}) => {
 return (
 <>
 {Array.from({ length: count }).map((_, i) => (
 <motion.div
 key={i}
 className={`bg-gray-200 dark:bg-white/5 relative overflow-hidden ${className}`}
 style={{
 width,
 height,
 borderRadius,
 animationDelay: `${i * 0.1}s`
 }}
 >
 {animation === 'wave' && (
 <motion.div
 className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 dark:via-white/5 to-transparent"
 animate={{
 x: ['-200%', '200%']
 }}
 transition={{
 duration: 1.5,
 ease: 'easeInOut',
 repeat: Infinity,
 repeatDelay: 0.5
 }}
 />
 )}
 {animation === 'pulse' && (
 <motion.div
 className="absolute inset-0 bg-gray-300 dark:bg-white/10"
 animate={{
 opacity: [0.5, 1, 0.5]
 }}
 transition={{
 duration: 1.5,
 ease: 'easeInOut',
 repeat: Infinity
 }}
 />
 )}
 </motion.div>
 ))}
 </>
 );
};

// ==========================================
// CARD SKELETON
// ==========================================

interface CardSkeletonProps {
 count?: number;
 variant?: 'stat' | 'chart' | 'table' | 'profile';
}

export const CardSkeleton: React.FC<CardSkeletonProps> = ({
 count = 1,
 variant = 'stat'
}) => {
 if (variant === 'stat') {
 return (
 <>
 {Array.from({ length: count }).map((_, i) => (
 <div
 key={i}
 className="bg-white dark:bg-[#1A221D] rounded-[2.5rem] p-8 lg:p-10 border border-gray-100 dark:border-white/5"
 >
 <Skeleton width="40%" height="12px" className="mb-4" />
 <Skeleton width="70%" height="48px" className="mb-3" />
 <Skeleton width="50%" height="16px" />
 </div>
 ))}
 </>
 );
 }

 if (variant === 'chart') {
 return (
 <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] p-12 border border-gray-100 dark:border-white/5">
 <Skeleton width="60%" height="32px" className="mb-4" />
 <Skeleton width="80%" height="16px" className="mb-8" />
 <div className="space-y-4">
 {Array.from({ length: 6 }).map((_, i) => (
 <Skeleton key={i} width="100%" height="60px" className="mb-4" />
 ))}
 </div>
 </div>
 );
 }

 if (variant === 'table') {
 return (
 <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] border border-gray-100 dark:border-white/5 overflow-hidden">
 {/* Table Header */}
 <div className="px-10 py-6 border-b border-gray-50 dark:border-white/5">
 <div className="flex items-center justify-between">
 <Skeleton width="30%" height="24px" />
 <Skeleton width="200px" height="48px" borderRadius="2rem" />
 </div>
 </div>

 {/* Table Rows */}
 <div className="divide-y divide-gray-50 dark:divide-white/5">
 {Array.from({ length: 5 }).map((_, i) => (
 <div key={i} className="px-10 py-6 flex items-center justify-between">
 <div className="flex items-center gap-4">
 <Skeleton width="48px" height="48px" borderRadius="50%" />
 <div>
 <Skeleton width="150px" height="16px" className="mb-2" />
 <Skeleton width="100px" height="12px" />
 </div>
 </div>
 <Skeleton width="120px" height="20px" />
 <div className="flex items-center gap-2">
 <Skeleton width="40px" height="40px" borderRadius="12px" />
 <Skeleton width="40px" height="40px" borderRadius="12px" />
 </div>
 </div>
 ))}
 </div>
 </div>
 );
 }

 return null;
};

// ==========================================
// PAGE SKELETON
// ==========================================

interface PageSkeletonProps {
 type?: 'dashboard' | 'list' | 'detail' | 'form';
}

export const PageSkeleton: React.FC<PageSkeletonProps> = ({
 type = 'dashboard'
}) => {
 if (type === 'dashboard') {
 return (
 <div className="space-y-12 animate-pulse">
 {/* Header */}
 <div className="flex items-end justify-between">
 <div>
 <Skeleton width="200px" height="12px" className="mb-3" />
 <Skeleton width="300px" height="40px" />
 </div>
 <Skeleton width="48px" height="48px" borderRadius="50%" />
 </div>

 {/* Stat Cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8">
 <CardSkeleton count={5} variant="stat" />
 </div>

 {/* Charts */}
 <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
 <div className="xl:col-span-3">
 <CardSkeleton variant="chart" />
 </div>
 <div className="xl:col-span-2">
 <CardSkeleton variant="chart" />
 </div>
 </div>
 </div>
 );
 }

 if (type === 'list') {
 return (
 <div className="space-y-10 animate-pulse">
 {/* Header */}
 <div className="flex items-end justify-between">
 <div>
 <Skeleton width="150px" height="12px" className="mb-3" />
 <Skeleton width="250px" height="40px" />
 </div>
 <div className="flex items-center gap-4">
 <Skeleton width="200px" height="48px" borderRadius="2rem" />
 <Skeleton width="150px" height="56px" borderRadius="2rem" />
 </div>
 </div>

 {/* Stats */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
 <CardSkeleton count={2} variant="stat" />
 </div>

 {/* Table */}
 <CardSkeleton variant="table" />
 </div>
 );
 }

 if (type === 'detail') {
 return (
 <div className="max-w-4xl mx-auto space-y-8 animate-pulse">
 {/* Profile Header */}
 <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] p-12 border border-gray-100 dark:border-white/5">
 <div className="flex items-center gap-6 mb-8">
 <Skeleton width="100px" height="100px" borderRadius="50%" />
 <div>
 <Skeleton width="300px" height="40px" className="mb-3" />
 <Skeleton width="200px" height="20px" />
 </div>
 </div>
 <div className="grid grid-cols-2 gap-6">
 <Skeleton width="100%" height="80px" borderRadius="2rem" />
 <Skeleton width="100%" height="80px" borderRadius="2rem" />
 </div>
 </div>

 {/* Content Cards */}
 <CardSkeleton variant="chart" />
 </div>
 );
 }

 if (type === 'form') {
 return (
 <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
 <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] p-12 border border-gray-100 dark:border-white/5">
 {/* Form Header */}
 <Skeleton width="60%" height="36px" className="mb-3" />
 <Skeleton width="40%" height="16px" className="mb-8" />

 {/* Form Fields */}
 <div className="space-y-6">
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 <Skeleton width="100%" height="72px" borderRadius="2rem" />
 <Skeleton width="100%" height="72px" borderRadius="2rem" />
 </div>
 <Skeleton width="100%" height="72px" borderRadius="2rem" />
 <Skeleton width="100%" height="72px" borderRadius="2rem" />
 <div className="grid grid-cols-2 gap-6">
 <Skeleton width="100%" height="72px" borderRadius="2rem" />
 <Skeleton width="100%" height="72px" borderRadius="2rem" />
 </div>
 </div>

 {/* Form Actions */}
 <div className="flex items-center justify-end gap-4 mt-8 pt-8 border-t border-gray-100 dark:border-white/5">
 <Skeleton width="120px" height="56px" borderRadius="2rem" />
 <Skeleton width="180px" height="64px" borderRadius="2.5rem" />
 </div>
 </div>
 </div>
 );
 }

 return null;
};

// ==========================================
// MINI SKELETONS
// ==========================================

export const SkeletonText: React.FC<{
 lines?: number;
 maxWidth?: string;
}> = ({ lines = 1, maxWidth = '100%' }) => (
 <div className="space-y-2">
 {Array.from({ length: lines }).map((_, i) => (
 <Skeleton
 key={i}
 width={i === lines - 1 ? '70%' : maxWidth}
 height="16px"
 />
 ))}
 </div>
);

export const SkeletonAvatar: React.FC = () => (
 <Skeleton width="48px" height="48px" borderRadius="50%" animation="pulse" />
);

export const SkeletonButton: React.FC<{
 width?: string;
 height?: string;
}> = ({ width = '120px', height = '48px' }) => (
 <Skeleton
 width={width}
 height={height}
 borderRadius="2rem"
 animation="pulse"
 />
);

export const SkeletonImage: React.FC<{
 width?: string;
 height?: string;
}> = ({ width = '100%', height = '200px' }) => (
 <Skeleton
 width={width}
 height={height}
 borderRadius="1rem"
 animation="wave"
 />
);

// ==========================================
// EXPORT ALL
// ==========================================

export default Skeleton;
