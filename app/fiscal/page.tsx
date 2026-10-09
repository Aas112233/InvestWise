"use client";

import { AppShell } from "@/components/layout/app-shell";
import { FiscalPeriodsView } from "@/components/fiscal/fiscal-periods-view";

export default function FiscalPage() {
  return (
    <AppShell>
      <FiscalPeriodsView />
    </AppShell>
  );
}
