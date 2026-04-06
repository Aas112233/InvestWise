import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Enhanced Toast Notification System
 * Queue management, multiple types, auto-dismiss, and premium UI
 */

// ==========================================
// TYPES
// ==========================================

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface Toast {
 id: string;
 type: ToastType;
 message: string;
 description?: string;
 duration?: number;
 action?: {
 label: string;
 onClick: () => void;
 };
 sticky?: boolean;
}

interface ToastContextType {
 showToast: (toast: Omit<Toast, 'id'>) => string;
 success: (message: string, options?: Partial<Toast>) => string;
 error: (message: string, options?: Partial<Toast>) => string;
 warning: (message: string, options?: Partial<Toast>) => string;
 info: (message: string, options?: Partial<Toast>) => string;
 loading: (message: string, options?: Partial<Toast>) => string;
 removeToast: (id: string) => void;
 clearAll: () => void;
}

// ==========================================
// CONTEXT
// ==========================================

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
 const context = useContext(ToastContext);
 if (!context) {
 throw new Error('useToast must be used within ToastProvider');
 }
 return context;
};

// ==========================================
// PROVIDER
// ==========================================

interface ToastProviderProps {
 children: React.ReactNode;
 maxToasts?: number;
 position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
}

export const ToastProvider: React.FC<ToastProviderProps> = ({
 children,
 maxToasts = 3,
 position = 'top-right'
}) => {
 const [toasts, setToasts] = useState<Toast[]>([]);

 const generateId = () => `toast-${Date.now()}-${Math.random()}`;

 const removeToast = useCallback((id: string) => {
 setToasts(prev => prev.filter(t => t.id !== id));
 }, []);

 const clearAll = useCallback(() => {
 setToasts([]);
 }, []);

 const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
 const id = generateId();
 const newToast: Toast = {
 ...toast,
 id,
 duration: toast.duration ?? (toast.sticky ? 0 : 5000)
 };

 setToasts(prev => {
 // Remove oldest toast if at max
 if (prev.length >= maxToasts) {
 return [...prev.slice(prev.length - maxToasts + 1), newToast];
 }
 return [...prev, newToast];
 });

 return id;
 }, [maxToasts]);

 const success = useCallback((message: string, options?: Partial<Toast>) => {
 return showToast({ type: 'success', message, ...options });
 }, [showToast]);

 const error = useCallback((message: string, options?: Partial<Toast>) => {
 return showToast({ type: 'error', message, ...options, duration: options?.duration ?? 8000 });
 }, [showToast]);

 const warning = useCallback((message: string, options?: Partial<Toast>) => {
 return showToast({ type: 'warning', message, ...options });
 }, [showToast]);

 const info = useCallback((message: string, options?: Partial<Toast>) => {
 return showToast({ type: 'info', message, ...options });
 }, [showToast]);

 const loading = useCallback((message: string, options?: Partial<Toast>) => {
 return showToast({ type: 'loading', message, ...options, sticky: true });
 }, [showToast]);

 return (
 <ToastContext.Provider
 value={{
 showToast,
 success,
 error,
 warning,
 info,
 loading,
 removeToast,
 clearAll
 }}
 >
 {children}
 <ToastContainer toasts={toasts} removeToast={removeToast} position={position} />
 </ToastContext.Provider>
 );
};

// ==========================================
// TOAST CONTAINER
// ==========================================

interface ToastContainerProps {
 toasts: Toast[];
 removeToast: (id: string) => void;
 position: string;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, removeToast, position }) => {
 const getPositionClasses = () => {
 switch (position) {
 case 'top-right': return 'fixed top-6 right-6 z-[9999]';
 case 'top-left': return 'fixed top-6 left-6 z-[9999]';
 case 'bottom-right': return 'fixed bottom-6 right-6 z-[9999]';
 case 'bottom-left': return 'fixed bottom-6 left-6 z-[9999]';
 case 'top-center': return 'fixed top-6 left-1/2 -translate-x-1/2 z-[9999]';
 case 'bottom-center': return 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]';
 default: return 'fixed top-6 right-6 z-[9999]';
 }
 };

 return (
 <div className={`${getPositionClasses()} flex flex-col gap-3 max-w-md`}>
 <AnimatePresence>
 {toasts.map((toast) => (
 <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
 ))}
 </AnimatePresence>
 </div>
 );
};

// ==========================================
// TOAST ITEM
// ==========================================

interface ToastItemProps {
 toast: Toast;
 onRemove: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onRemove }) => {
 const [progress, setProgress] = useState(100);

 useEffect(() => {
 if (toast.duration === 0 || toast.sticky) return;

 const startTime = Date.now();
 const interval = setInterval(() => {
 const elapsed = Date.now() - startTime;
 const remaining = 100 - (elapsed / toast.duration!) * 100;

 if (remaining <= 0) {
 clearInterval(interval);
 onRemove(toast.id);
 } else {
 setProgress(remaining);
 }
 }, 50);

 return () => clearInterval(interval);
 }, [toast.duration, toast.sticky, toast.id, onRemove]);

 const getToastConfig = () => {
 switch (toast.type) {
 case 'success':
 return {
 icon: <CheckCircle size={20} />,
 bg: 'bg-emerald-50 dark:bg-emerald-500/10',
 border: 'border-emerald-200 dark:border-emerald-500/20',
 iconColor: 'text-emerald-500',
 textColor: 'text-emerald-800 dark:text-emerald-400'
 };
 case 'error':
 return {
 icon: <AlertCircle size={20} />,
 bg: 'bg-rose-50 dark:bg-rose-500/10',
 border: 'border-rose-200 dark:border-rose-500/20',
 iconColor: 'text-rose-500',
 textColor: 'text-rose-800 dark:text-rose-400'
 };
 case 'warning':
 return {
 icon: <AlertTriangle size={20} />,
 bg: 'bg-amber-50 dark:bg-amber-500/10',
 border: 'border-amber-200 dark:border-amber-500/20',
 iconColor: 'text-amber-500',
 textColor: 'text-amber-800 dark:text-amber-400'
 };
 case 'info':
 return {
 icon: <Info size={20} />,
 bg: 'bg-blue-50 dark:bg-blue-500/10',
 border: 'border-blue-200 dark:border-blue-500/20',
 iconColor: 'text-blue-500',
 textColor: 'text-blue-800 dark:text-blue-400'
 };
 case 'loading':
 return {
 icon: <Loader2 size={20} className="animate-spin" />,
 bg: 'bg-gray-50 dark:bg-white/5',
 border: 'border-gray-200 dark:border-white/10',
 iconColor: 'text-gray-500',
 textColor: 'text-gray-800 dark:text-gray-400'
 };
 default:
 return {
 icon: <Info size={20} />,
 bg: 'bg-gray-50 dark:bg-white/5',
 border: 'border-gray-200 dark:border-white/10',
 iconColor: 'text-gray-500',
 textColor: 'text-gray-800 dark:text-gray-400'
 };
 }
 };

 const config = getToastConfig();

 return (
 <motion.div
 layout
 initial={{ opacity: 0, y: -20, scale: 0.95 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, x: 100, scale: 0.95 }}
 transition={{ duration: 0.3, ease: 'easeOut' }}
 className={`${config.bg} ${config.border} border rounded-2xl shadow-lg backdrop-blur-sm overflow-hidden`}
 role="alert"
 aria-live="polite"
 >
 <div className="p-4">
 <div className="flex items-start gap-3">
 {/* Icon */}
 <div className={`shrink-0 mt-0.5 ${config.iconColor}`}>
 {config.icon}
 </div>

 {/* Content */}
 <div className="flex-1 min-w-0">
 <p className={`text-sm font-bold ${config.textColor}`}>
 {toast.message}
 </p>
 {toast.description && (
 <p className={`text-xs ${config.textColor} opacity-70 mt-1`}>
 {toast.description}
 </p>
 )}

 {/* Action Button */}
 {toast.action && (
 <button
 onClick={toast.action.onClick}
 className={`mt-2 text-xs font-black ${config.iconColor} hover:underline`}
 >
 {toast.action.label}
 </button>
 )}
 </div>

 {/* Close Button */}
 <button
 onClick={() => onRemove(toast.id)}
 className={`shrink-0 p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${config.textColor}`}
 aria-label="Close notification"
 >
 <X size={16} />
 </button>
 </div>
 </div>

 {/* Progress Bar */}
 {toast.duration !== 0 && !toast.sticky && (
 <div className="h-1 bg-black/5 dark:bg-white/5 relative">
 <motion.div
 className={`absolute left-0 top-0 h-full ${
 toast.type === 'success' ? 'bg-emerald-500' :
 toast.type === 'error' ? 'bg-rose-500' :
 toast.type === 'warning' ? 'bg-amber-500' :
 toast.type === 'info' ? 'bg-blue-500' :
 'bg-gray-500'
 }`}
 initial={{ width: '100%' }}
 animate={{ width: `${progress}%` }}
 transition={{ duration: 0.05, ease: 'linear' }}
 />
 </div>
 )}
 </motion.div>
 );
};

// ==========================================
// BACKWARDS COMPATIBILITY WRAPPER
// ==========================================

interface LegacyToastProps {
 isVisible: boolean;
 message: string;
 type: ToastType;
 onClose: () => void;
 duration?: number;
}

/**
 * Legacy Toast component for backwards compatibility
 * Wraps the new toast system for old components still using the old API
 */
export const LegacyToast: React.FC<LegacyToastProps> = ({
 isVisible,
 message,
 type,
 onClose,
 duration = 5000
}) => {
 const toast = useToast();

 useEffect(() => {
 if (isVisible && message) {
 const id = toast.showToast({
 type,
 message,
 duration
 });

 // Auto-remove after duration
 const timer = setTimeout(() => {
 onClose();
 }, duration);

 return () => clearTimeout(timer);
 }
 }, [isVisible, message, type, duration, onClose, toast]);

 return null; // New system renders in provider
};

// ==========================================
// HOC FOR EASY MIGRATION
// ==========================================

export function withToast<P extends object>(
 WrappedComponent: React.ComponentType<P>
) {
 return function WithToastComponent(props: P) {
 const toast = useToast();

 const showToast = (message: string, type: ToastType = 'success') => {
 toast.showToast({ type, message });
 };

 const showSuccess = (message: string) => toast.success(message);
 const showError = (message: string) => toast.error(message);
 const showWarning = (message: string) => toast.warning(message);
 const showInfo = (message: string) => toast.info(message);
 const showLoading = (message: string) => toast.loading(message);

 return (
 <WrappedComponent
 {...props}
 showToast={showToast}
 showSuccess={showSuccess}
 showError={showError}
 showWarning={showWarning}
 showInfo={showInfo}
 showLoading={showLoading}
 />
 );
 };
}

export default ToastProvider;
