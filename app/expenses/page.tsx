"use client";

import React from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ExpensesView } from "@/components/expenses";

export default function ExpensesPage() {
  return (
    <AppShell>
      <ExpensesView />
    </AppShell>
  );
}
