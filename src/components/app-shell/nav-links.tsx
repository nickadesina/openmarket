"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import styles from "./app-shell.module.css";

export function NavLinks() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // At phone width the links scroll sideways; keep the current section in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the active link changes with the route, which the DOM query cannot see.
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav === null || current == null) return;
    const overflow = current.getBoundingClientRect().right - nav.getBoundingClientRect().right;
    if (overflow > 0) nav.scrollLeft += overflow;
  }, [pathname]);
  const links = [
    { href: "/", label: "Markets", current: pathname === "/" || pathname.startsWith("/m/") },
    { href: "/portfolio", label: "Portfolio", current: pathname === "/portfolio" },
    {
      href: "/t",
      label: "Tournament",
      current: pathname === "/t" || pathname.startsWith("/t/"),
    },
  ];

  return (
    <nav ref={navRef} className={styles.nav} aria-label="Primary navigation">
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
