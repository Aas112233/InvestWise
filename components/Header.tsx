
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
    <header className="h-[90px] bg-white/80 dark:bg-[#1A221D]/80 backdrop-blur-xl flex items-center justify-between px-10 border-b border-gray-200/50 dark:border-white/5 transition-colors duration-300 sticky top-0 z-40 lg:static">
      <div className="flex-1 max-w-2xl">
        <div className="relative group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-black dark:group-focus-within:text-white transition-colors" size={18} />
          <input
            type="search"
            name="app-search"
            autoComplete="off"
            placeholder={t('common.search', lang)}
            className="w-full bg-white dark:bg-[#1A221D] pl-14 pr-16 py-3.5 rounded-2xl border-none ring-1 ring-gray-100 dark:ring-white/5 focus:ring-2 focus:ring-[#151D18] dark:focus:ring-[#BFF300] outline-none text-sm transition-all card-shadow dark:text-white dark:placeholder-gray-500"
          />
          <div className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-gray-50 dark:bg-white/5 px-2 py-1 rounded-md border border-gray-100 dark:border-white/5 text-[10px] font-bold text-gray-400">
            <Command size={10} />
            <span>F</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6 ml-10">
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#1A221D] rounded-xl ring-1 ring-gray-100 dark:ring-white/5">
          {isChecking ? (
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
          ) : isConnected ? (
            <Wifi size={16} className="text-green-500" />
          ) : (
            <WifiOff size={16} className="text-red-500" />
          )}
          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">
            {isChecking ? 'Checking...' : isConnected ? 'Connected' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center bg-white dark:bg-[#1A221D] p-1 rounded-xl ring-1 ring-gray-100 dark:ring-white/5">
          <button
            onClick={() => setLang('en')}
            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${lang === 'en' ? 'bg-[#151D18] dark:bg-[#BFF300] text-white dark:text-black' : 'text-gray-400'}`}
          >
            EN
          </button>
          <button
            onClick={() => setLang('bn')}
            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${lang === 'bn' ? 'bg-[#151D18] dark:bg-[#BFF300] text-white dark:text-black' : 'text-gray-400'}`}
          >
            BN
          </button>
        </div>

        <button
          onClick={toggleTheme}
          className="p-3 bg-white dark:bg-[#1A221D] rounded-xl ring-1 ring-gray-100 dark:ring-white/5 text-gray-500 hover:text-black dark:hover:text-[#BFF300] transition-colors"
        >
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        <div className="relative">
          <button
            onClick={() => {
              setShowNotifications(!showNotifications);
              if (!showNotifications && user.role === 'Admin') refreshNotifications();
            }}
            className="p-3 bg-white dark:bg-[#1A221D] rounded-xl ring-1 ring-gray-100 dark:ring-white/5 text-gray-500 hover:text-black dark:hover:text-white transition-colors relative"
          >
            <Bell size={20} />
            {notifications?.count > 0 && (
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-[#1A221D]"></span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-4 w-80 bg-white dark:bg-[#1A221D] rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 overflow-hidden animate-in slide-in-from-top-2 z-50">
              <div className="p-4 border-b border-gray-100 dark:border-white/5 flex justify-between items-center bg-gray-50/50 dark:bg-white/5">
                <h3 className="font-bold text-sm dark:text-white">Recent Activity</h3>
                <span className="text-[10px] font-bold px-2 py-1 bg-brand/10 text-brand rounded-md uppercase tracking-wider">{notifications.count} Updates</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                {notifications.items.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">
                    <p className="text-xs">No recent updates</p>
                  </div>
                ) : (
                  notifications.items.map((n: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => handleNotificationClick(n)}
                      className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-50 dark:border-white/5 transition-all group"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 group-hover:text-brand transition-colors">
                          {n.action.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {timeAgo(new Date(n.createdAt))}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-dark dark:text-white line-clamp-2">
                        {n.details?.description || n.details?.message || n.resourceType + ' Update'}
                      </p>
                      {n.userName && (
                        <p className="text-[10px] text-gray-400 mt-1">by {n.userName}</p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pl-6 border-l border-gray-200 dark:border-white/10">
          <div className="text-right">
            <p className="text-sm font-black text-[#151D18] dark:text-white">{user.name}</p>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{user.role}</p>
          </div>
          <Avatar name={user.name} size="md" />
          <button
            onClick={onLogout}
            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
            title="Terminate Session"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
