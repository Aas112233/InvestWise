import React, { useState, useRef, useCallback } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Mobile Touch Gestures & Interactions
 * Swipe, pull-to-refresh, and touch-friendly components
 */

// ==========================================
// PULL TO REFRESH COMPONENT
// ==========================================

interface PullToRefreshProps {
 onRefresh: () => Promise<void>;
 children: React.ReactNode;
 threshold?: number;
 className?: string;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
 onRefresh,
 children,
 threshold = 100,
 className = ''
}) => {
 const [pullDistance, setPullDistance] = useState(0);
 const [isRefreshing, setIsRefreshing] = useState(false);
 const startY = useRef(0);
 const currentY = useRef(0);
 const controls = useAnimation();

 const handleTouchStart = useCallback((e: React.TouchEvent) => {
 startY.current = e.touches[0].clientY;
 }, []);

 const handleTouchMove = useCallback((e: React.TouchEvent) => {
 if (isRefreshing) return;

 currentY.current = e.touches[0].clientY;
 const distance = Math.max(0, currentY.current - startY.current);

 // Only allow pull when scrolled to top
 if (window.scrollY <= 0) {
 setPullDistance(distance);
 }
 }, [isRefreshing]);

 const handleTouchEnd = useCallback(async () => {
 if (pullDistance > threshold && !isRefreshing) {
 setIsRefreshing(true);
 await controls.start({ y: threshold * 0.6, opacity: 1 });

 try {
 await onRefresh();
 } finally {
 await controls.start({ y: 0, opacity: 0 });
 setPullDistance(0);
 setIsRefreshing(false);
 }
 } else {
 setPullDistance(0);
 }
 }, [pullDistance, threshold, isRefreshing, onRefresh, controls]);

 const progress = Math.min(pullDistance / threshold, 1);
 const rotation = progress * 360;

 return (
 <div className={`relative overflow-hidden ${className}`}>
 {/* Pull Indicator */}
 <motion.div
 className="absolute top-0 left-0 right-0 flex items-center justify-center py-4 bg-gradient-to-b from-brand/10 to-transparent z-10"
 initial={{ y: -50, opacity: 0 }}
 animate={controls}
 style={{ y: pullDistance > 0 ? -50 + pullDistance * 0.5 : -50 }}
 >
 {isRefreshing ? (
 <RefreshCw size={24} className="text-brand animate-spin" />
 ) : (
 <motion.div
 animate={{ rotate: rotation }}
 transition={{ duration: 0.1 }}
 >
 <svg
 viewBox="0 0 24 24"
 className="w-6 h-6 text-brand"
 fill="none"
 stroke="currentColor"
 >
 <path
 d="M12 19V5M5 12l7-7 7 7"
 strokeWidth="2"
 strokeLinecap="round"
 strokeLinejoin="round"
 />
 </svg>
 </motion.div>
 )}
 </motion.div>

 {/* Content */}
 <motion.div
 onTouchStart={handleTouchStart}
 onTouchMove={handleTouchMove}
 onTouchEnd={handleTouchEnd}
 className="touch-none"
 >
 {children}
 </motion.div>
 </div>
 );
};

// ==========================================
// SWIPEABLE LIST ITEM
// ==========================================

interface SwipeAction {
 icon: React.ReactNode;
 label: string;
 color: string;
 onClick: () => void;
 width?: number;
}

interface SwipeableItemProps {
 children: React.ReactNode;
 leftActions?: SwipeAction[];
 rightActions?: SwipeAction[];
 onSwipeLeft?: () => void;
 onSwipeRight?: () => void;
 className?: string;
}

export const SwipeableItem: React.FC<SwipeableItemProps> = ({
 children,
 leftActions = [],
 rightActions = [],
 onSwipeLeft,
 onSwipeRight,
 className = ''
}) => {
 const [offsetX, setOffsetX] = useState(0);
 const startX = useRef(0);
 const controls = useAnimation();

 const maxOffset = 160; // Maximum swipe distance

 const handleTouchStart = useCallback((e: React.TouchEvent) => {
 startX.current = e.touches[0].clientX;
 }, []);

 const handleTouchMove = useCallback((e: React.TouchEvent) => {
 const currentX = e.touches[0].clientX;
 const delta = currentX - startX.current;

 // Constrain swipe
 if (Math.abs(delta) < maxOffset) {
 setOffsetX(delta);
 }
 }, []);

 const handleTouchEnd = useCallback(async () => {
 if (offsetX < -80) {
 // Swiped left
 await controls.start({ x: -maxOffset });
 setOffsetX(-maxOffset);
 onSwipeLeft?.();
 } else if (offsetX > 80) {
 // Swiped right
 await controls.start({ x: maxOffset });
 setOffsetX(maxOffset);
 onSwipeRight?.();
 } else {
 // Reset
 await controls.start({ x: 0 });
 setOffsetX(0);
 }
 }, [offsetX, controls, onSwipeLeft, onSwipeRight]);

 const resetPosition = useCallback(async () => {
 await controls.start({ x: 0 });
 setOffsetX(0);
 }, [controls]);

 return (
 <div className={`relative overflow-hidden ${className}`}>
 {/* Background Actions */}
 <div className="absolute inset-0 flex">
 {/* Left Actions */}
 <div className="flex items-center justify-start">
 {leftActions.map((action, index) => (
 <button
 key={index}
 onClick={() => {
 action.onClick();
 resetPosition();
 }}
 className="flex flex-col items-center justify-center text-white"
 style={{
 width: action.width || 80,
 height: '100%',
 backgroundColor: action.color
 }}
 >
 {action.icon}
 <span className="text-xs font-bold mt-1">{action.label}</span>
 </button>
 ))}
 </div>

 {/* Spacer */}
 <div className="flex-1" />

 {/* Right Actions */}
 <div className="flex items-center justify-end">
 {rightActions.map((action, index) => (
 <button
 key={index}
 onClick={() => {
 action.onClick();
 resetPosition();
 }}
 className="flex flex-col items-center justify-center text-white"
 style={{
 width: action.width || 80,
 height: '100%',
 backgroundColor: action.color
 }}
 >
 {action.icon}
 <span className="text-xs font-bold mt-1">{action.label}</span>
 </button>
 ))}
 </div>
 </div>

 {/* Foreground Content */}
 <motion.div
 onTouchStart={handleTouchStart}
 onTouchMove={handleTouchMove}
 onTouchEnd={handleTouchEnd}
 animate={controls}
 className="relative z-10 bg-white dark:bg-[#1A221D] touch-none"
 >
 {children}
 </motion.div>
 </div>
 );
};

// ==========================================
// SWIPEABLE CARD (High-Level Component)
// ==========================================

interface SwipeableCardProps {
 children: React.ReactNode;
 onDelete?: () => void;
 onEdit?: () => void;
 onArchive?: () => void;
 className?: string;
}

export const SwipeableCard: React.FC<SwipeableCardProps> = ({
 children,
 onDelete,
 onEdit,
 onArchive,
 className = ''
}) => {
 const rightActions: SwipeAction[] = [];

 if (onEdit) {
 rightActions.push({
 icon: <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
 label: 'Edit',
 color: '#3B82F6',
 onClick: onEdit,
 width: 80
 });
 }

 if (onDelete) {
 rightActions.push({
 icon: <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>,
 label: 'Delete',
 color: '#EF4444',
 onClick: onDelete,
 width: 80
 });
 }

 return (
 <SwipeableItem
 rightActions={rightActions}
 className={className}
 >
 {children}
 </SwipeableItem>
 );
};

// ==========================================
// MOBILE NAVIGATION BOTTOM BAR
// ==========================================

interface MobileNavItem {
 icon: React.ReactNode;
 label: string;
 path: string;
 badge?: number;
}

interface MobileNavBarProps {
 items: MobileNavItem[];
 currentPath: string;
 onNavigate: (path: string) => void;
 className?: string;
}

export const MobileNavBar: React.FC<MobileNavBarProps> = ({
 items,
 currentPath,
 onNavigate,
 className = ''
}) => {
 return (
 <nav
 className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1A221D] border-t border-gray-200 dark:border-white/5 z-50 md:hidden ${className}`}
 role="navigation"
 aria-label="Mobile navigation"
 >
 <div className="flex items-center justify-around h-16">
 {items.map((item) => {
 const isActive = currentPath === item.path || currentPath.startsWith(item.path + '/');

 return (
 <button
 key={item.path}
 onClick={() => onNavigate(item.path)}
 className={`flex flex-col items-center justify-center w-full h-full relative transition-colors ${
 isActive
 ? 'text-brand'
 : 'text-gray-400 dark:text-gray-500'
 }`}
 aria-label={item.label}
 aria-current={isActive ? 'page' : undefined}
 >
 {/* Badge */}
 {item.badge && item.badge > 0 && (
 <span className="absolute top-2 right-1/4 w-4 h-4 bg-rose-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
 {item.badge > 99 ? '99+' : item.badge}
 </span>
 )}

 {/* Icon */}
 <div className={`w-6 h-6 mb-1 ${isActive ? 'scale-110' : ''} transition-transform`}>
 {item.icon}
 </div>

 {/* Label */}
 <span className="text-[10px] font-bold">{item.label}</span>

 {/* Active Indicator */}
 {isActive && (
 <motion.div
 layoutId="mobile-nav-indicator"
 className="absolute top-0 left-0 right-0 h-0.5 bg-brand"
 transition={{ type: 'spring', stiffness: 300, damping: 30 }}
 />
 )}
 </button>
 );
 })}
 </div>
 </nav>
 );
};

// ==========================================
// TOUCH-FRIENDLY BUTTON
// ==========================================

// Omit event handlers that conflict with framer-motion's overloaded types
type SafeButtonProps = Omit<
 React.ButtonHTMLAttributes<HTMLButtonElement>,
 'onDrag' | 'onDragEnd' | 'onDragStart' | 'onAnimationStart'
>;

interface TouchButtonProps extends SafeButtonProps {
 variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
 size?: 'sm' | 'md' | 'lg';
 fullWidth?: boolean;
 loading?: boolean;
 children: React.ReactNode;
}

export const TouchButton: React.FC<TouchButtonProps> = ({
 variant = 'primary',
 size = 'md',
 fullWidth = false,
 loading = false,
 children,
 disabled,
 className = '',
 ...props
}) => {
 const getVariantStyles = () => {
 switch (variant) {
 case 'primary':
 return 'bg-brand text-dark hover:shadow-lg active:scale-95';
 case 'secondary':
 return 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 active:scale-95';
 case 'danger':
 return 'bg-rose-500 text-white hover:bg-rose-600 active:scale-95';
 case 'ghost':
 return 'bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 active:scale-95';
 default:
 return '';
 }
 };

 const getSizeStyles = () => {
 switch (size) {
 case 'sm':
 return 'min-h-[44px] px-4 text-xs'; // Apple HIG minimum
 case 'md':
 return 'min-h-[48px] px-6 text-sm';
 case 'lg':
 return 'min-h-[56px] px-8 text-base';
 default:
 return '';
 }
 };

 return (
 <motion.button
 whileTap={{ scale: disabled || loading ? 1 : 0.98 }}
 className={`
 ${getVariantStyles()}
 ${getSizeStyles()}
 ${fullWidth ? 'w-full' : ''}
 ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''}
 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all
 ${className}
 `}
 disabled={disabled || loading}
 {...(props as any)}
 >
 {loading && (
 <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
 </svg>
 )}
 {children}
 </motion.button>
 );
};

// ==========================================
// EXPORT ALL
// ==========================================

export default {
 PullToRefresh,
 SwipeableItem,
 SwipeableCard,
 MobileNavBar,
 TouchButton
};
