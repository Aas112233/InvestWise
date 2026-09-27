"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { BulkDepositModal, DepositModal, DepositsListView } from "@/components/deposits";

export default function DepositsPage() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  return (
    <AppShell>
      <DepositsListView onAdd={() => setDepositOpen(true)} onBulk={() => setBulkOpen(true)} />
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <BulkDepositModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </AppShell>
  );
}
