
import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, X, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning';

interface ToastProps {
 message: string;
 type: ToastType;
 isVisible: boolean;
 onClose: () => void;
}

const MAX_VISIBLE_TOASTS = 2;

type ToastRegistration = {
 id: string;
 notify: (isActive: boolean, index: number) => void;
};

const toastRegistry = new Map<string, ToastRegistration>();
const activeToastIds: string[] = [];
const pendingToastIds: string[] = [];

const removeToastId = (id: string) => {
 const activeIndex = activeToastIds.indexOf(id);
 if (activeIndex !== -1) {
 activeToastIds.splice(activeIndex, 1);
 }

 const pendingIndex = pendingToastIds.indexOf(id);
 if (pendingIndex !== -1) {
 pendingToastIds.splice(pendingIndex, 1);
 }
};

const flushToastQueue = () => {
 while (activeToastIds.length < MAX_VISIBLE_TOASTS && pendingToastIds.length > 0) {
 const nextToastId = pendingToastIds.shift();
 if (!nextToastId || !toastRegistry.has(nextToastId)) continue;
 activeToastIds.push(nextToastId);
 }

 toastRegistry.forEach(({ id, notify }) => {
 const index = activeToastIds.indexOf(id);
 notify(index !== -1, index);
 });
};

const registerToast = (id: string, notify: (isActive: boolean, index: number) => void) => {
 toastRegistry.set(id, { id, notify });
 removeToastId(id);

 if (activeToastIds.length < MAX_VISIBLE_TOASTS) {
 activeToastIds.push(id);
 } else {
 pendingToastIds.push(id);
 }

 flushToastQueue();
};

const unregisterToast = (id: string) => {
 toastRegistry.delete(id);
 removeToastId(id);
 flushToastQueue();
};

const Toast: React.FC<ToastProps> = ({ message, type, isVisible, onClose }) => {
 const toastIdRef = useRef(`toast-${Math.random().toString(36).slice(2, 11)}`);
 const [displayState, setDisplayState] = useState({ isActive: false, index: -1 });

 useEffect(() => {
 if (!isVisible) {
 unregisterToast(toastIdRef.current);
 setDisplayState({ isActive: false, index: -1 });
 return undefined;
 }

 registerToast(toastIdRef.current, (nextIsActive, nextIndex) => {
 setDisplayState({ isActive: nextIsActive, index: nextIndex });
 });

 return () => {
 unregisterToast(toastIdRef.current);
 };
 }, [isVisible, message, type]);

 useEffect(() => {
 if (!isVisible || !displayState.isActive) return undefined;

 const timer = setTimeout(() => {
 onClose();
 }, 3000);

 return () => clearTimeout(timer);
 }, [displayState.isActive, isVisible, onClose]);

 if (!isVisible || !displayState.isActive) return null;

 return (
 <div
 className="fixed right-10 z-[100] animate-in slide-in-from-right-10 fade-in duration-300"
 style={{ top: `${2.5 + Math.max(displayState.index, 0) * 5.5}rem` }}
 >
 <div className={`flex items-center gap-4 px-6 py-4 rounded-[2rem] card-shadow border max-w-[28rem] ${type === 'success'
 ? 'bg-white dark:bg-[#2A3830] text-emerald-600 dark:text-brand border-emerald-200 dark:border-brand/20'
 : type === 'warning'
 ? 'bg-white dark:bg-[#2A3830] text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20'
 : 'bg-white dark:bg-[#2A3830] text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20'
 }`}>
 {type === 'success' ? (
 <CheckCircle2 size={24} strokeWidth={3} />
 ) : type === 'warning' ? (
 <AlertTriangle size={24} strokeWidth={3} />
 ) : (
 <AlertCircle size={24} strokeWidth={3} />
 )}
 <p className="text-sm font-black uppercase tracking-tight">{message}</p>
 <button
 onClick={onClose}
 className="ml-4 p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors text-gray-500 dark:text-gray-400"
 >
 <X size={16} />
 </button>
 </div>
 </div>
 );
};

export default Toast;
