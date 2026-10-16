"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { useLocale } from "@/lib/i18n";

/**
 * 404 screen — fires automatically for unknown routes and any notFound()
 * call. Renders inside the root layout (theme tokens available) but outside
 * AppShell, so it is a standalone centered card like the subscription-blocked
 * screen. Without this file Next falls back to its unstyled default 404 with
 * no way back into the app.
 */
export default function NotFound() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Compass className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          {t("errors.notFound.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("errors.notFound.message")}
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("errors.notFound.dashboard")}
        </Link>
      </div>
    </div>
  );
}
