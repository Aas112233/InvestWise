import React, { useEffect } from 'react';
import { Shield, Clock, LogOut, CheckCircle } from 'lucide-react';

interface SessionTimeoutDialogProps {
  isOpen: boolean;
  timeRemaining: number;
  onExtend: () => void;
  onLogout: () => void;
}

const SessionTimeoutDialog: React.FC<SessionTimeoutDialogProps> = ({
  isOpen,
  timeRemaining,
  onExtend,
  onLogout,
}) => {
  useEffect(() => {
    if (isOpen) {
      // Prevent background scrolling
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgressPercentage = () => {
    return (timeRemaining / 60) * 100;
  };

  const getProgressColor = () => {
    if (timeRemaining > 30) return 'bg-green-500';
    if (timeRemaining > 10) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop with blur */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onLogout}
      />
      
      {/* Dialog */}
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Session Timeout Warning</h2>
              <p className="text-white/80 text-sm">For your security, you will be logged out soon</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Countdown Timer */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 mb-2">
              <Clock className={`w-5 h-5 ${timeRemaining <= 10 ? 'text-red-500 animate-pulse' : 'text-amber-500'}`} />
              <span className="text-sm text-gray-600 dark:text-gray-300">Time remaining:</span>
            </div>
            <div className={`text-5xl font-bold font-mono ${timeRemaining <= 10 ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
              {formatTime(timeRemaining)}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div 
                className={`h-full ${getProgressColor()} transition-all duration-100 ease-linear`}
                style={{ width: `${getProgressPercentage()}%` }}
              />
            </div>
          </div>

          {/* Info Message */}
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mb-6">
            <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
              You've been inactive for a while. To protect your account, you'll be automatically logged out when the timer reaches zero.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onLogout}
              className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 font-medium"
            >
              <LogOut className="w-5 h-5" />
              Logout Now
            </button>
            <button
              onClick={onExtend}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 font-medium"
            >
              <CheckCircle className="w-5 h-5" />
              Stay Logged In
            </button>
          </div>

          {/* Security Notice */}
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-4">
            🔒 Your security is our priority • Auto-logout protects your account
          </p>
        </div>
      </div>
    </div>
  );
};

export default SessionTimeoutDialog;
