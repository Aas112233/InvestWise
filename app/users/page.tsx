"use client";

import { AppShell } from "@/components/layout/app-shell";
import { UsersListView } from "@/components/users/users-list-view";

export default function UsersPage() {
  return (
    <AppShell>
      <UsersListView />
    </AppShell>
  );
}
