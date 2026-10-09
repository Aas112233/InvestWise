"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Unsaved-changes guard (report issue 7).
 *
 * Manual testers lost everything they had typed when a dialog was dismissed,
 * the route changed, or the tab was reloaded — there was no draft persistence
 * and no "you have unsaved changes" prompt anywhere in the app. This hook
 * gives a form a single source of truth for that protection:
 *
 *  - `requestClose(next)` — call instead of closing directly. Runs the real
 *    close when the form is pristine (or already confirmed); otherwise shows
 *    the confirm dialog first.
 *  - `confirmDiscard()` / `cancelDiscard()` — the two dialog outcomes.
 *  - Registers a `beforeunload` handler while dirty so a reload/close of the
 *    tab triggers the browser's native prompt.
 *  - `markSaved()` — call after a successful submit so the guard releases.
 *
 * The hook deliberately does NOT track a snapshot of the form: a form that
 * has been touched at all is "dirty" until it reports success. That is the
 * conservative direction — a false prompt is far cheaper than silent data
 * loss (§12: this system moves real money).
 */
export function useUnsavedChangesGuard() {
  const [isDirty, setIsDirty] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const pendingClose = useRef<(() => void) | null>(null);
  // Mirrors `isDirty` for the unload handler, which must read the latest value
  // without being re-registered on every keystroke.
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      // Legacy browsers require returnValue to be set; modern ones show a
      // generic message and ignore any custom string.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /** Mark the form as having unsaved input. Safe to call on every change. */
  const markDirty = useCallback(() => setIsDirty(true), []);

  /** Mark the form as clean — call after a successful submit. */
  const markSaved = useCallback(() => {
    setIsDirty(false);
    setIsConfirming(false);
    pendingClose.current = null;
  }, []);

  /**
   * Gate a close. If the form is clean, closes immediately; otherwise opens
   * the confirm dialog and defers the real close until the user chooses.
   */
  const requestClose = useCallback((next: () => void) => {
    if (!isDirtyRef.current) {
      next();
      return;
    }
    pendingClose.current = next;
    setIsConfirming(true);
  }, []);

  /** User confirmed discarding — run the deferred close. */
  const confirmDiscard = useCallback(() => {
    const next = pendingClose.current;
    pendingClose.current = null;
    setIsDirty(false);
    setIsConfirming(false);
    next?.();
  }, []);

  /** User chose to keep editing — drop the deferred close. */
  const cancelDiscard = useCallback(() => {
    pendingClose.current = null;
    setIsConfirming(false);
  }, []);

  return {
    isDirty,
    isConfirming,
    markDirty,
    markSaved,
    requestClose,
    confirmDiscard,
    cancelDiscard,
  };
}
