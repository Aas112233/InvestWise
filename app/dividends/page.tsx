"use client";

import React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { DividendsView } from "@/components/dividends";

export default function DividendsPage() {
  return (
    <AppShell>
      <DividendsView />
    </AppShell>
  );
}
