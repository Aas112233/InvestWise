"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IDLE_SESSION_LIFETIME_MS, SHARED_ACTIVITY_STORAGE_KEY } from "@/lib/session-limits";

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
//
// Cross-tab: auth cookies (and the server session behind them) are shared by
// every tab, so idleness must be global. Each tab publishes its last input
// timestamp to localStorage; before warning or logging out, a tab confirms
// no OTHER tab has seen activity recently. Without this, an idle tab would
// revoke a session a sibling tab is actively using.

// ponytail: localStorage, not BroadcastChannel — zero setup, survives reload,
// and the storage event wakes warning tabs without polling.
function readSharedLastActivity(): number | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(SHARED_ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

function writeSharedLastActivity(ts: number = Date.now()): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(SHARED_ACTIVITY_STORAGE_KEY, String(ts));
  } catch {
    // Storage unavailable (private mode): per-tab timers still work, the
    // cross-tab guard just degrades to a same-tab check.
  }
}

/** True when another tab published input more recently than the policy. */
function isAnotherTabActive(timeoutMs: number): boolean {
  const shared = readSharedLastActivity();
  return shared !== null && Date.now() - shared < timeoutMs;
}

export function useInactivityTimeout({
  timeoutMs = IDLE_SESSION_LIFETIME_MS,
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
  // Self-restart handle: startTimer's own timeout callbacks need to re-arm
  // it, but referencing the const inside its own initializer trips
  // react-hooks/immutability. The ref always points at the latest version.
  const startTimerRef = useRef<() => void>(() => {});

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
      // Another tab may have seen input after this tab's timer was armed —
      // restarting is cheaper than logging every tab out.
      if (isAnotherTabActive(timeoutMs)) {
        startTimerRef.current();
        return;
      }
      setShowWarning(true);
      setTimeRemaining(warningDurationMs / 1000);
      const start = Date.now();
      countdownTimer.current = setInterval(() => {
        const remaining = Math.max(0, warningDurationMs - (Date.now() - start));
        setTimeRemaining(Math.ceil(remaining / 1000));
        if (remaining <= 0 && countdownTimer.current) {
          clearInterval(countdownTimer.current);
          if (isAnotherTabActive(timeoutMs)) {
            setShowWarning(false);
            setTimeRemaining(warningDurationMs / 1000);
            startTimerRef.current();
          } else {
            onLogoutRef.current();
          }
        }
      }, 100);
      warningTimer.current = setTimeout(() => {
        if (isAnotherTabActive(timeoutMs)) {
          setShowWarning(false);
          setTimeRemaining(warningDurationMs / 1000);
          startTimerRef.current();
        } else {
          onLogoutRef.current();
        }
      }, warningDurationMs);
    }, timeoutMs);
  }, [enabled, timeoutMs, warningDurationMs, clearAll]);

  useEffect(() => {
    startTimerRef.current = startTimer;
  }, [startTimer]);

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
        writeSharedLastActivity(now);
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

  // A sibling tab saw input while this tab is counting down: stand down.
  // (storage events fire only in tabs OTHER than the writer — exactly the
  // audience that needs to cancel its warning.)
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SHARED_ACTIVITY_STORAGE_KEY) return;
      setShowWarning(false);
      setTimeRemaining(warningDurationMs / 1000);
      startTimer();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [enabled, startTimer, warningDurationMs]);

  return { showWarning, timeRemaining, extendSession, logout };
}
