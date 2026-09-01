"use client";

import { useEffect, useRef, type SyntheticEvent } from "react";

import styles from "./company-logo.module.css";

const IMAGE_ATTRIBUTES = { sm: 17, md: 22, lg: 30 } as const;

function hideBrokenLogo(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
}

export function CompanyLogo({
  name,
  logoPath,
  size,
}: {
  readonly name: string;
  readonly logoPath: string;
  readonly size: "sm" | "md" | "lg";
}) {
  const dimension = IMAGE_ATTRIBUTES[size];
  const imageNode = useRef<HTMLImageElement>(null);

  // A missing logo on a server-rendered page can 404 before hydration
  // attaches onError; re-check the settled state once mounted.
  useEffect(() => {
    const image = imageNode.current;
    if (image !== null && image.complete && image.naturalWidth === 0) {
      image.hidden = true;
    }
  }, [logoPath]);

  return (
    <span className={`${styles.frame} ${styles[size]}`} aria-hidden="true">
      <img
        ref={imageNode}
        className={styles.logo}
        src={logoPath}
        alt=""
        width={dimension}
        height={dimension}
        onError={hideBrokenLogo}
      />
      {/* Initials only stand in for a broken mark; they never sit behind one. */}
      <span className={styles.fallback}>{name.slice(0, 2).toUpperCase()}</span>
    </span>
  );
}
