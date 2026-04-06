/**
 * Chart Performance Optimization Utilities
 * Data sampling, memoization, and rendering optimization
 */

import { useMemo } from 'react';

/**
 * Data Sampling Utility
 * Reduces large datasets for better chart performance
 * Uses Largest-Triangle-Three-Buckets (LTTB) algorithm
 */

export interface DataPoint {
 [key: string]: any;
}

/**
 * LTTB Sampling Algorithm
 * Preserves visual appearance while reducing data points
 */
export const sampleDataLTTB = (
 data: DataPoint[],
 xKey: string,
 yKey: string,
 threshold: number
): DataPoint[] => {
 if (data.length <= threshold) return data;
 if (threshold < 3) {
 return [data[0], data[data.length - 1]];
 }

 const sampled = new Array(threshold);
 let sampledIndex = 0;
 sampled[sampledIndex++] = data[0];

 const bucketSize = (data.length - 2) / (threshold - 2);

 let lastSelectedX = 0;
 let lastSelectedY = 0;

 for (let i = 0; i < threshold - 2; i++) {
 const bucketStart = Math.floor((i + 0) * bucketSize) + 1;
 const bucketEnd = Math.floor((i + 1) * bucketSize) + 1;

 const avgX = (bucketStart + bucketEnd) / 2;
 const avgY =
 data
 .slice(bucketStart, bucketEnd)
 .reduce((sum, point) => sum + Number(point[yKey]), 0) /
 (bucketEnd - bucketStart);

 let maxArea = -1;
 let maxAreaPoint = data[bucketStart];

 for (let j = bucketStart; j < bucketEnd; j++) {
 // Calculate triangle area
 const area =
 Math.abs(
 (lastSelectedX - avgX) * (data[j][yKey] - lastSelectedY) -
 (lastSelectedX - Number(data[j][xKey])) * (avgY - lastSelectedY)
 ) * 0.5;

 if (area > maxArea) {
 maxArea = area;
 maxAreaPoint = data[j];
 }
 }

 sampled[sampledIndex++] = maxAreaPoint;
 lastSelectedX = Number(maxAreaPoint[xKey]);
 lastSelectedY = Number(maxAreaPoint[yKey]);
 }

 sampled[sampledIndex] = data[data.length - 1];

 return sampled;
};

/**
 * Simple Random Sampling
 * Faster but less accurate than LTTB
 */
export const sampleDataRandom = (
 data: DataPoint[],
 threshold: number
): DataPoint[] => {
 if (data.length <= threshold) return data;

 const sampled = [data[0]]; // Always keep first
 const step = Math.floor(data.length / threshold);

 for (let i = step; i < data.length - 1; i += step) {
 sampled.push(data[i]);
 }

 sampled.push(data[data.length - 1]); // Always keep last

 return sampled;
};

/**
 * Min-Max Sampling
 * Keeps minimum and maximum values plus evenly distributed points
 */
export const sampleDataMinMax = (
 data: DataPoint[],
 yKey: string,
 threshold: number
): DataPoint[] => {
 if (data.length <= threshold) return data;

 const minPoint = data.reduce((min, current) =>
 Number(current[yKey]) < Number(min[yKey]) ? current : min
 );

 const maxPoint = data.reduce((max, current) =>
 Number(current[yKey]) > Number(max[yKey]) ? current : max
 );

 // Keep min, max, and evenly distributed points
 const sampled = [minPoint, maxPoint];
 const remainingThreshold = threshold - 2;
 const step = Math.floor(data.length / remainingThreshold);

 for (let i = 0; i < data.length && sampled.length < threshold; i += step) {
 if (!sampled.includes(data[i])) {
 sampled.push(data[i]);
 }
 }

 // Sort by original order
 return sampled.sort((a, b) => data.indexOf(a) - data.indexOf(b));
};

/**
 * React Hook for Optimized Chart Data
 * Automatically samples data based on screen size
 */
export const useOptimizedChartData = (
 data: DataPoint[],
 xKey: string,
 yKey: string,
 options?: {
 maxPoints?: number;
 method?: 'lttb' | 'random' | 'minmax';
 enabled?: boolean;
 }
) => {
 const {
 maxPoints = 100,
 method = 'lttb',
 enabled = true
 } = options || {};

 return useMemo(() => {
 if (!enabled || data.length <= maxPoints) return data;

 switch (method) {
 case 'lttb':
 return sampleDataLTTB(data, xKey, yKey, maxPoints);
 case 'random':
 return sampleDataRandom(data, maxPoints);
 case 'minmax':
 return sampleDataMinMax(data, yKey, maxPoints);
 default:
 return data;
 }
 }, [data, xKey, yKey, maxPoints, method, enabled]);
};

/**
 * Debounce Utility for Chart Updates
 * Prevents excessive re-renders
 */
export const debounceChartData = <T extends DataPoint[]>(
 fn: (data: T) => void,
 delay: number
) => {
 let timeoutId: NodeJS.Timeout;

 return (data: T) => {
 clearTimeout(timeoutId);
 timeoutId = setTimeout(() => fn(data), delay);
 };
};

/**
 * Chart Performance Monitor
 * Tracks rendering time and suggests optimizations
 */
export const monitorChartPerformance = (
 chartName: string,
 dataLength: number,
 renderTime: number
) => {
 if (process.env.NODE_ENV === 'development') {
 const thresholds = {
 excellent: 16, // 60fps
 good: 33, // 30fps
 acceptable: 66,
 poor: 100
 };

 let recommendation = '';

 if (renderTime > thresholds.poor && dataLength > 500) {
 recommendation = `Consider sampling: ${dataLength} points is too many. Try < 100 points.`;
 } else if (renderTime > thresholds.acceptable) {
 recommendation = 'Chart rendering is slow. Check data size and complexity.';
 }

 if (recommendation) {
 console.warn(
 `[Chart Performance] ${chartName}: ${renderTime.toFixed(2)}ms (${
 dataLength
 } points)`,
 recommendation
 );
 }
 }
};

/**
 * Optimize Chart Configuration
 * Disables expensive features for better performance
 */
export const optimizeChartConfig = (config: any) => {
 return {
 ...config,
 // Disable animations for large datasets
 animationDuration: config.dataLength > 200 ? 0 : config.animationDuration,
 animationBegin: config.dataLength > 200 ? 0 : config.animationBegin,

 // Simplify tooltip
 tooltip: {
 ...config.tooltip,
 // Use simpler tooltip for better performance
 useTranslate3d: true,
 // Reduce tooltip updates
 isAnimationActive: config.dataLength > 100 ? false : config.tooltip?.isAnimationActive
 },

 // Optimize grid
 cartesianGrid: {
 ...config.cartesianGrid,
 // Reduce grid lines for better performance
 strokeDasharray: config.dataLength > 500 ? '0' : config.cartesianGrid?.strokeDasharray
 }
 };
};

export default {
 sampleDataLTTB,
 sampleDataRandom,
 sampleDataMinMax,
 useOptimizedChartData,
 debounceChartData,
 monitorChartPerformance,
 optimizeChartConfig
};
