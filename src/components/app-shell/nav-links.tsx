"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import styles from "./app-shell.module.css";

function within(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

export function NavLinks() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // At phone width the links scroll sideways; keep the current section in view,
  // also when the strip resizes.
  useEffect(() => {
    const nav = navRef.current;
    if (nav === null) return;
    const reveal = () => {
      const current = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a")).find((link) =>
        within(pathname, new URL(link.href).pathname),
      );
      if (current === undefined) return;
      const strip = nav.getBoundingClientRect();
      const link = current.getBoundingClientRect();
      if (link.left < strip.left) nav.scrollLeft -= strip.left - link.left;
      else if (link.right > strip.right) nav.scrollLeft += link.right - strip.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname]);
  const links = [
    {
      href: "/",
      label: "Index",
      current: pathname === "/" || within(pathname, "/n"),
    },
    { href: "/methodology", label: "Methodology", current: within(pathname, "/methodology") },
    { href: "/rulebook", label: "Rulebook", current: within(pathname, "/rulebook") },
    { href: "/ref", label: "API", current: within(pathname, "/ref") },
    { href: "/corrections", label: "Corrections", current: within(pathname, "/corrections") },
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
