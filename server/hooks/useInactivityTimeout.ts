import { useEffect, useState, useCallback, useRef } from 'react';

interface UseInactivityTimeoutOptions {
  timeoutMs: number;        // Time before warning (default: 2 minutes)
  warningDurationMs: number; // Warning duration (default: 60 seconds)
  onLogout: () => void;     // Logout callback
  enabled: boolean;         // Enable/disable hook
}

interface UseInactivityTimeoutReturn {
  isActive: boolean;
  showWarning: boolean;
  timeRemaining: number;    // Seconds remaining
  resetTimer: () => void;
  extendSession: () => void;
  logout: () => void;
}

/**
 * Hook to track user inactivity and auto-logout with warning
 * @param options - Configuration options
 * @returns Control functions and state
 */
export const useInactivityTimeout = ({
  timeoutMs = 2 * 60 * 1000,      // 2 minutes
  warningDurationMs = 60 * 1000,  // 60 seconds warning
  onLogout,
  enabled = true,
}: UseInactivityTimeoutOptions): UseInactivityTimeoutReturn => {
  const [isActive, setIsActive] = useState(true);
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(warningDurationMs / 1000);
  
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Clear all timers
  const clearAllTimers = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);
  
  // Start inactivity timer
  const startInactivityTimer = useCallback(() => {
    if (!enabled) return;
    
    clearAllTimers();
    setIsActive(true);
    setShowWarning(false);
    
    inactivityTimerRef.current = setTimeout(() => {
      // Show warning
      setShowWarning(true);
      setTimeRemaining(warningDurationMs / 1000);
      
      // Start countdown
      const startTime = Date.now();
      countdownTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, warningDurationMs - elapsed);
        setTimeRemaining(Math.ceil(remaining / 1000));
        
        if (remaining <= 0) {
          clearInterval(countdownTimerRef.current!);
          onLogout();
        }
      }, 100);
      
      // Auto logout after warning duration
      warningTimerRef.current = setTimeout(() => {
        onLogout();
      }, warningDurationMs);
      
    }, timeoutMs);
  }, [enabled, timeoutMs, warningDurationMs, onLogout, clearAllTimers]);
  
  // Reset timer (called on user activity)
  const resetTimer = useCallback(() => {
    if (!enabled) return;
    startInactivityTimer();
  }, [enabled, startInactivityTimer]);
  
  // Extend session (user clicked "Stay Logged In")
  const extendSession = useCallback(() => {
    setShowWarning(false);
    setTimeRemaining(warningDurationMs / 1000);
    startInactivityTimer();
  }, [warningDurationMs, startInactivityTimer]);
  
  // Manual logout
  const logout = useCallback(() => {
    clearAllTimers();
    onLogout();
  }, [clearAllTimers, onLogout]);
  
  // Track user activity events
  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      return;
    }
    
    // Events that indicate user activity
    const events = [
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'mousemove',
      'keypress',
      'wheel',
    ];
    
    // Throttled event handler
    let lastActivity = Date.now();
    const handleActivity = () => {
      const now = Date.now();
      // Only reset timer if at least 1 second since last activity
      if (now - lastActivity >= 1000) {
        lastActivity = now;
        resetTimer();
      }
    };
    
    // Add event listeners
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });
    
    // Start timer
    startInactivityTimer();
    
    // Cleanup
    return () => {
      clearAllTimers();
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [enabled, startInactivityTimer, resetTimer, clearAllTimers]);
  
  return {
    isActive,
    showWarning,
    timeRemaining,
    resetTimer,
    extendSession,
    logout,
  };
};

export default useInactivityTimeout;
