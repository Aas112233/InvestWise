import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Loader2 } from 'lucide-react';

export interface InlineTopFormProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel?: string;
  loading?: boolean;
}

export const InlineTopForm: React.FC<InlineTopFormProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  onSubmit,
  submitLabel = 'Save',
  loading = false,
}) => {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex flex-col justify-start">
          {/* Backdrop Overlay (Click outside to close) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm"
          />

          {/* Top Floating Overlay Form Panel */}
          <motion.div
            initial={{ y: '-100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="relative w-full max-w-7xl mx-auto p-4 sm:p-6 my-2 sm:my-4 z-10"
          >
            <div className="bg-white dark:bg-[#1A221D] rounded-3xl p-6 sm:p-8 border border-gray-200 dark:border-white/10 shadow-2xl relative">
              {/* Form Header Bar */}
              <div className="flex items-center justify-between pb-5 mb-6 border-b border-gray-100 dark:border-white/10">
                <div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-none">
                    {title}
                  </h2>
                  {subtitle && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-medium">
                      {subtitle}
                    </p>
                  )}
                </div>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2.5 rounded-2xl text-gray-400 hover:text-slate-900 dark:hover:text-white bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                  title="Close (Esc)"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Form Body */}
              <form onSubmit={onSubmit} className="space-y-6">
                {children}

                {/* Action Footer */}
                <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-5 border-t border-gray-100 dark:border-white/10">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="w-full sm:w-auto px-6 py-3 rounded-2xl border border-gray-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full sm:w-auto px-8 py-3 rounded-2xl bg-dark dark:bg-brand text-white dark:text-dark hover:scale-[1.02] font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-brand/10 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check size={16} strokeWidth={3} />
                        <span>{submitLabel}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
