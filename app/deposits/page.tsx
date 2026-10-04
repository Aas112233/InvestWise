"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { BulkDepositModal, DepositModal, DepositsListView, type DepositRow } from "@/components/deposits";

export default function DepositsPage() {
  const [depositOpen, setDepositOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<DepositRow | null>(null);

  return (
    <AppShell>
      <DepositsListView
        onAdd={() => setDepositOpen(true)}
        onBulk={() => setBulkOpen(true)}
        onEdit={(row) => setEditing(row)}
      />
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <DepositModal open={editing !== null} initial={editing} onClose={() => setEditing(null)} />
      <BulkDepositModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </AppShell>
  );
}
