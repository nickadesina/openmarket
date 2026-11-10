import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "../../lib/client/format.js";
import { ARCHIVE_AS_OF_ISO, CURRENT_SITE_URL } from "../../lib/config/archive.js";
import styles from "./app-shell.module.css";
import { NavLinks } from "./nav-links.js";

export function AppShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="OpenMarket home">
            <span className={styles.brandName}>OpenMarket</span>
          </Link>
          <NavLinks />
          <div className={styles.accountSlot}>
            <a className={styles.archiveMark} href={CURRENT_SITE_URL}>
              Archived v1
            </a>
          </div>
        </div>
      </header>
      <p className={styles.archiveBanner}>
        <span className={styles.archiveBannerLead}>Archive</span>
        <span>
          OpenMarket v1, frozen at its last dealer run on {formatDate(ARCHIVE_AS_OF_ISO)}. Quotes,
          positions and forecasts are as they stood then; trading, sign-in and forecasting are
          closed.
        </span>
        <a className={styles.archiveBannerLink} href={CURRENT_SITE_URL}>
          Current OpenMarket
        </a>
      </p>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className={styles.footer}>
        <span className={styles.footerCopyright}>© {new Date().getFullYear()} OpenMarket</span>
        <span className={styles.footerDisclosure}>
          Paper trading only. Not real money. No purchases or withdrawals.
        </span>
        <a className={styles.footerLink} href={CURRENT_SITE_URL}>
          openmarket.systems
        </a>
      </footer>
    </div>
  );
}
