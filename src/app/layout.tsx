import type { Metadata, Viewport } from "next";
import { Archivo_Black, Noto_Sans, Roboto_Condensed } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell/app-shell.js";
import "./globals.css";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto",
});

const robotoCondensed = Roboto_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-cond",
});

const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-brand-face",
});

export const metadata: Metadata = {
  title: {
    default: "OpenMarket",
    template: "%s | OpenMarket",
  },
  description: "A published index of private-company fund marks, built only from public filings.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${notoSans.variable} ${robotoCondensed.variable} ${archivoBlack.variable}`}
    >
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
