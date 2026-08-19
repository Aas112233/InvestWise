import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';

interface Props {
 children: ReactNode;
 fallback?: ReactNode;
}

interface State {
 hasError: boolean;
 error: Error | null;
 errorInfo: ErrorInfo | null;
 isOffline: boolean;
}

class ErrorBoundary extends Component<Props, State> {
 public state: State = {
 hasError: false,
 error: null,
 errorInfo: null,
 isOffline: !navigator.onLine,
 };

 public static getDerivedStateFromError(error: Error): Partial<State> {
 return { hasError: true, error };
 }

 public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
 console.error(' Error caught by boundary:', error, errorInfo);
 this.setState({ error, errorInfo });
 
 // Log to error reporting service if configured
 if (process.env.NODE_ENV === 'production') {
 // TODO: Add error reporting service integration
 console.error('Production error:', error.message, errorInfo.componentStack);
 }
 }

 public componentDidMount() {
 window.addEventListener('online', this.handleOnline);
 window.addEventListener('offline', this.handleOffline);
 }

 public componentWillUnmount() {
 window.removeEventListener('online', this.handleOnline);
 window.removeEventListener('offline', this.handleOffline);
 }

 private handleOnline = () => {
 this.setState({ isOffline: false });
 };

 private handleOffline = () => {
 this.setState({ isOffline: true });
 };

 private handleRetry = () => {
 this.setState({ hasError: false, error: null, errorInfo: null });
 window.location.reload();
 };

 public render() {
 if (this.state.hasError || this.state.isOffline) {
 if (this.props.fallback) {
 return this.props.fallback;
 }
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0f172a] text-gray-900 dark:text-white p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#1e293b] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl p-8 text-center">
            {this.state.isOffline ? (
              <>
                <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-amber-500">
                  <WifiOff size={32} />
                </div>
                <h1 className="text-xl font-bold mb-2">Connection Lost</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                  Please check your internet connection. Reconnecting automatically when available.
                </p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-500">
                  <AlertTriangle size={32} />
                </div>
                <h1 className="text-xl font-bold mb-2">Application Error</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {this.state.error?.message || 'An unexpected application error occurred.'}
                </p>
                {process.env.NODE_ENV !== 'production' && this.state.errorInfo && (
                  <details className="text-left bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800 p-3 rounded-xl mb-6 text-xs text-gray-600 dark:text-gray-400 max-h-40 overflow-y-auto font-mono">
                    <summary className="cursor-pointer mb-1 text-[11px] text-gray-500">Technical Details</summary>
                    <pre className="whitespace-pre-wrap text-[10px]">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </>
            )}

            <div className="flex flex-col gap-2.5">
              <button
                onClick={this.handleRetry}
                className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold py-3 px-4 rounded-xl transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md"
              >
                <RefreshCw size={14} />
                Reload Application
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('userInfo');
                  window.location.href = '/login';
                }}
                className="w-full bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 font-medium py-2.5 px-4 rounded-xl transition-all text-xs"
              >
                Return to Login
              </button>
            </div>
          </div>
        </div>
      );
 }

 return this.props.children;
 }
}

export default ErrorBoundary;
