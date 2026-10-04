"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import type { ReactNode } from "react";
import { getQueryClient } from "./query-client";
import { AuthProvider } from "./auth-context";
import { LocaleProvider } from "./i18n";

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <LocaleProvider>
          <AuthProvider>
            {children}
            <Toaster richColors closeButton position="top-right" />
          </AuthProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
