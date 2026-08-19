import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useGlobalState } from '../context/GlobalStateContext';

// Track the last time global data was refreshed to prevent network storms on rapid navigation
let lastGlobalRefreshTime = Date.now();
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * DataRefreshWrapper - Lightweight wrapper that ensures children render immediately
 * and only performs background synchronization when data is genuinely stale (>5 minutes).
 */
const DataRefreshWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const location = useLocation();
    const { refreshAllData, connectionStatus } = useGlobalState();

    useEffect(() => {
        const now = Date.now();
        // Only refresh in background if online and at least 5 minutes have passed since last refresh
        if (connectionStatus === 'online' && now - lastGlobalRefreshTime > REFRESH_INTERVAL_MS) {
            lastGlobalRefreshTime = now;
            refreshAllData().catch((err) => {
                console.warn('Background data sync skipped/failed:', err);
            });
        }
    }, [location.pathname, connectionStatus, refreshAllData]);

    return <>{children}</>;
};

export default DataRefreshWrapper;
