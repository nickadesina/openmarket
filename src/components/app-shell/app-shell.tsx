import Link from "next/link";
import type { ReactNode } from "react";

import { AccountControl } from "./account-control.js";
import { NavLinks } from "./nav-links.js";
import styles from "./app-shell.module.css";

export function AppShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="OpenMarket home">
            <span className={styles.brandMark} aria-hidden="true">
              OM
            </span>
            <span className={styles.brandName}>OpenMarket</span>
          </Link>
          <NavLinks />
          <div className={styles.accountSlot}>
            <AccountControl />
          </div>
        </div>
      </header>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
