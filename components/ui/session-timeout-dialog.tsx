"use client";

import { CheckCircle, Clock, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface SessionTimeoutDialogProps {
  isOpen: boolean;
  timeRemaining: number;
  totalWarningSeconds?: number;
  onExtend: () => void | Promise<void>;
  onLogout: () => void | Promise<void>;
}

// Session timeout dialog styled to match Pathshala-Pro design system
// - Portaled to document.body at top-level z-index (z-[9999])
// - High-contrast dark backdrop scrim (bg-black/70 dark:bg-black/85) preventing layout lines from bleeding through
export function SessionTimeoutDialog({
  isOpen,
  timeRemaining,
  totalWarningSeconds = 60,
  onExtend,
  onLogout,
}: SessionTimeoutDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [isExtending, setIsExtending] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!mounted || !isOpen || typeof document === "undefined") return null;

  const handleExtend = async () => {
    if (isExtending || isLoggingOut) return;
    setIsExtending(true);
    try {
      await onExtend();
    } finally {
      setIsExtending(false);
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut || isExtending) return;
    setIsLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = Math.max(0, Math.min(100, (timeRemaining / totalWarningSeconds) * 100));
  const progressColor =
    timeRemaining > 30 ? "bg-emerald-500" : timeRemaining > 10 ? "bg-amber-500" : "bg-destructive";

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Dark scrim backdrop */}
      <div
        className="fixed inset-0 bg-black/70 dark:bg-black/85 backdrop-blur-sm animate-in fade-in-50"
        onClick={handleLogout}
        aria-hidden="true"
      />
      <div className="relative z-[10000] bg-card text-card-foreground rounded-2xl shadow-2xl max-w-md w-full mx-auto overflow-hidden border border-border/80 animate-in fade-in-50 zoom-in-95 duration-150">
        <div className="border-b border-border/80 p-6 bg-muted/20">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl flex items-center justify-center shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground tracking-tight">Session Timeout Warning</h2>
              <p className="text-muted-foreground text-xs mt-0.5">
                For your security, you will be logged out soon
              </p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="text-center mb-5">
            <div className="inline-flex items-center gap-2 mb-1.5">
              <Clock
                size={16}
                className={timeRemaining <= 10 ? "text-destructive animate-pulse" : "text-amber-500"}
              />
              <span className="text-xs font-medium text-muted-foreground">Time remaining:</span>
            </div>
            <div
              className={`text-4xl font-bold font-mono tracking-tight ${
                timeRemaining <= 10 ? "text-destructive" : "text-foreground"
              }`}
            >
              {formatTime(timeRemaining)}
            </div>
          </div>
          <div className="mb-5">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${progressColor} transition-all duration-100 ease-linear rounded-full`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="bg-muted/40 rounded-xl p-3.5 mb-5 border border-border/60">
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              You have been inactive for a while. To protect financial records, you will be
              automatically logged out when the timer expires.
            </p>
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut || isExtending}
              className="flex-1 px-3 py-2.5 border border-border/80 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 text-xs font-semibold"
            >
              {isLoggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
              {isLoggingOut ? "Signing out…" : "Sign Out"}
            </button>
            <button
              type="button"
              onClick={handleExtend}
              disabled={isExtending || isLoggingOut}
              className="flex-1 px-3 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs flex items-center justify-center gap-1.5 text-xs font-semibold"
            >
              {isExtending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle size={14} />
              )}
              {isExtending ? "Extending…" : "Stay Signed In"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
