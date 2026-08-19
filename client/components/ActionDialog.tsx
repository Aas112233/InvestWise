import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X, Info, Trash2, Link as LinkIcon, Loader2 } from 'lucide-react';

export type ActionType = 'delete' | 'confirm' | 'review';

export interface DataDependency {
  type: string;
  count: number;
  description?: string;
}

export interface ActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | React.ReactNode;
  type: ActionType;
  confirmLabel?: string;
  cancelLabel?: string;
  details?: { label: string; value: string | number }[];
  onCheckDependencies?: () => Promise<DataDependency[]>;
  loading?: boolean;
}

const ActionDialog: React.FC<ActionDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  type,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  details,
  onCheckDependencies,
  loading = false,
}) => {
  const [visible, setVisible] = useState(false);
  const [isCheckingDependencies, setIsCheckingDependencies] = useState(false);
  const [dependencies, setDependencies] = useState<DataDependency[]>([]);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setDependencies([]);
      setIsCheckingDependencies(false);

      if (onCheckDependencies && type === 'delete') {
        setIsCheckingDependencies(true);
        onCheckDependencies()
          .then((deps) => {
            setDependencies(deps);
            setIsCheckingDependencies(false);
          })
          .catch((err) => {
            console.error('Dependency check failed:', err);
            setDependencies([]);
            setIsCheckingDependencies(false);
          });
      }
    } else {
      const timer = setTimeout(() => setVisible(false), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onCheckDependencies, type]);

  if (!visible && !isOpen) return null;

  const isDelete = type === 'delete';
  const hasDependencies = dependencies.length > 0;
  const totalDependencies = dependencies.reduce((sum, dep) => sum + dep.count, 0);
  const isBlocked = isDelete && hasDependencies;
  const isButtonDisabled = isCheckingDependencies || isBlocked || loading;

  const getIcon = () => {
    if (isCheckingDependencies) {
      return <Loader2 size={20} className="text-blue-600 dark:text-blue-400 animate-spin" />;
    }
    if (isBlocked) {
      return <LinkIcon size={20} className="text-amber-600 dark:text-amber-400" />;
    }
    if (isDelete) {
      return <Trash2 size={20} className="text-red-600 dark:text-red-400" />;
    }
    if (type === 'confirm') {
      return <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />;
    }
    return <Info size={20} className="text-blue-600 dark:text-blue-400" />;
  };

  const getIconBadgeClass = () => {
    if (isCheckingDependencies) return 'bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/40';
    if (isBlocked) return 'bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/40';
    if (isDelete) return 'bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/40';
    if (type === 'confirm') return 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/40';
    return 'bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/40';
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-150 ${
        isOpen ? 'bg-slate-900/60 dark:bg-black/75 backdrop-blur-sm opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading && !isCheckingDependencies) {
          onClose();
        }
      }}
    >
      <div
        className={`w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-all duration-150 transform ${
          isOpen ? 'scale-100 opacity-100' : 'scale-98 opacity-0'
        }`}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${getIconBadgeClass()}`}>
              {getIcon()}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white leading-snug">
                {title}
              </h3>
              {isDelete && !isBlocked && !isCheckingDependencies && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-0.5">
                  Destructive action &bull; Cannot be undone
                </p>
              )}
              {isBlocked && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                  Action blocked &bull; Connected data exists
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading || isCheckingDependencies}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="px-6 pb-6 space-y-4">
          {/* Main Message */}
          <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {message}
          </div>

          {/* Dependency Checking Indicator */}
          {isCheckingDependencies && (
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/40 text-xs text-blue-700 dark:text-blue-300">
              <Loader2 size={15} className="animate-spin text-blue-600 shrink-0" />
              <span>Verifying data dependencies before proceeding...</span>
            </div>
          )}

          {/* Blocked Dependencies Alert */}
          {isBlocked && !isCheckingDependencies && (
            <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 space-y-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                Cannot delete due to {totalDependencies} connected {totalDependencies === 1 ? 'record' : 'records'}:
              </p>
              <ul className="space-y-1.5">
                {dependencies.map((dep, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between text-xs text-amber-900 dark:text-amber-100 bg-white/60 dark:bg-amber-900/20 px-2.5 py-1.5 rounded"
                  >
                    <span>{dep.type}</span>
                    <span className="font-semibold">{dep.count}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Please reassign or delete these records before continuing.
              </p>
            </div>
          )}

          {/* Details Summary (For Review Mode) */}
          {details && details.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-2">
              {details.map((detail, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs py-1 border-b last:border-0 border-slate-200 dark:border-slate-700/50"
                >
                  <span className="text-slate-500 dark:text-slate-400 font-medium">{detail.label}</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold text-right">{detail.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={isButtonDisabled ? undefined : onConfirm}
            disabled={isButtonDisabled}
            className={`px-4 py-2 text-xs font-medium rounded-lg text-white transition-colors flex items-center gap-2 shadow-sm ${
              isButtonDisabled
                ? 'bg-slate-400 dark:bg-slate-700 cursor-not-allowed opacity-60'
                : isDelete
                ? 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
            }`}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Processing...</span>
              </>
            ) : isCheckingDependencies ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Checking...</span>
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActionDialog;
