"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

export default function SubscriptionInactivePage() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">
          {t("subscription.inactiveTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("subscription.inactiveMessage")}
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          {t("subscription.backToLogin")}
        </Link>
      </div>
    </div>
  );
}
