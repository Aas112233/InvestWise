"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { useLocale } from "@/lib/i18n";

/**
 * Route-segment error boundary (issue #55). Unlike global-error.tsx this renders
 * INSIDE the root layout, so Tailwind tokens, the app's Button and the i18n
 * provider are available. It catches render/data errors in any page below the
 * root and keeps the shell (sidebar, header) interactive instead of blanking
 * the whole app.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error("[PAGE ERROR]", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h2 className="text-sm font-semibold tracking-tight text-foreground">
        {t("errors.page.title")}
      </h2>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        {t("errors.page.message")}
      </p>
      {error.digest && (
        <p className="font-mono text-[10px] text-muted-foreground/70">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => reset()} icon={RotateCcw}>
          {t("errors.page.retry")}
        </Button>
      </div>
    </div>
  );
}
