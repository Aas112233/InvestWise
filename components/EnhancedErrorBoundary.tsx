import React, { useState, useEffect } from 'react';
import { AlertCircle, WifiOff, RefreshCw, Database, Server, X, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Enhanced Error Boundary Component
 * Catches JavaScript errors and displays user-friendly error UI
 * with retry functionality and detailed error reporting
 */

interface ErrorBoundaryProps {
 children: React.ReactNode;
 fallback?: React.ComponentType<{
 error: Error;
 resetError: () => void;
 errorInfo: React.ErrorInfo | null;
 }>;
}

interface ErrorBoundaryState {
 hasError: boolean;
 error: Error | null;
 errorInfo: React.ErrorInfo | null;
 errorType: 'javascript' | 'network' | 'database' | 'server';
}

class ErrorBoundaryClass extends React.Component<
 { children: React.ReactNode },
 ErrorBoundaryState
> {
 constructor(props: { children: React.ReactNode }) {
 super(props);
 this.state = {
 hasError: false,
 error: null,
 errorInfo: null,
 errorType: 'javascript'
 };
 }

 static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
 // Determine error type from error message
 let errorType: ErrorBoundaryState['errorType'] = 'javascript';
 
 if (error.message.includes('Network Error') || error.message.includes('fetch')) {
 errorType = 'network';
 } else if (error.message.includes('database') || error.message.includes('Database')) {
 errorType = 'database';
 } else if (error.message.includes('500') || error.message.includes('Server')) {
 errorType = 'server';
 }

 return {
 hasError: true,
 error,
 errorType
 };
 }

 componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
 // Log error to console in development
 if (process.env.NODE_ENV === 'development') {
 console.error('ErrorBoundary caught an error:', error);
 console.error('Error Info:', errorInfo);
 }

 // Log to error tracking service in production (e.g., Sentry)
 if (process.env.NODE_ENV === 'production') {
 // TODO: Integrate with Sentry or similar
 // Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
 }

 this.setState({
 error,
 errorInfo
 });
 }

 resetError = () => {
 this.setState({
 hasError: false,
 error: null,
 errorInfo: null,
 errorType: 'javascript'
 });
 };

 render() {
 if (this.state.hasError) {
 if (this.props.fallback) {
 const FallbackComponent = this.props.fallback;
 return (
 <FallbackComponent
 error={this.state.error!}
 resetError={this.resetError}
 errorInfo={this.state.errorInfo}
 />
 );
 }

 return (
 <ErrorUI
 error={this.state.error!}
 errorType={this.state.errorType}
 resetError={this.resetError}
 errorInfo={this.state.errorInfo}
 />
 );
 }

 return this.props.children;
 }
}

// Functional wrapper for ErrorBoundary
const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({ children, fallback }) => {
 return (
 <ErrorBoundaryClass fallback={fallback}>
 {children}
 </ErrorBoundaryClass>
 );
};

/**
 * User-Friendly Error UI Component
 */
interface ErrorUIProps {
 error: Error;
 errorType: 'javascript' | 'network' | 'database' | 'server';
 resetError: () => void;
 errorInfo?: React.ErrorInfo | null;
 title?: string;
 showDetails?: boolean;
}

const ErrorUI: React.FC<ErrorUIProps> = ({
 error,
 errorType,
 resetError,
 errorInfo,
 title,
 showDetails = false
}) => {
 const [showStack, setShowStack] = useState(false);

 const getErrorConfig = () => {
 switch (errorType) {
 case 'network':
 return {
 icon: <WifiOff size={48} className="text-amber-500" />,
 title: title || 'Connection Lost',
 message: 'Unable to reach the server. Please check your internet connection and try again.',
 action: 'Retry Connection',
 color: 'amber'
 };
 case 'database':
 return {
 icon: <Database size={48} className="text-rose-500" />,
 title: title || 'Database Unavailable',
 message: 'The database service is temporarily unavailable. Our team has been notified.',
 action: 'Try Again',
 color: 'rose'
 };
 case 'server':
 return {
 icon: <Server size={48} className="text-rose-500" />,
 title: title || 'Server Error',
 message: 'Something went wrong on our end. Please try again in a moment.',
 action: 'Retry Request',
 color: 'rose'
 };
 default:
 return {
 icon: <AlertCircle size={48} className="text-rose-500" />,
 title: title || 'Something Went Wrong',
 message: 'An unexpected error occurred. Please try refreshing the page.',
 action: 'Refresh Page',
 color: 'rose'
 };
 }
 };

 const errorConfig = getErrorConfig();

 const getErrorCode = () => {
 if (error.message.includes('401')) return '401 - Unauthorized';
 if (error.message.includes('403')) return '403 - Forbidden';
 if (error.message.includes('404')) return '404 - Not Found';
 if (error.message.includes('500')) return '500 - Server Error';
 if (error.message.includes('503')) return '503 - Service Unavailable';
 return null;
 };

 const errorCode = getErrorCode();

 return (
 <motion.div
 initial={{ opacity: 0, scale: 0.95 }}
 animate={{ opacity: 1, scale: 1 }}
 transition={{ duration: 0.3 }}
 className="min-h-[60vh] flex items-center justify-center p-8"
 >
 <div className="max-w-2xl w-full bg-white dark:bg-[#1A221D] rounded-[2.5rem] shadow-2xl p-12 text-center border border-gray-100 dark:border-white/5">
 {/* Error Icon with Animation */}
 <motion.div
 initial={{ scale: 0, rotate: -180 }}
 animate={{ scale: 1, rotate: 0 }}
 transition={{ type: 'spring', damping: 12, stiffness: 200 }}
 className="w-24 h-24 mx-auto mb-8 rounded-full bg-gray-50 dark:bg-white/5 flex items-center justify-center"
 >
 {errorConfig.icon}
 </motion.div>

 {/* Error Title */}
 <h2 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter mb-4">
 {errorConfig.title}
 </h2>

 {/* Error Message */}
 <p className="text-base text-gray-600 dark:text-gray-400 mb-8 max-w-lg mx-auto leading-relaxed">
 {errorConfig.message}
 </p>

 {/* Error Code */}
 {errorCode && (
 <div className="inline-block px-4 py-2 bg-gray-100 dark:bg-white/5 rounded-full mb-8">
 <span className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
 {errorCode}
 </span>
 </div>
 )}

 {/* Action Buttons */}
 <div className="flex items-center justify-center gap-4 mb-8">
 <motion.button
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 onClick={resetError}
 className="bg-brand text-dark px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center gap-3 hover:shadow-lg transition-shadow"
 >
 <RefreshCw size={18} />
 {errorConfig.action}
 </motion.button>

 <motion.button
 whileHover={{ scale: 1.05 }}
 whileTap={{ scale: 0.95 }}
 onClick={() => window.location.href = '/'}
 className="bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center gap-3 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
 >
 Go Home
 </motion.button>
 </div>

 {/* Error Details Toggle */}
 {showDetails && (
 <div className="border-t border-gray-100 dark:border-white/5 pt-6">
 <button
 onClick={() => setShowStack(!showStack)}
 className="text-xs font-black text-gray-400 uppercase tracking-widest hover:text-brand transition-colors flex items-center gap-2 mx-auto"
 >
 {showStack ? 'Hide' : 'Show'} Technical Details
 <motion.div
 animate={{ rotate: showStack ? 180 : 0 }}
 transition={{ duration: 0.2 }}
 >
 ↓
 </motion.div>
 </button>

 <AnimatePresence>
 {showStack && errorInfo && (
 <motion.div
 initial={{ height: 0, opacity: 0 }}
 animate={{ height: 'auto', opacity: 1 }}
 exit={{ height: 0, opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="mt-4 overflow-hidden"
 >
 <div className="bg-gray-50 dark:bg-[#111814] rounded-2xl p-6 text-left">
 <pre className="text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words max-h-64 overflow-auto">
 {error.message}
 {'\n\n'}
 {errorInfo.componentStack}
 </pre>
 </div>
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 )}

 {/* Help Link */}
 <div className="mt-8 pt-6 border-t border-gray-100 dark:border-white/5">
 <p className="text-xs text-gray-400 dark:text-gray-500">
 Need help?{' '}
 <a
 href="mailto:support@investwise.com"
 className="text-brand hover:underline font-bold inline-flex items-center gap-1"
 >
 Contact Support
 <ExternalLink size={12} />
 </a>
 </p>
 </div>
 </div>
 </motion.div>
 );
};

/**
 * Async Function Wrapper with Retry Logic
 * Wraps async operations with automatic retry and error handling
 */
export interface RetryOptions {
 maxRetries?: number;
 retryDelay?: number;
 backoffMultiplier?: number;
 onRetry?: (attempt: number, error: Error) => void;
}

export const withRetry = async <T,>(
 asyncFn: () => Promise<T>,
 options: RetryOptions = {}
): Promise<T> => {
 const {
 maxRetries = 3,
 retryDelay = 1000,
 backoffMultiplier = 2,
 onRetry
 } = options;

 let lastError: Error | null = null;

 for (let attempt = 0; attempt <= maxRetries; attempt++) {
 try {
 return await asyncFn();
 } catch (error) {
 lastError = error as Error;

 if (attempt < maxRetries) {
 const delay = retryDelay * Math.pow(backoffMultiplier, attempt);
 
 if (onRetry) {
 onRetry(attempt + 1, error as Error);
 }

 if (process.env.NODE_ENV === 'development') {
 console.warn(` Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`, error);
 }

 await new Promise(resolve => setTimeout(resolve, delay));
 }
 }
 }

 throw lastError || new Error('Operation failed after retries');
};

/**
 * Network Error Detection Utility
 */
export const detectErrorType = (error: any): {
 type: 'network' | 'database' | 'server' | 'validation' | 'auth' | 'unknown';
 message: string;
 retryable: boolean;
} => {
 // Network errors
 if (!error.response || error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') {
 return {
 type: 'network',
 message: 'Unable to connect to the server. Please check your internet connection.',
 retryable: true
 };
 }

 const status = error.response?.status;

 // Server errors (5xx)
 if (status >= 500) {
 return {
 type: 'server',
 message: 'Server error. Please try again in a moment.',
 retryable: true
 };
 }

 // Database errors
 if (status === 503 || error.response?.data?.error === 'SERVICE_UNAVAILABLE') {
 return {
 type: 'database',
 message: 'Database service unavailable. Our team has been notified.',
 retryable: false
 };
 }

 // Authentication errors
 if (status === 401) {
 return {
 type: 'auth',
 message: 'Your session has expired. Please log in again.',
 retryable: false
 };
 }

 // Authorization errors
 if (status === 403) {
 return {
 type: 'auth',
 message: 'You do not have permission to perform this action.',
 retryable: false
 };
 }

 // Validation errors
 if (status === 422 || status === 400) {
 return {
 type: 'validation',
 message: error.response?.data?.message || 'Invalid input. Please check your data.',
 retryable: false
 };
 }

 // Unknown error
 return {
 type: 'unknown',
 message: error.message || 'An unexpected error occurred.',
 retryable: true
 };
};

export { ErrorBoundary as default, ErrorUI };
