
import React from 'react';
import { Search, Moon, Sun, Bell, LogOut, Command, Wifi, WifiOff } from 'lucide-react';
import { User } from '../types';
import { Language, t } from '../i18n/translations';
import { useBackendStatus } from '../hooks/useBackendStatus';
import Avatar from './Avatar';
import { useGlobalState } from '../context/GlobalStateContext';
import { useNavigate } from 'react-router-dom';

const timeAgo = (date: Date) => {
 const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
 let interval = seconds / 31536000;
 if (interval > 1) return Math.floor(interval) + " years ago";
 interval = seconds / 2592000;
 if (interval > 1) return Math.floor(interval) + " months ago";
 interval = seconds / 86400;
 if (interval > 1) return Math.floor(interval) + " days ago";
 interval = seconds / 3600;
 if (interval > 1) return Math.floor(interval) + " hours ago";
 interval = seconds / 60;
 if (interval > 1) return Math.floor(interval) + " minutes ago";
 return Math.floor(seconds) + " seconds ago";
};

interface HeaderProps {
 user: User;
 onLogout: () => void;
 isDarkMode: boolean;
 toggleTheme: () => void;
 lang: Language;
 setLang: (lang: Language) => void;
}

const Header: React.FC<HeaderProps> = ({ user, onLogout, isDarkMode, toggleTheme, lang, setLang }) => {
 const { isConnected, isChecking } = useBackendStatus();
 const { notifications, refreshNotifications } = useGlobalState();
 const [showNotifications, setShowNotifications] = React.useState(false);
 const navigate = useNavigate();

 const handleNotificationClick = (n: any) => {
 setShowNotifications(false);
 let path = '/dashboard';

 // Simple routing logic based on resource type or description details
 if (n.resourceType === 'Project' || n.action.includes('PROJECT')) path = '/projects';
 else if (n.resourceType === 'Deposit' || n.action.includes('DEPOSIT')) path = '/deposits';
 else if (n.resourceType === 'Member' || n.action.includes('MEMBER')) path = '/members';
 else if (n.resourceType === 'Fund' || n.action.includes('FUND')) path = '/funds';
 else if (n.resourceType === 'Transaction' || n.action.includes('EXPENSE')) path = '/expenses';
 else if (n.resourceType === 'User' || n.action.includes('USER')) path = '/settings';

 navigate(path);
 };

  return (
    <header className="h-12 bg-white dark:bg-slate-900 flex items-center justify-between px-6 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-40 lg:static shadow-sm">
      <div className="flex-1 max-w-xl">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input
            type="search"
            name="app-search"
            autoComplete="off"
            placeholder={t('common.search', lang)}
            className="w-full bg-gray-50 dark:bg-slate-800 pl-10 pr-12 py-1.5 rounded border border-gray-300 dark:border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-xs dark:text-white dark:placeholder-gray-400"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-[9px] text-gray-500 dark:text-gray-400 font-mono">
            <Command size={9} />
            <span>F</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 ml-6">
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 dark:bg-slate-800 rounded border border-gray-200 dark:border-gray-700">
          {isChecking ? (
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse"></div>
          ) : isConnected ? (
            <Wifi size={14} className="text-green-500" />
          ) : (
            <WifiOff size={14} className="text-red-500" />
          )}
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
            {isChecking ? 'Checking...' : isConnected ? 'Connected' : 'Offline'}
          </span>
        </div>

        <div className="flex items-center bg-gray-50 dark:bg-slate-800 p-0.5 rounded border border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setLang('en')}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-all ${lang === 'en' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
          >
            EN
          </button>
          <button
            onClick={() => setLang('bn')}
            className={`px-2 py-1 text-[10px] font-medium rounded transition-all ${lang === 'bn' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
          >
            BN
          </button>
        </div>

        <button
          onClick={toggleTheme}
          className="p-1.5 bg-gray-50 dark:bg-slate-800 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-blue-600 transition-colors"
          aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="relative">
          <button
            onClick={() => {
              setShowNotifications(!showNotifications);
              if (!showNotifications && user.role === 'Admin') refreshNotifications();
            }}
            className="p-1.5 bg-gray-50 dark:bg-slate-800 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-blue-600 transition-colors relative"
            aria-label="Toggle notifications"
          >
            <Bell size={16} />
            {notifications?.count > 0 && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full"></span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-900 rounded shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden z-50">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-slate-800">
                <h3 className="font-semibold text-xs dark:text-white">Recent Activity</h3>
                <span className="text-[9px] font-semibold px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">{notifications.count} Updates</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {notifications.items.length === 0 ? (
                  <div className="p-6 text-center text-gray-400">
                    <p className="text-xs">No recent updates</p>
                  </div>
                ) : (
                  notifications.items.map((n: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => handleNotificationClick(n)}
                      className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-slate-850 border-b border-gray-100 dark:border-gray-800 transition-all group"
                    >
                      <div className="flex justify-between items-start mb-0.5">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 group-hover:text-blue-600 transition-colors">
                          {n.action.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[9px] text-gray-400 font-mono">
                          {timeAgo(new Date(n.createdAt))}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-800 dark:text-slate-200 line-clamp-2">
                        {n.details?.description || n.details?.message || n.resourceType + ' Update'}
                      </p>
                      {n.userName && (
                        <p className="text-[9px] text-gray-400 mt-0.5">by {n.userName}</p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pl-4 border-l border-gray-200 dark:border-gray-800">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{user.name}</p>
            <p className="text-[9px] font-medium text-gray-400 uppercase tracking-wider">{user.role}</p>
          </div>
          <Avatar name={user.name} size="sm" />
          <button
            onClick={onLogout}
            className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
            title="Terminate Session"
            aria-label="Log out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
