"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseInactivityTimeoutOptions {
  timeoutMs?: number;
  warningDurationMs?: number;
  onLogout: () => void;
  enabled?: boolean;
}

interface UseInactivityTimeoutReturn {
  showWarning: boolean;
  timeRemaining: number;
  extendSession: () => void;
  logout: () => void;
}

// Behavioral port of client/hooks/useInactivityTimeout.ts: warn after
// `timeoutMs` of inactivity, count down `warningDurationMs`, then log out.
export function useInactivityTimeout({
  timeoutMs = 30 * 60 * 1000,
  warningDurationMs = 60 * 1000,
  onLogout,
  enabled = true,
}: UseInactivityTimeoutOptions): UseInactivityTimeoutReturn {
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(warningDurationMs / 1000);

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  const clearAll = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (warningTimer.current) clearTimeout(warningTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    inactivityTimer.current = null;
    warningTimer.current = null;
    countdownTimer.current = null;
  }, []);

  const startTimer = useCallback(() => {
    if (!enabled) return;
    clearAll();
    setShowWarning(false);
    inactivityTimer.current = setTimeout(() => {
      setShowWarning(true);
      setTimeRemaining(warningDurationMs / 1000);
      const start = Date.now();
      countdownTimer.current = setInterval(() => {
        const remaining = Math.max(0, warningDurationMs - (Date.now() - start));
        setTimeRemaining(Math.ceil(remaining / 1000));
        if (remaining <= 0 && countdownTimer.current) {
          clearInterval(countdownTimer.current);
          onLogoutRef.current();
        }
      }, 100);
      warningTimer.current = setTimeout(() => {
        onLogoutRef.current();
      }, warningDurationMs);
    }, timeoutMs);
  }, [enabled, timeoutMs, warningDurationMs, clearAll]);

  const extendSession = useCallback(() => {
    setShowWarning(false);
    setTimeRemaining(warningDurationMs / 1000);
    startTimer();
  }, [warningDurationMs, startTimer]);

  const logout = useCallback(() => {
    clearAll();
    onLogoutRef.current();
  }, [clearAll]);

  useEffect(() => {
    if (!enabled) {
      clearAll();
      return;
    }
    const events = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "mousemove",
      "keypress",
      "wheel",
    ];
    let lastActivity = Date.now();
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivity >= 1000) {
        lastActivity = now;
        startTimer();
      }
    };
    for (const event of events) {
      window.addEventListener(event, handleActivity, { passive: true });
    }
    startTimer();
    return () => {
      clearAll();
      for (const event of events) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, [enabled, startTimer, clearAll]);

  return { showWarning, timeRemaining, extendSession, logout };
}
