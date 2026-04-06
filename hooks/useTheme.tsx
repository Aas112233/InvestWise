import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Dark Mode Management System
 * System preference detection, persistence, and smooth transitions
 */

export type ThemeMode = 'light' | 'dark' | 'system';

interface UseThemeOptions {
 defaultMode?: ThemeMode;
 storageKey?: string;
 enableTransition?: boolean;
 onThemeChange?: (theme: ThemeMode) => void;
}

interface UseThemeReturn {
 theme: ThemeMode;
 isDark: boolean;
 toggleTheme: () => void;
 setTheme: (theme: ThemeMode) => void;
 systemTheme: 'light' | 'dark';
}

/**
 * useTheme Hook
 * Manages dark mode with system preference detection
 */
export const useTheme = (options: UseThemeOptions = {}): UseThemeReturn => {
 const {
 defaultMode = 'system',
 storageKey = 'investwise-theme',
 enableTransition = true,
 onThemeChange
 } = options;

 // Get system preference
 const getSystemTheme = useCallback((): 'light' | 'dark' => {
 if (typeof window === 'undefined') return 'light';

 const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
 return prefersDark ? 'dark' : 'light';
 }, []);

 // Load theme from storage or default
 const [theme, setThemeState] = useState<ThemeMode>(() => {
 if (typeof window === 'undefined') return defaultMode;

 const stored = localStorage.getItem(storageKey) as ThemeMode | null;
 return stored || defaultMode;
 });

 // Calculate actual dark/light mode
 const isDark = useMemo(() => {
 if (theme === 'system') {
 return getSystemTheme() === 'dark';
 }
 return theme === 'dark';
 }, [theme, getSystemTheme]);

 // Apply theme to DOM
 useEffect(() => {
 if (typeof window === 'undefined') return;

 const root = document.documentElement;

 if (enableTransition) {
 root.style.transition = 'background-color 0.3s ease, color 0.3s ease';
 }

 if (isDark) {
 root.classList.add('dark');
 } else {
 root.classList.remove('dark');
 }

 // Update meta theme color
 const metaThemeColor = document.querySelector('meta[name="theme-color"]');
 if (metaThemeColor) {
 metaThemeColor.setAttribute('content', isDark ? '#111814' : '#BFF300');
 }

 // Store preference
 localStorage.setItem(storageKey, theme);

 // Notify change
 onThemeChange?.(theme);
 }, [isDark, theme, storageKey, enableTransition, onThemeChange]);

 // Listen for system theme changes
 useEffect(() => {
 if (typeof window === 'undefined' || theme !== 'system') return;

 const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

 const handleChange = () => {
 // Force re-render when system theme changes
 setThemeState('system');
 };

 mediaQuery.addEventListener('change', handleChange);

 return () => mediaQuery.removeEventListener('change', handleChange);
 }, [theme]);

 // Toggle theme
 const toggleTheme = useCallback(() => {
 setThemeState((prev) => {
 if (prev === 'system') {
 return isDark ? 'light' : 'dark';
 }
 return prev === 'dark' ? 'light' : 'dark';
 });
 }, [isDark]);

 // Set specific theme
 const setTheme = useCallback((newTheme: ThemeMode) => {
 setThemeState(newTheme);
 }, []);

 return {
 theme,
 isDark,
 toggleTheme,
 setTheme,
 systemTheme: getSystemTheme()
 };
};

import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { motion } from 'framer-motion';

interface ThemeToggleProps {
 theme: ThemeMode;
 onToggle: () => void;
 onChange?: (theme: ThemeMode) => void;
 variant?: 'button' | 'menu' | 'switch';
 className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
 theme,
 onToggle,
 onChange,
 variant = 'button',
 className = ''
}) => {
 if (variant === 'button') {
 return (
 <motion.button
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 onClick={onToggle}
 className={`p-3 rounded-xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors ${className}`}
 aria-label="Toggle theme"
 >
 <motion.div
 initial={false}
 animate={{ rotate: theme === 'dark' ? 180 : 0 }}
 transition={{ duration: 0.3 }}
 >
 {theme === 'dark' ? (
 <Sun size={20} className="text-brand" />
 ) : (
 <Moon size={20} className="text-gray-600" />
 )}
 </motion.div>
 </motion.button>
 );
 }

 if (variant === 'menu') {
 return (
 <div className={`flex items-center gap-2 ${className}`}>
 {[
 { mode: 'light' as const, icon: Sun, label: 'Light' },
 { mode: 'dark' as const, icon: Moon, label: 'Dark' },
 { mode: 'system' as const, icon: Monitor, label: 'System' }
 ].map(({ mode, icon: Icon, label }) => (
 <button
 key={mode}
 onClick={() => onChange?.(mode)}
 className={`p-2 rounded-lg transition-colors ${theme === mode
 ? 'bg-brand text-dark'
 : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
 }`}
 aria-label={`Set theme to ${label}`}
 title={label}
 >
 <Icon size={18} />
 </button>
 ))}
 </div>
 );
 }

 return null;
};

/**
 * System Preference Indicator
 */
export const SystemPreferenceIndicator: React.FC = () => {
 const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');

 useEffect(() => {
 const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
 setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

 const handleChange = (e: MediaQueryListEvent) => {
 setSystemTheme(e.matches ? 'dark' : 'light');
 };

 mediaQuery.addEventListener('change', handleChange);
 return () => mediaQuery.removeEventListener('change', handleChange);
 }, []);

 return (
 <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
 <Monitor size={12} />
 <span>System: {systemTheme === 'dark' ? 'Dark' : 'Light'}</span>
 </div>
 );
};

export default useTheme;
