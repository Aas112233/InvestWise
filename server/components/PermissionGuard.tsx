import React from 'react';
import { AppScreen, AccessLevel } from '../types';
import { usePermission } from '../hooks/usePermission';
import { Lock } from 'lucide-react';

interface PermissionGuardProps {
    screen: AppScreen;
    requiredLevel?: AccessLevel;
    children: React.ReactNode;
    fallback?: React.ReactNode;
    showTooltip?: boolean;
}

/**
 * Component that conditionally renders children based on user permissions
 * Hides or disables UI elements if user lacks required permission level
 */
const PermissionGuard: React.FC<PermissionGuardProps> = ({
    screen,
    requiredLevel = AccessLevel.WRITE,
    children,
    fallback = null,
    showTooltip = false  // Default to hiding elements instead of showing disabled state
}) => {
    const hasPermission = usePermission(screen, requiredLevel);

    if (!hasPermission) {
        if (fallback) {
            return <>{fallback}</>;
        }

        // If no fallback provided and tooltip enabled, show disabled state with tooltip
        if (showTooltip) {
            return (
                <div className="relative group inline-block">
                    <div className="pointer-events-none opacity-40 select-none">
                        {children}
                    </div>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-dark dark:bg-white text-white dark:text-dark text-xs rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 flex items-center gap-2 shadow-xl">
                        <Lock size={12} />
                        <span className="font-bold">
                            {requiredLevel === AccessLevel.WRITE ? 'Write' : 'Read'} permission required
                        </span>
                    </div>
                </div>
            );
        }

        // No permission and no tooltip - completely hide
        return null;
    }

    return <>{children}</>;
};

export default PermissionGuard;
