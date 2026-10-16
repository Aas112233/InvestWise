"use client";

import { AppShell } from "@/components/layout/app-shell";
import { DeletedTransactionsView } from "@/components/transactions";

export default function DeletedTransactionsPage() {
  return (
    <AppShell>
      <DeletedTransactionsView />
    </AppShell>
  );
}
