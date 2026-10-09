"use client";

/**
 * #50: when the backend/network disappears the app used to hang silently —
 * no error boundary, no "cannot reach server", no retry. This banner makes the
 * state explicit and self-healing: it appears on a browser offline event OR on
 * any ApiError with status 0 (network/timeout, set by lib/api-client.ts), and
 * clears itself as soon as connectivity returns or a probe succeeds.
 */
import { useCallback, useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { apiClient, isNetworkError } from "@/lib/api-client";

const PROBE_INTERVAL_MS = 15_000;

export function OfflineBanner() {
  const { t } = useLocale();
  const [offline, setOffline] = useState(false);

  const probe = useCallback(async () => {
    try {
      // A cheap, always-present endpoint. If it answers, we are back online.
      await apiClient("/health", { method: "GET" });
      setOffline(false);
    } catch (err) {
      setOffline(isNetworkError(err));
    }
  }, []);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => void probe();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    // Surface server-side outages too, not just browser-level offline.
    window.addEventListener("investwise:network-error", goOffline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("investwise:network-error", goOffline);
    };
  }, [probe]);

  // While offline, keep probing so the banner clears without a manual reload.
  useEffect(() => {
    if (!offline) return;
    const id = window.setInterval(() => void probe(), PROBE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [offline, probe]);

  if (!offline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <WifiOff className="size-3.5 flex-shrink-0" />
      <span>
        {t("common.connectionLost", {
          defaultValue: "You appear to be offline. We cannot reach the server — retrying automatically.",
        })}
      </span>
      <button
        type="button"
        onClick={() => void probe()}
        className="ml-auto rounded-md border border-amber-400/60 px-2 py-0.5 font-semibold hover:bg-amber-100/60 dark:hover:bg-amber-500/20"
      >
        {t("common.retry", { defaultValue: "Retry now" })}
      </button>
    </div>
  );
}
