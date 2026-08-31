import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell/app-shell.js";
import { QueryProvider } from "../components/providers/query-provider.js";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "OpenMarket",
    template: "%s | OpenMarket",
  },
  description:
    "Paper-money markets for evaluating private-company valuation expectations.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "oklch(0.105 0 0)",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <AppShell>{children}</AppShell>
        </QueryProvider>
      </body>
    </html>
  );
}
