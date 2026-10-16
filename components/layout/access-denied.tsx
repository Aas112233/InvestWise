"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useLocale } from "@/lib/i18n";

/**
 * 403 screen for AppShell-wrapped routes. Rendered IN PLACE of the page when
 * the signed-in user lacks READ permission for the current screen (same
 * evaluator the sidebar uses to hide nav items). The sidebar and header stay
 * mounted so the user can navigate to screens they DO have access to.
 *
 * The gate is a UX screen, not the security boundary — every API route
 * re-checks permissions server-side (hasScreenPermission → 403), so a user
 * who bypasses this render still cannot read or move data.
 */
export function AccessDenied() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          {t("errors.forbidden.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("errors.forbidden.message")}
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("errors.forbidden.dashboard")}
        </Link>
      </div>
    </div>
  );
}
