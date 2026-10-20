"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import type { ReactNode } from "react";
import { getQueryClient } from "./query-client";
import { AuthProvider } from "./auth-context";
import { LocaleProvider } from "./i18n";
import { FiscalYearProvider } from "./fiscal-year-context";

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <LocaleProvider>
          <AuthProvider>
            {/* Above the pages, so the header's fiscal-year selection survives
                navigation: AppShell remounts per route, the selection must not. */}
            <FiscalYearProvider>
              {children}
              <Toaster richColors closeButton position="top-right" />
            </FiscalYearProvider>
          </AuthProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
