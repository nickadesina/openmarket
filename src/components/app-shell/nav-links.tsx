"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./app-shell.module.css";

export function NavLinks() {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Markets", current: pathname === "/" || pathname.startsWith("/m/") },
    { href: "/portfolio", label: "Portfolio", current: pathname === "/portfolio" },
  ];

  return (
    <nav className={styles.nav} aria-label="Primary navigation">
      {links.map(({ href, label, current }) => (
        <Link
          key={href}
          className={`${styles.navLink} ${current ? styles.navLinkActive : ""}`}
          href={href}
          aria-current={current ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
