
import React, { useState, useMemo } from 'react';
import { Menu, ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { NAVIGATION_ITEMS } from '../constants';
import { AppScreen, AccessLevel, User } from '../types';
import { Language, t } from '../i18n/translations';

interface SidebarProps {
  lang: Language;
  currentUser?: User | null; // Pass currentUser for permission check
}

import { useGlobalState } from '../context/GlobalStateContext';

const Sidebar: React.FC<SidebarProps> = ({ lang, currentUser }) => {
  const { deposits } = useGlobalState();
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const isExpanded = isPinned || isHovered;

  // Helper to map AppScreen to Routes
  const getRoute = (screen: AppScreen): string => {
    switch (screen) {
      case AppScreen.DASHBOARD: return '/dashboard';
      case AppScreen.MEMBERS: return '/members';
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

        // Defensive check for permissions object
        if (!currentUser.permissions) return false;

        const permission = currentUser.permissions[item.id];
        return permission && permission !== AccessLevel.NONE;
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
      className={`bg-white/80 dark:bg-[#1A221D]/90 backdrop-blur-xl h-screen border-r border-gray-200/50 dark:border-white/5 flex flex-col py-8 shrink-0 overflow-hidden transition-all duration-500 ease-in-out relative z-30 shadow-[10px_0_30px_rgba(0,0,0,0.02)] ${isExpanded ? 'w-[280px] px-6' : 'w-[88px] px-3'
        }`}
    >
      {/* Header Section with Logo and Toggle */}
      <div className={`mb-8 flex flex-col transition-all duration-500 ${isExpanded ? 'items-start' : 'items-center'}`}>

        {/* Expanded: Logo + Toggle in row */}
        {isExpanded ? (
          <div className="w-full flex items-center justify-between">
            {/* Logo Container */}
            <div className="relative">
              {/* Glow effect behind logo */}
              <div className="absolute inset-0 bg-gradient-to-r from-brand/30 via-emerald-400/20 to-brand/30 blur-xl opacity-70 rounded-full scale-150" />

              {/* Logo Mark */}
              <div className="relative flex items-center gap-3">
                {/* Premium SVG Icon */}
                <div className="relative flex items-center justify-center rounded-2xl bg-gradient-to-br from-[#151D18] via-[#1E2A22] to-[#151D18] dark:from-[#BFF300] dark:via-[#D4FF33] dark:to-[#BFF300] shadow-xl w-11 h-11 overflow-hidden">
                  <div className="absolute inset-[2px] rounded-xl bg-gradient-to-br from-white/10 to-transparent dark:from-black/10" />
                  {/* Custom Investment Growth Icon */}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="relative w-6 h-6"
                  >
                    {/* Rising bars representing growth */}
                    <rect x="4" y="14" width="3" height="6" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.5" />
                    <rect x="9" y="10" width="3" height="10" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.7" />
                    <rect x="14" y="6" width="3" height="14" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.9" />
                    {/* Upward arrow/trend line */}
                    <path
                      d="M19 4L19 9M19 4L14 4M19 4L10 13"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="stroke-brand dark:stroke-[#151D18]"
                    />
                  </svg>
                </div>

                {/* Wordmark */}
                <div className="flex flex-col animate-in fade-in slide-in-from-left-4 duration-500">
                  <h2 className="text-[20px] font-black tracking-tight leading-none flex items-baseline">
                    <span className="bg-gradient-to-r from-[#151D18] via-[#2A3830] to-[#151D18] dark:from-white dark:via-gray-200 dark:to-white bg-clip-text text-transparent">
                      Invest
                    </span>
                    <span className="bg-gradient-to-r from-brand via-emerald-400 to-brand bg-clip-text text-transparent">
                      Wise
                    </span>
                    <span className="text-brand ml-0.5 animate-pulse">.</span>
                  </h2>
                  <p className="text-[8px] font-bold text-gray-400/80 dark:text-gray-500 uppercase tracking-[0.2em] mt-0.5">
                    Enterprise IMS
                  </p>
                </div>
              </div>
            </div>

            {/* Toggle Button - Expanded */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSidebar();
              }}
              className="p-2.5 rounded-xl bg-gray-100/80 dark:bg-white/5 text-gray-500 hover:text-dark dark:hover:text-brand transition-all shadow-sm border border-gray-200/50 dark:border-white/5 hover:bg-gray-200/80 dark:hover:bg-white/10"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        ) : (
          /* Collapsed: Stacked layout */
          <div className="flex flex-col items-center gap-4">
            {/* Logo Container */}
            <div className="relative">
              {/* Glow effect behind logo */}
              <div className="absolute inset-0 bg-gradient-to-r from-brand/30 via-emerald-400/20 to-brand/30 blur-xl opacity-70 rounded-full scale-150" />

              {/* Premium SVG Icon */}
              <div className="relative flex items-center justify-center rounded-2xl bg-gradient-to-br from-[#151D18] via-[#1E2A22] to-[#151D18] dark:from-[#BFF300] dark:via-[#D4FF33] dark:to-[#BFF300] shadow-xl w-12 h-12 overflow-hidden">
                <div className="absolute inset-[2px] rounded-xl bg-gradient-to-br from-white/10 to-transparent dark:from-black/10" />
                {/* Custom Investment Growth Icon */}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="relative w-7 h-7"
                >
                  {/* Rising bars representing growth */}
                  <rect x="4" y="14" width="3" height="6" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.5" />
                  <rect x="9" y="10" width="3" height="10" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.7" />
                  <rect x="14" y="6" width="3" height="14" rx="1" className="fill-brand dark:fill-[#151D18]" opacity="0.9" />
                  {/* Upward arrow/trend line */}
                  <path
                    d="M19 4L19 9M19 4L14 4M19 4L10 13"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="stroke-brand dark:stroke-[#151D18]"
                  />
                </svg>
              </div>
            </div>

            {/* Toggle Button - Collapsed */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleSidebar();
              }}
              className="p-2.5 rounded-xl bg-gray-100/80 dark:bg-white/5 text-gray-500 hover:text-dark dark:hover:text-brand transition-all shadow-sm border border-gray-200/50 dark:border-white/5 hover:bg-gray-200/80 dark:hover:bg-white/10"
            >
              <Menu size={18} />
            </button>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-10 overflow-y-auto overflow-x-hidden no-scrollbar">
        {filteredNavItems.map((group) => (
          <div key={group.groupKey}>
            {isExpanded ? (
              <h3 className="text-[10px] font-black text-gray-400 dark:text-gray-600 uppercase tracking-[0.2em] mb-4 px-2">
                {t(group.groupKey, lang)}
              </h3>
            ) : (
              <div className="h-px bg-gray-100 dark:bg-white/5 mb-6 mx-2" />
            )}
            <ul className="space-y-2">
              {group.items.map((item) => {
                const route = getRoute(item.id);
                // Check if current path starts with the route (simple active check)
                // For exact match on dashboard avoid highlighting it on sub-routes if needed, but current app is flat.
                const isActive = location.pathname === route || (route !== '/dashboard' && location.pathname.startsWith(route));

                return (
                  <li key={item.id}>
                    <Link
                      to={route}
                      className={`w-full flex items-center transition-all duration-300 font-bold text-sm group/btn ${isExpanded ? 'px-4 py-3 gap-3 rounded-2xl' : 'p-4 justify-center rounded-2xl'
                        } ${isActive
                          ? 'bg-[#151D18] dark:bg-[#BFF300] text-white dark:text-black shadow-xl shadow-black/10'
                          : 'text-[#64748B] dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'
                        }`}
                    >
                      <span className={`relative ${isActive ? (document.documentElement.classList.contains('dark') ? 'text-black' : 'text-[#BFF300]') : 'text-[#94A3B8] dark:text-gray-700'}`}>
                        {item.icon}
                        {item.id === AppScreen.REQUEST_DEPOSIT && pendingDepsCount > 0 && !isExpanded && (
                          <span className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shrink-0 shadow-sm border border-white dark:border-dark">
                            {pendingDepsCount > 9 ? '9+' : pendingDepsCount}
                          </span>
                        )}
                      </span>
                      {isExpanded && (
                        <span className="truncate flex-1 flex items-center justify-between">
                          {t(item.labelKey, lang)}
                          {item.id === AppScreen.REQUEST_DEPOSIT && pendingDepsCount > 0 && (
                            <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
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
