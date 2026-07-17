import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from './Button';

/**
 * Empty State Component
 * Illustrated empty states with CTAs
 */

export type EmptyStateType = 
  | 'data'
  | 'search'
  | 'filter'
  | 'error'
  | 'loading'
  | 'success'
  | 'warning';

interface EmptyStateProps {
  type?: EmptyStateType;
  title: string;
  description?: string;
  illustration?: React.ReactNode;
  primaryAction?: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const Illustrations = {
  data: (
    <svg viewBox="0 0 200 200" className="w-32 h-32">
      <defs>
        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#grad1)" />
      <rect x="60" y="70" width="30" height="60" rx="2" fill="#3b82f6" opacity="0.3" />
      <rect x="100" y="50" width="30" height="80" rx="2" fill="#3b82f6" opacity="0.5" />
      <rect x="140" y="90" width="30" height="40" rx="2" fill="#3b82f6" opacity="0.4" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 200 200" className="w-32 h-32">
      <defs>
        <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#grad2)" />
      <circle cx="85" cy="85" r="30" fill="none" stroke="#3b82f6" strokeWidth="6" opacity="0.6" />
      <line x1="107" y1="107" x2="130" y2="130" stroke="#3b82f6" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
    </svg>
  ),
  filter: (
    <svg viewBox="0 0 200 200" className="w-32 h-32">
      <defs>
        <linearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#grad3)" />
      <path d="M60 70 L140 70 L120 100 L120 140 L80 150 L80 100 Z" fill="none" stroke="#f59e0b" strokeWidth="6" opacity="0.6" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 200 200" className="w-32 h-32">
      <defs>
        <linearGradient id="grad4" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#grad4)" />
      <circle cx="100" cy="100" r="40" fill="none" stroke="#ef4444" strokeWidth="6" opacity="0.6" />
      <line x1="80" y1="80" x2="120" y2="120" stroke="#ef4444" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
      <line x1="120" y1="80" x2="80" y2="120" stroke="#ef4444" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 200 200" className="w-32 h-32">
      <defs>
        <linearGradient id="grad5" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#grad5)" />
      <path d="M75 100 L95 120 L135 75" fill="none" stroke="#10b981" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 200 200" className="w-32 h-32">
      <defs>
        <linearGradient id="grad6" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="80" fill="url(#grad6)" />
      <path d="M100 60 L100 110 M100 130 L100 140" stroke="#f59e0b" strokeWidth="8" strokeLinecap="round" opacity="0.6" />
    </svg>
  ),
  loading: (
    <div className="flex items-center justify-center w-32 h-32">
      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
};

const EmptyState: React.FC<EmptyStateProps> = ({
  type = 'data',
  title,
  description,
  illustration,
  primaryAction,
  secondaryAction,
  className = '',
}) => {
  const illustrationElement = illustration || Illustrations[type];

  return (
    <div className={`flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 rounded shadow-sm max-w-lg mx-auto ${className}`}>
      <div className="mb-4">
        {illustrationElement}
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold text-slate-950 dark:text-white mb-1.5">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
          {description}
        </p>
      )}

      {/* Actions */}
      {(primaryAction || secondaryAction) && (
        <div className="flex items-center justify-center gap-3">
          {primaryAction && (
            <Button
              variant="primary"
              size="sm"
              onClick={primaryAction.onClick}
              icon={primaryAction.icon || <Plus size={14} />}
            >
              {primaryAction.label}
            </Button>
          )}

          {secondaryAction && (
            <Button
              variant="secondary"
              size="sm"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
