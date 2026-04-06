import React from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, Filter, RefreshCw, ArrowRight } from 'lucide-react';

/**
 * Empty State Component
 * Beautiful illustrated empty states with CTAs
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
 <svg viewBox="0 0 200 200" className="w-48 h-48">
 <defs>
 <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="#BFF300" stopOpacity="0.2" />
 <stop offset="100%" stopColor="#BFF300" stopOpacity="0.05" />
 </linearGradient>
 </defs>
 <circle cx="100" cy="100" r="80" fill="url(#grad1)" />
 <rect x="60" y="70" width="30" height="60" rx="4" fill="#BFF300" opacity="0.3" />
 <rect x="100" y="50" width="30" height="80" rx="4" fill="#BFF300" opacity="0.5" />
 <rect x="140" y="90" width="30" height="40" rx="4" fill="#BFF300" opacity="0.4" />
 <circle cx="75" cy="60" r="6" fill="#BFF300" opacity="0.6" />
 <circle cx="115" cy="40" r="6" fill="#BFF300" opacity="0.8" />
 <circle cx="155" cy="80" r="6" fill="#BFF300" opacity="0.7" />
 </svg>
 ),
 search: (
 <svg viewBox="0 0 200 200" className="w-48 h-48">
 <defs>
 <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="#6366F1" stopOpacity="0.2" />
 <stop offset="100%" stopColor="#6366F1" stopOpacity="0.05" />
 </linearGradient>
 </defs>
 <circle cx="100" cy="100" r="80" fill="url(#grad2)" />
 <circle cx="85" cy="85" r="30" fill="none" stroke="#6366F1" strokeWidth="6" opacity="0.6" />
 <line x1="107" y1="107" x2="130" y2="130" stroke="#6366F1" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
 <circle cx="140" cy="60" r="4" fill="#6366F1" opacity="0.4" />
 <circle cx="60" cy="140" r="4" fill="#6366F1" opacity="0.4" />
 </svg>
 ),
 filter: (
 <svg viewBox="0 0 200 200" className="w-48 h-48">
 <defs>
 <linearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.2" />
 <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.05" />
 </linearGradient>
 </defs>
 <circle cx="100" cy="100" r="80" fill="url(#grad3)" />
 <path d="M60 70 L140 70 L120 100 L120 140 L80 150 L80 100 Z" fill="none" stroke="#F59E0B" strokeWidth="6" opacity="0.6" />
 </svg>
 ),
 error: (
 <svg viewBox="0 0 200 200" className="w-48 h-48">
 <defs>
 <linearGradient id="grad4" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="#EC4899" stopOpacity="0.2" />
 <stop offset="100%" stopColor="#EC4899" stopOpacity="0.05" />
 </linearGradient>
 </defs>
 <circle cx="100" cy="100" r="80" fill="url(#grad4)" />
 <circle cx="100" cy="100" r="40" fill="none" stroke="#EC4899" strokeWidth="6" opacity="0.6" />
 <line x1="80" y1="80" x2="120" y2="120" stroke="#EC4899" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
 <line x1="120" y1="80" x2="80" y2="120" stroke="#EC4899" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
 </svg>
 ),
 success: (
 <svg viewBox="0 0 200 200" className="w-48 h-48">
 <defs>
 <linearGradient id="grad5" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="#10B981" stopOpacity="0.2" />
 <stop offset="100%" stopColor="#10B981" stopOpacity="0.05" />
 </linearGradient>
 </defs>
 <circle cx="100" cy="100" r="80" fill="url(#grad5)" />
 <circle cx="100" cy="100" r="40" fill="none" stroke="#10B981" strokeWidth="6" opacity="0.6" />
 <polyline points="80,100 95,115 120,85" fill="none" stroke="#10B981" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
 </svg>
 ),
 warning: (
 <svg viewBox="0 0 200 200" className="w-48 h-48">
 <defs>
 <linearGradient id="grad6" x1="0%" y1="0%" x2="100%" y2="100%">
 <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.2" />
 <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.05" />
 </linearGradient>
 </defs>
 <circle cx="100" cy="100" r="80" fill="url(#grad6)" />
 <polygon points="100,60 140,130 60,130" fill="none" stroke="#F59E0B" strokeWidth="6" opacity="0.6" />
 <line x1="100" y1="85" x2="100" y2="105" stroke="#F59E0B" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
 <circle cx="100" cy="115" r="3" fill="#F59E0B" opacity="0.6" />
 </svg>
 )
};

const EmptyState: React.FC<EmptyStateProps> = ({
 type = 'data',
 title,
 description,
 illustration,
 primaryAction,
 secondaryAction,
 className = ''
}) => {
 const illustrationElement = illustration || Illustrations[type];

 return (
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ duration: 0.5 }}
 className={`flex items-center justify-center py-20 ${className}`}
 >
 <div className="text-center max-w-md">
 {/* Illustration */}
 <motion.div
 initial={{ scale: 0.8, opacity: 0 }}
 animate={{ scale: 1, opacity: 1 }}
 transition={{ delay: 0.1, duration: 0.4 }}
 className="mx-auto mb-8"
 >
 {illustrationElement}
 </motion.div>

 {/* Title */}
 <motion.h3
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.2 }}
 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter mb-3"
 >
 {title}
 </motion.h3>

 {/* Description */}
 {description && (
 <motion.p
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.3 }}
 className="text-sm text-gray-600 dark:text-gray-400 mb-8 leading-relaxed"
 >
 {description}
 </motion.p>
 )}

 {/* Actions */}
 {(primaryAction || secondaryAction) && (
 <motion.div
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.4 }}
 className="flex items-center justify-center gap-4"
 >
 {primaryAction && (
 <motion.button
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 onClick={primaryAction.onClick}
 className="bg-brand text-dark px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center gap-2 hover:shadow-lg transition-shadow"
 >
 {primaryAction.icon || <Plus size={16} />}
 {primaryAction.label}
 </motion.button>
 )}

 {secondaryAction && (
 <motion.button
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 onClick={secondaryAction.onClick}
 className="bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
 >
 {secondaryAction.label}
 </motion.button>
 )}
 </motion.div>
 )}
 </div>
 </motion.div>
 );
};

export default EmptyState;
