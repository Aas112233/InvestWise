"use client";

import { AppShell } from "@/components/layout/app-shell";
import { DepositRequestView } from "@/components/deposits";

export default function RequestDepositPage() {
  return (
    <AppShell>
      <DepositRequestView />
    </AppShell>
  );
}
