"use client";

import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ApiClientError } from "../../lib/client/api.js";

const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry(failureCount, error) {
        if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 1;
      },
      staleTime: 3_000,
    },
    mutations: {
      retry: false,
    },
  },
};

export function QueryProvider({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient(queryClientConfig));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
