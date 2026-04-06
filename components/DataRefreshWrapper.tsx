import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useGlobalState } from '../context/GlobalStateContext';

/**
 * DataRefreshWrapper - Automatically refreshes data when navigating between screens
 * Wraps the main content area to ensure fresh data on every screen open
 */
const DataRefreshWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const location = useLocation();
    const { refreshAllData, connectionStatus } = useGlobalState();

    useEffect(() => {
        // Only refresh if online and route changes
        if (connectionStatus === 'online') {
            // Small delay to ensure smooth navigation animation
            const timer = setTimeout(() => {
                refreshAllData().catch(err => {
                    console.error('Auto-refresh failed:', err);
                    // Don't show error - background refresh should be silent
                });
            }, 100);

            return () => clearTimeout(timer);
        }
    }, [location.pathname, connectionStatus]); // Refresh on route change

    return <>{children}</>;
};

export default DataRefreshWrapper;
