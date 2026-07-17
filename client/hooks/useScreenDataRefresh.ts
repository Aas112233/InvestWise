import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Hook to automatically refresh data when navigating between screens
 * Ensures users always see the latest data from the server
 */
export const useScreenDataRefresh = (
    refreshFn: () => Promise<void>,
    options?: {
        immediate?: boolean;  // Refresh immediately on mount
        debounceMs?: number;  // Debounce rapid navigation
        skipPaths?: string[]; // Skip refresh on certain paths
    }
) => {
    const location = useLocation();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isMountedRef = useRef<boolean>(true);

    const {
        immediate = true,
        debounceMs = 300,
        skipPaths = []
    } = options || {};

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    // Memoized refresh function
    const performRefresh = useCallback(async () => {
        try {
            await refreshFn();
        } catch (error) {
            console.error('Screen data refresh failed:', error);
            // Don't throw - we don't want to break the UI
        }
    }, [refreshFn]);

    // Track previous path for route-change detection only
    const pathRef = useRef<string>(location.pathname);

    // Refresh when the route changes (NOT on initial mount)
    useEffect(() => {
        const currentPath = location.pathname;

        // Skip: same path, initial mount, or excluded paths
        if (currentPath === pathRef.current || skipPaths.includes(currentPath)) {
            return;
        }

        // Clear any pending refresh
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Debounce rapid navigation
        timeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
                performRefresh();
                pathRef.current = currentPath;
            }
        }, debounceMs);

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [location.pathname, performRefresh, debounceMs, skipPaths]);

    // Initial load — single refresh on mount
    useEffect(() => {
        if (immediate && !skipPaths.includes(location.pathname)) {
            performRefresh();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run once on mount

    // Manual refresh trigger
    const triggerRefresh = useCallback(() => {
        return performRefresh();
    }, [performRefresh]);

    return {
        triggerRefresh,
        isRefreshing: false // Could add loading state if needed
    };
};
