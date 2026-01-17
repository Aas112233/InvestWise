
import React, { useState, useMemo } from 'react';
import { Menu, ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { NAVIGATION_ITEMS } from '../constants';
import { AppScreen, AccessLevel, User } from '../types';
import { Language, t } from '../i18n/translations';

interface SidebarProps {
  lang: Language;
  currentUser?: User | null; // Pass currentUser for permission check
}

const Sidebar: React.FC<SidebarProps> = ({ lang, currentUser }) => {
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

  const toggleSidebar = () => setIsPinned(!isPinned);

  return (
    <aside
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`bg-white dark:bg-[#1A221D] h-screen border-r border-gray-100 dark:border-white/5 flex flex-col py-8 shrink-0 overflow-hidden transition-all duration-500 ease-in-out relative z-30 shadow-[10px_0_30px_rgba(0,0,0,0.02)] ${isExpanded ? 'w-[280px] px-6' : 'w-[88px] px-3'
        }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleSidebar();
        }}
        className={`absolute top-8 p-3 rounded-2xl bg-gray-50 dark:bg-white/5 text-gray-500 hover:text-dark dark:hover:text-brand transition-all z-40 shadow-sm border border-gray-100 dark:border-white/5 ${isExpanded ? 'right-6' : 'right-1/2 translate-x-1/2'
          }`}
      >
        {isPinned ? <ChevronLeft size={20} /> : <Menu size={20} />}
      </button>

      <div className={`mb-16 flex flex-col transition-all duration-500 ${isExpanded ? 'px-2 items-start' : 'items-center px-0'}`}>
        <h2 className="text-2xl font-black tracking-tighter flex items-center gap-1 dark:text-white">
          <span className="text-dark dark:text-white">I</span>
          {isExpanded && (
            <span className="animate-in fade-in slide-in-from-left-2 duration-500">
              nvestWise<span className="text-brand">.</span>
            </span>
          )}
          {!isExpanded && <span className="text-brand">.</span>}
        </h2>
        {isExpanded && (
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Enterprise IMS</p>
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
                    <button
                      onClick={() => navigate(route)}
                      className={`w-full flex items-center transition-all duration-300 font-bold text-sm group/btn ${isExpanded ? 'px-4 py-3 gap-3 rounded-2xl' : 'p-4 justify-center rounded-2xl'
                        } ${isActive
                          ? 'bg-[#151D18] dark:bg-[#BFF300] text-white dark:text-black shadow-xl shadow-black/10'
                          : 'text-[#64748B] dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'
                        }`}
                    >
                      <span className={`${isActive ? (document.documentElement.classList.contains('dark') ? 'text-black' : 'text-[#BFF300]') : 'text-[#94A3B8] dark:text-gray-700'}`}>
                        {item.icon}
                      </span>
                      {isExpanded && (
                        <span className="truncate">
                          {t(item.labelKey, lang)}
                        </span>
                      )}
                    </button>
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
