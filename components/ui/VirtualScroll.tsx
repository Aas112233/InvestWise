import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * Virtual Scroll Component
 * Efficiently renders large lists by only rendering visible items
 */

interface VirtualScrollItem {
 id: string;
 [key: string]: any;
}

interface VirtualScrollProps<T extends VirtualScrollItem> {
 items: T[];
 itemHeight: number;
 renderItem: (item: T, index: number) => React.ReactNode;
 overscan?: number;
 containerHeight?: number;
 className?: string;
 loading?: boolean;
 emptyMessage?: string;
 onEndReached?: () => void;
 endThreshold?: number;
}

function VirtualScroll<T extends VirtualScrollItem>({
 items,
 itemHeight,
 renderItem,
 overscan = 5,
 containerHeight,
 className = '',
 loading = false,
 emptyMessage = 'No items',
 onEndReached,
 endThreshold = 200
}: VirtualScrollProps<T>) {
 const [scrollTop, setScrollTop] = useState(0);
 const containerRef = useRef<HTMLDivElement>(null);
 const [containerSize, setContainerSize] = useState(
 containerHeight || (typeof window !== 'undefined' ? window.innerHeight - 200 : 600)
 );

 // Update container size on resize
 useEffect(() => {
 if (!containerRef.current || containerHeight) return;

 const observer = new ResizeObserver((entries) => {
 for (const entry of entries) {
 setContainerSize(entry.contentRect.height);
 }
 });

 observer.observe(containerRef.current);
 return () => observer.disconnect();
 }, [containerHeight]);

 // Calculate visible items
 const { visibleItems, totalHeight, offsetY } = useMemo(() => {
 const totalHeight = items.length * itemHeight;
 const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
 const visibleCount = Math.ceil(containerSize / itemHeight) + overscan * 2;
 const endIndex = Math.min(items.length, startIndex + visibleCount);

 const visibleItems = items.slice(startIndex, endIndex).map((item, index) => ({
 item,
 index: startIndex + index
 }));

 const offsetY = startIndex * itemHeight;

 return { visibleItems, totalHeight, offsetY };
 }, [items, itemHeight, scrollTop, containerSize, overscan]);

 // Handle scroll
 const handleScroll = useCallback(
 (e: React.UIEvent<HTMLDivElement>) => {
 const target = e.currentTarget;
 setScrollTop(target.scrollTop);

 // Check if reached end
 if (onEndReached) {
 const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
 if (distanceToBottom < endThreshold) {
 onEndReached();
 }
 }
 },
 [onEndReached, endThreshold]
 );

 if (loading) {
 return (
 <div className={`flex items-center justify-center py-20 ${className}`}>
 <div className="text-center">
 <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
 <p className="text-xs font-black text-gray-400 uppercase tracking-widest">
 Loading Items...
 </p>
 </div>
 </div>
 );
 }

 if (items.length === 0) {
 return (
 <div className={`flex items-center justify-center py-20 ${className}`}>
 <p className="text-sm font-bold text-gray-500 dark:text-gray-400">{emptyMessage}</p>
 </div>
 );
 }

 return (
 <div
 ref={containerRef}
 onScroll={handleScroll}
 className={`overflow-auto ${className}`}
 style={{ height: containerSize }}
 >
 <div style={{ height: totalHeight, position: 'relative' }}>
 <div style={{ transform: `translateY(${offsetY}px)` }}>
 {visibleItems.map(({ item, index }) => (
 <div
 key={item.id}
 style={{ height: itemHeight }}
 className="overflow-hidden"
 >
 {renderItem(item, index)}
 </div>
 ))}
 </div>
 </div>
 </div>
 );
}

/**
 * Virtual List with Auto-Loading
 * Automatically loads more items when scrolling near the end
 */

interface VirtualListWithLoadProps<T extends VirtualScrollItem> {
 items: T[];
 itemHeight: number;
 renderItem: (item: T, index: number) => React.ReactNode;
 isLoading: boolean;
 hasMore: boolean;
 onLoadMore: () => void;
 containerHeight?: number;
 className?: string;
}

export function VirtualListWithLoad<T extends VirtualScrollItem>({
 items,
 itemHeight,
 renderItem,
 isLoading,
 hasMore,
 onLoadMore,
 containerHeight,
 className = ''
}: VirtualListWithLoadProps<T>) {
 return (
 <div className="relative">
 <VirtualScroll
 items={items}
 itemHeight={itemHeight}
 renderItem={renderItem}
 containerHeight={containerHeight}
 className={className}
 loading={isLoading && items.length === 0}
 onEndReached={hasMore && !isLoading ? onLoadMore : undefined}
 endThreshold={300}
 />

 {/* Loading indicator at bottom */}
 {isLoading && items.length > 0 && hasMore && (
 <div className="sticky bottom-0 py-4 bg-gradient-to-t from-white dark:from-[#1A221D] to-transparent">
 <div className="flex items-center justify-center gap-3">
 <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
 <span className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
 Loading more...
 </span>
 </div>
 </div>
 )}
 </div>
 );
}

/**
 * Grid-based Virtual Scroll
 * For grid layouts with many items
 */

interface VirtualGridProps<T extends VirtualScrollItem> {
 items: T[];
 itemWidth: number;
 itemHeight: number;
 renderItem: (item: T, index: number) => React.ReactNode;
 gap?: number;
 containerHeight?: number;
 className?: string;
}

export function VirtualGrid<T extends VirtualScrollItem>({
 items,
 itemWidth,
 itemHeight,
 renderItem,
 gap = 16,
 containerHeight,
 className = ''
}: VirtualGridProps<T>) {
 const [scrollTop, setScrollTop] = useState(0);
 const containerRef = useRef<HTMLDivElement>(null);
 const [containerWidth, setContainerWidth] = useState(
 typeof window !== 'undefined' ? window.innerWidth - 100 : 800
 );
 const containerSize = containerHeight || (typeof window !== 'undefined' ? window.innerHeight - 200 : 600);

 // Calculate columns
 const columns = useMemo(() => {
 return Math.max(1, Math.floor((containerWidth + gap) / (itemWidth + gap)));
 }, [containerWidth, itemWidth, gap]);

 // Calculate rows
 const rows = useMemo(() => {
 return Math.ceil(items.length / columns);
 }, [items.length, columns]);

 // Update container size
 useEffect(() => {
 if (!containerRef.current) return;

 const observer = new ResizeObserver((entries) => {
 for (const entry of entries) {
 setContainerWidth(entry.contentRect.width);
 }
 });

 observer.observe(containerRef.current);
 return () => observer.disconnect();
 }, []);

 // Calculate visible items
 const { visibleItems, totalHeight, offsetY } = useMemo(() => {
 const totalHeight = rows * (itemHeight + gap);
 const startRow = Math.max(0, Math.floor(scrollTop / (itemHeight + gap)) - 2);
 const visibleRows = Math.ceil(containerSize / (itemHeight + gap)) + 4;
 const endRow = Math.min(rows, startRow + visibleRows);

 const startIndex = startRow * columns;
 const endIndex = Math.min(items.length, endRow * columns);

 const visibleItems = items.slice(startIndex, endIndex).map((item, index) => ({
 item,
 index: startIndex + index
 }));

 const offsetY = startRow * (itemHeight + gap);

 return { visibleItems, totalHeight, offsetY };
 }, [items, columns, rows, itemHeight, itemWidth, gap, scrollTop, containerSize]);

 const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
 setScrollTop(e.currentTarget.scrollTop);
 }, []);

 return (
 <div
 ref={containerRef}
 onScroll={handleScroll}
 className={`overflow-auto ${className}`}
 style={{ height: containerSize }}
 >
 <div style={{ height: totalHeight, position: 'relative' }}>
 <div
 style={{
 transform: `translateY(${offsetY}px)`,
 display: 'grid',
 gridTemplateColumns: `repeat(${columns}, ${itemWidth}px)`,
 gap: `${gap}px`
 }}
 >
 {visibleItems.map(({ item, index }) => (
 <div key={item.id} style={{ width: itemWidth, height: itemHeight }}>
 {renderItem(item, index)}
 </div>
 ))}
 </div>
 </div>
 </div>
 );
}

export default VirtualScroll;
