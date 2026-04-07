import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Sparkles, Star } from 'lucide-react';

/**
 * Success Animation Component
 * Beautiful celebration animation after successful form submission
 */

interface SuccessAnimationProps {
 show: boolean;
 message?: string;
 onComplete?: () => void;
 duration?: number;
}

const SuccessAnimation: React.FC<SuccessAnimationProps> = ({
 show,
 message = 'Success!',
 onComplete,
 duration = 2000
}) => {
 const [visible, setVisible] = useState(show);

 useEffect(() => {
 if (show) {
 setVisible(true);
 const timer = setTimeout(() => {
 setVisible(false);
 onComplete?.();
 }, duration);

 return () => clearTimeout(timer);
 }
 }, [show, duration, onComplete]);

 return (
 <AnimatePresence>
 {visible && (
 <motion.div
 className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 >
 {/* Background Overlay */}
 <motion.div
 className="absolute inset-0 bg-emerald-500/10 dark:bg-emerald-500/5"
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.3 }}
 />

 {/* Floating Stars */}
 {Array.from({ length: 12 }).map((_, i) => (
 <motion.div
 key={`star-${i}`}
 className="absolute"
 initial={{
 scale: 0,
 x: 0,
 y: 0,
 rotate: 0
 }}
 animate={{
 scale: [0, 1, 0],
 x: Math.cos((i * Math.PI * 2) / 12) * 150,
 y: Math.sin((i * Math.PI * 2) / 12) * 150,
 rotate: 360
 }}
 transition={{
 duration: 1.2,
 delay: i * 0.05,
 ease: 'easeOut'
 }}
 style={{
 left: '50%',
 top: '50%'
 }}
 >
 <Star
 size={20}
 className="text-brand fill-brand"
 />
 </motion.div>
 ))}

 {/* Center Check Circle */}
 <motion.div
 className="relative z-10"
 initial={{ scale: 0 }}
 animate={{ scale: 1 }}
 transition={{
 type: 'spring',
 stiffness: 200,
 damping: 15,
 delay: 0.1
 }}
 >
 {/* Pulsing Ring */}
 <motion.div
 className="absolute inset-0 w-32 h-32 -m-4 rounded-full bg-brand/20"
 initial={{ scale: 0.5, opacity: 1 }}
 animate={{ scale: 2, opacity: 0 }}
 transition={{ duration: 0.8, ease: 'easeOut' }}
 />

 {/* Check Circle */}
 <motion.div
 className="w-24 h-24 rounded-full bg-emerald-500 flex items-center justify-center shadow-2xl"
 initial={{ scale: 0, rotate: -180 }}
 animate={{ scale: 1, rotate: 0 }}
 transition={{
 type: 'spring',
 stiffness: 200,
 damping: 12,
 delay: 0.2
 }}
 >
 <motion.div
 initial={{ scale: 0 }}
 animate={{ scale: 1 }}
 transition={{ delay: 0.5, type: 'spring' }}
 >
 <Check size={48} className="text-white" strokeWidth={4} />
 </motion.div>
 </motion.div>

 {/* Success Message */}
 <motion.div
 className="absolute top-full mt-6 left-1/2 -translate-x-1/2 whitespace-nowrap"
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 0.6 }}
 >
 <p className="text-2xl font-black text-emerald-500 dark:text-emerald-400 uppercase tracking-tighter">
 {message}
 </p>
 </motion.div>
 </motion.div>

 {/* Sparkles */}
 {Array.from({ length: 6 }).map((_, i) => (
 <motion.div
 key={`sparkle-${i}`}
 className="absolute"
 initial={{
 opacity: 0,
 x: 0,
 y: 0,
 scale: 0
 }}
 animate={{
 opacity: [0, 1, 0],
 x: Math.cos((i * Math.PI * 2) / 6 + Math.PI / 6) * 100,
 y: Math.sin((i * Math.PI * 2) / 6 + Math.PI / 6) * 100,
 scale: [0, 1, 0]
 }}
 transition={{
 duration: 1,
 delay: 0.3 + i * 0.08
 }}
 style={{
 left: '50%',
 top: '50%'
 }}
 >
 <Sparkles size={24} className="text-brand" />
 </motion.div>
 ))}
 </motion.div>
 )}
 </AnimatePresence>
 );
};

/**
 * Mini Success Check
 * Smaller version for inline success states
 */

interface MiniSuccessCheckProps {
 show: boolean;
 size?: number;
 className?: string;
}

export const MiniSuccessCheck: React.FC<MiniSuccessCheckProps> = ({
 show,
 size = 24,
 className = ''
}) => {
 return (
 <AnimatePresence>
 {show && (
 <motion.div
 className={`inline-flex items-center justify-center ${className}`}
 initial={{ scale: 0, opacity: 0 }}
 animate={{ scale: 1, opacity: 1 }}
 exit={{ scale: 0, opacity: 0 }}
 transition={{ type: 'spring', stiffness: 300, damping: 20 }}
 >
 <motion.div
 className="rounded-full bg-emerald-500 flex items-center justify-center"
 style={{ width: size, height: size }}
 initial={{ scale: 0 }}
 animate={{ scale: 1 }}
 transition={{ type: 'spring', stiffness: 300, damping: 20 }}
 >
 <Check size={size * 0.6} className="text-white" strokeWidth={3} />
 </motion.div>
 </motion.div>
 )}
 </AnimatePresence>
 );
};

/**
 * Progress Success Bar
 * Animated progress bar for submission states
 */

interface ProgressSuccessProps {
 progress: number;
 show?: boolean;
 className?: string;
}

export const ProgressSuccessBar: React.FC<ProgressSuccessProps> = ({
 progress,
 show = true,
 className = ''
}) => {
 return (
 <AnimatePresence>
 {show && (
 <motion.div
 className={`w-full h-2 bg-gray-200 dark:bg-white/5 rounded-full overflow-hidden ${className}`}
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 >
 <motion.div
 className="h-full bg-gradient-to-r from-brand to-emerald-500 rounded-full"
 initial={{ width: 0 }}
 animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
 transition={{ duration: 0.3, ease: 'easeOut' }}
 />
 </motion.div>
 )}
 </AnimatePresence>
 );
};

export default SuccessAnimation;
