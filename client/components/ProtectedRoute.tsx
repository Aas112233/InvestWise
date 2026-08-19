import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { User, AppScreen, AccessLevel } from '../types';
import { checkUserPermission } from '../utils/permissions';

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

  // Role & Granular Permission Check
  if (requiredScreen && !checkUserPermission(user, requiredScreen, AccessLevel.READ)) {
    return (
      <AppShell>
        {forbiddenComponent}
      </AppShell>
    );
  }

  return <AppShell>{children}</AppShell>;
};

export default ProtectedRoute;
