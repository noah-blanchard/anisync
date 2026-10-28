"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "@/lib/client-api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: true,
            retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
