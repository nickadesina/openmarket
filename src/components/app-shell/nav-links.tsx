"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./app-shell.module.css";

export function NavLinks() {
  const pathname = usePathname();
  const marketsCurrent = pathname === "/" || pathname.startsWith("/m/");
  const portfolioCurrent = pathname === "/portfolio";

  return (
    <nav className={styles.nav} aria-label="Primary navigation">
      <Link
        className={`${styles.navLink} ${marketsCurrent ? styles.navLinkActive : ""}`}
        href="/"
        aria-current={marketsCurrent ? "page" : undefined}
      >
        Markets
      </Link>
      <Link
        className={`${styles.navLink} ${portfolioCurrent ? styles.navLinkActive : ""}`}
        href="/portfolio"
        aria-current={portfolioCurrent ? "page" : undefined}
      >
        Portfolio
      </Link>
    </nav>
  );
}
