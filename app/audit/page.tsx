"use client";

import { AppShell } from "@/components/layout/app-shell";
import { AuditLogsView } from "@/components/audit";

export default function AuditPage() {
  return (
    <AppShell>
      <AuditLogsView />
    </AppShell>
  );
}
