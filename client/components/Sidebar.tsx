import React, { useState, useMemo } from 'react';
import { Menu, ChevronLeft } from 'lucide-react';
import { useLocation, Link } from 'react-router-dom';
import { NAVIGATION_ITEMS } from '../constants';
import { AppScreen, AccessLevel, User } from '../types';
import { Language, t } from '../i18n/translations';
import { useGlobalState } from '../context/GlobalStateContext';
import { checkUserPermission } from '../utils/permissions';
import '../premium-ui.css';

interface SidebarProps {
  lang: Language;
  currentUser?: User | null;
}

// Preload map for instant route transitions
const ROUTE_PRELOADERS: Record<string, () => Promise<any>> = {
  '/dashboard': () => import('./Dashboard'),
  '/members': () => import('./Members'),
  '/meetings': () => import('./MeetingPerformanceHub'),
  '/governance': () => import('./MeetingPerformanceHub'),
  '/deposits': () => import('./Deposits'),
  '/request-deposit': () => import('./RequestDeposit'),
  '/transactions': () => import('./Transactions'),
  '/projects': () => import('./ProjectManagement'),
  '/funds': () => import('./FundsManagement'),
  '/expenses': () => import('./Expenses'),
  '/analysis': () => import('./Analysis'),
  '/reports': () => import('./Reports'),
  '/settings': () => import('./Settings'),
  '/goals': () => import('./Goals'),
  '/dividends': () => import('./DividendManagement'),
};

const prefetchRoute = (route: string) => {
  const preloader = ROUTE_PRELOADERS[route];
  if (preloader) {
    preloader().catch(() => {});
  }
};

const Sidebar: React.FC<SidebarProps> = ({ lang, currentUser }) => {
  const { deposits, companyName, companyTagline } = useGlobalState();
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const location = useLocation();

  const isExpanded = isPinned || isHovered;

  // Idle background prefetch for high-traffic routes
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const coreRoutes = ['/dashboard', '/members', '/deposits', '/transactions', '/projects', '/funds'];
      coreRoutes.forEach((r) => prefetchRoute(r));
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Helper to map AppScreen to Routes
  const getRoute = (screen: AppScreen): string => {
    switch (screen) {
      case AppScreen.DASHBOARD: return '/dashboard';
      case AppScreen.MEMBERS: return '/members';
      case AppScreen.MEETINGS: return '/meetings';
      case AppScreen.GOVERNANCE: return '/governance';
      case AppScreen.DEPOSITS: return '/deposits';
      case AppScreen.REQUEST_DEPOSIT: return '/request-deposit';
      case AppScreen.TRANSACTIONS: return '/transactions';
      case AppScreen.PROJECT_MANAGEMENT: return '/projects';
      case AppScreen.FUNDS_MANAGEMENT: return '/funds';
      case AppScreen.EXPENSES: return '/expenses';
      case AppScreen.ANALYSIS: return '/analysis';
      case AppScreen.REPORTS: return '/reports';
      case AppScreen.SETTINGS: return '/settings';
      case AppScreen.GOALS: return '/goals';
      case AppScreen.DIVIDENDS: return '/dividends';
      default: return '/dashboard';
    }
  };

  // Filter navigation items based on user permissions
  const filteredNavItems = useMemo(() => {
    if (!currentUser) return NAVIGATION_ITEMS;

    return NAVIGATION_ITEMS.map(group => ({
      ...group,
      items: group.items.filter(item => {
        // Special rule for Dashboard - everyone sees it
        if (item.id === AppScreen.DASHBOARD) return true;
        return checkUserPermission(currentUser, item.id, AccessLevel.READ);
      })
    })).filter(group => group.items.length > 0);
  }, [currentUser]);

  const pendingDepsCount = useMemo(() => {
    return deposits.filter(d => d.status === 'Pending' || d.status === 'Processing').length;
  }, [deposits]);

  const toggleSidebar = () => setIsPinned(!isPinned);

  return (
    <aside
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`bg-white dark:bg-slate-900 h-screen border-r border-gray-200 dark:border-gray-800 flex flex-col py-4 shrink-0 overflow-hidden transition-all duration-300 relative z-30 shadow-sm ${
        isExpanded ? 'w-[220px] px-3' : 'w-[64px] px-2'
      }`}
    >
      {/* Header Section with Logo and Toggle */}
      <div className={`mb-6 flex flex-col transition-all duration-300 ${isExpanded ? 'items-start' : 'items-center'}`}>
        {isExpanded ? (
          <div className="w-full flex items-center justify-between px-1">
            {/* Logo Mark */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center justify-center rounded bg-blue-600 text-white w-8 h-8 shadow-sm shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
                  <rect x="4" y="14" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.5" />
                  <rect x="9" y="10" width="3" height="10" rx="0.5" fill="currentColor" opacity="0.7" />
                  <rect x="14" y="6" width="3" height="14" rx="0.5" fill="currentColor" opacity="0.9" />
                  <path d="M19 4L19 9M19 4L14 4M19 4L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Wordmark */}
              <div className="flex flex-col min-w-0 pr-1">
                <h2 className="text-sm font-bold tracking-tight leading-none text-slate-800 dark:text-white truncate" title={companyName}>
                  {companyName}
                </h2>
                <p className="text-[8px] font-medium text-gray-400 uppercase tracking-wider mt-0.5 truncate" title={companyTagline}>
                  {companyTagline}
                </p>
              </div>
            </div>

            {/* Toggle Button - Expanded */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSidebar();
              }}
              className="p-1.5 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft size={14} />
            </button>
          </div>
        ) : (
          /* Collapsed: Stacked layout */
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center justify-center rounded bg-blue-600 text-white w-9 h-9 shadow-sm">
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
                <rect x="4" y="14" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.5" />
                <rect x="9" y="10" width="3" height="10" rx="0.5" fill="currentColor" opacity="0.7" />
                <rect x="14" y="6" width="3" height="14" rx="0.5" fill="currentColor" opacity="0.9" />
                <path d="M19 4L19 9M19 4L14 4M19 4L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            {/* Toggle Button - Collapsed */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSidebar();
              }}
              className="p-1.5 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors"
              aria-label="Expand sidebar"
            >
              <Menu size={14} />
            </button>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden no-scrollbar">
        {filteredNavItems.map((group) => (
          <div key={group.groupKey}>
            {isExpanded ? (
              <h3 className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-2 mt-3">
                {t(group.groupKey, lang)}
              </h3>
            ) : (
              <div className="h-px bg-gray-200 dark:bg-gray-800 my-3 mx-1" />
            )}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const route = getRoute(item.id);
                const isActive = location.pathname === route || (route !== '/dashboard' && location.pathname.startsWith(route));

                return (
                  <li key={item.id}>
                    <Link
                      to={route}
                      onMouseEnter={() => prefetchRoute(route)}
                      onFocus={() => prefetchRoute(route)}
                      className={`w-full flex items-center transition-all duration-150 font-medium text-xs ${
                        isExpanded ? 'px-3 py-2 gap-2.5 rounded' : 'p-2.5 justify-center rounded'
                      } ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-l-2 border-blue-600 rounded-l-none'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className={`relative ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
                        {React.cloneElement(item.icon as React.ReactElement<any>, { size: 16 })}
                        {item.id === AppScreen.REQUEST_DEPOSIT && pendingDepsCount > 0 && !isExpanded && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white shadow-sm">
                            {pendingDepsCount > 9 ? '9+' : pendingDepsCount}
                          </span>
                        )}
                      </span>
                      {isExpanded && (
                        <span className="truncate flex-1 flex items-center justify-between">
                          {t(item.labelKey, lang)}
                          {item.id === AppScreen.REQUEST_DEPOSIT && pendingDepsCount > 0 && (
                            <span className="ml-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                              {pendingDepsCount}
                            </span>
                          )}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
