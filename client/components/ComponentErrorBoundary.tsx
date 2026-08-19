import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, RefreshCw, LayoutDashboard, Copy, Check } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode);
  sectionName?: string;
  locationKey?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

class InnerComponentErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ComponentErrorBoundary] Caught render error:`, error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Automatically reset error boundary if the user navigated to another route
    if (this.state.hasError && prevProps.locationKey !== this.props.locationKey) {
      this.resetError();
    }
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  handleCopy = () => {
    const details = `Error: ${this.state.error?.message}\nStack: ${this.state.errorInfo?.componentStack || this.state.error?.stack}`;
    navigator.clipboard.writeText(details);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({ error: this.state.error || new Error('Unknown error'), reset: this.resetError });
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 sm:p-10 text-center animate-in fade-in duration-300">
          <div className="w-full max-w-xl bg-white dark:bg-[#1E293B] border border-red-200 dark:border-red-900/40 rounded-3xl p-8 sm:p-10 shadow-xl relative overflow-hidden">
            {/* Ambient Background Glow */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Icon */}
            <div className="w-16 h-16 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-red-600 dark:text-red-400 shadow-lg">
              <AlertTriangle size={32} />
            </div>

            {/* Title & Description */}
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-red-500 mb-1">
              Component Render Exception
            </p>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tracking-tight mb-3">
              Unable to display this view
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 leading-relaxed max-w-md mx-auto">
              {this.state.error?.message || 'An unexpected rendering error occurred in this module. The rest of the platform and navigation remain fully functional.'}
            </p>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
              <button
                onClick={this.resetError}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2 shadow-md hover:shadow-lg"
              >
                <RefreshCw size={14} />
                Try Again
              </button>

              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="px-6 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2"
              >
                <LayoutDashboard size={14} />
                Return to Dashboard
              </button>

              <button
                onClick={this.handleCopy}
                className="px-4 py-2.5 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50 text-gray-500 dark:text-gray-400 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5"
                title="Copy error details"
              >
                {this.state.copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                <span>{this.state.copied ? 'Copied' : 'Diagnostics'}</span>
              </button>
            </div>

            {/* Development Stack Trace */}
            {process.env.NODE_ENV !== 'production' && this.state.errorInfo && (
              <details className="text-left bg-gray-50 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800 rounded-xl p-3 text-xs text-gray-600 dark:text-gray-400 mt-4 max-h-40 overflow-y-auto">
                <summary className="cursor-pointer font-mono text-[11px] text-gray-500 select-none">
                  Component Stack Trace
                </summary>
                <pre className="mt-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export const ComponentErrorBoundary: React.FC<{
  children: ReactNode;
  fallback?: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode);
  sectionName?: string;
}> = ({ children, fallback, sectionName }) => {
  const location = useLocation();
  return (
    <InnerComponentErrorBoundary
      fallback={fallback}
      sectionName={sectionName}
      locationKey={location.pathname + location.search}
    >
      {children}
    </InnerComponentErrorBoundary>
  );
};

export default ComponentErrorBoundary;
