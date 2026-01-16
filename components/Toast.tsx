
import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  isVisible: boolean;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, isVisible, onClose }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-10 right-10 z-[100] animate-in slide-in-from-right-10 fade-in duration-300">
      <div className={`flex items-center gap-4 px-6 py-4 rounded-[2rem] card-shadow border ${type === 'success'
          ? 'bg-dark text-brand border-brand/20'
          : type === 'warning'
            ? 'bg-dark text-amber-400 border-amber-500/20'
            : 'bg-dark text-red-400 border-red-500/20'
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
          className="ml-4 p-1 hover:bg-white/10 rounded-full transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default Toast;
