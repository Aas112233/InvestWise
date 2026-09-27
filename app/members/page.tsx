"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MembersListView } from "@/components/members";

export default function MembersPage() {
  return (
    <AppShell>
      <MembersListView />
    </AppShell>
  );
}
