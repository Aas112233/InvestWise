"use client";

import React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PayoutsView } from "@/components/payouts";

export default function PayoutsPage() {
  return (
    <AppShell>
      <PayoutsView />
    </AppShell>
  );
}
