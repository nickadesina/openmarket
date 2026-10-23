"use client";

import Image from "next/image";
import { type SyntheticEvent, useEffect, useRef } from "react";

import styles from "./company-logo.module.css";

const IMAGE_ATTRIBUTES = { sm: 17, md: 22, lg: 30 } as const;

function hideBrokenLogo(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true;
}

function showLoadedLogo(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = false;
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
    if (image !== null && image.getAttribute("src") === logoPath) {
      image.hidden = image.complete && image.naturalWidth === 0;
    }
  }, [logoPath]);

  return (
    <span className={`${styles.frame} ${styles[size]}`} aria-hidden="true">
      <Image
        unoptimized
        // Small static marks beside a name: load with the row, as the <img> did.
        loading="eager"
        ref={imageNode}
        className={styles.logo}
        src={logoPath}
        alt=""
        width={dimension}
        height={dimension}
        onError={hideBrokenLogo}
        onLoad={showLoadedLogo}
      />
      {/* Initials only stand in for a broken mark; they never sit behind one. */}
      <span className={styles.fallback}>{name.slice(0, 2).toUpperCase()}</span>
    </span>
  );
}
