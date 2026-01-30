import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { User, AppScreen, AccessLevel } from '../types';

interface ProtectedRouteProps {
    user: User | null;
    children: React.ReactNode;
    requiredScreen?: AppScreen;
    appShell: (props: { children: React.ReactNode }) => React.JSX.Element;
    forbiddenComponent: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
    user,
    children,
    requiredScreen,
    appShell: AppShell,
    forbiddenComponent
}) => {
    const location = useLocation();

    if (!user) {
        // Redirect to login but save the current location they were trying to go to
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // Role-Based Access Control Check
    if (requiredScreen) {
        const userPermission = user.permissions?.[requiredScreen];
        if (userPermission === AccessLevel.NONE) {
            return (
                <AppShell>
                    {forbiddenComponent}
                </AppShell>
            );
        }
    }

    return <AppShell>{children}</AppShell>;
};

export default ProtectedRoute;
