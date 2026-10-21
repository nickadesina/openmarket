import Link from "next/link";

import { formatForecasterName } from "../../lib/client/format.js";
import { forecasterHref } from "../../lib/client/tournament.js";
import type { PublicIdentity } from "../../lib/services/tournament/records.js";
import styles from "./forecaster-name.module.css";

/**
 * A forecaster as every tournament surface shows them: the name linking to
 * their profile, their self-reported affiliation in quiet type, and the
 * flag marker when an admin has excluded them from the crowd.
 */
export function ForecasterName({
  identity,
  xLink = false,
}: {
  readonly identity: Pick<
    PublicIdentity,
    "handle" | "provider" | "profileSlug" | "affiliation" | "flagged"
  >;
  /** Adds a small link to the X profile, for X accounts only. */
  readonly xLink?: boolean;
}) {
  const name = formatForecasterName(identity);
  return (
    <span className={styles.name}>
      <Link className={styles.link} href={forecasterHref(identity)}>
        {name}
      </Link>
      {identity.affiliation === null ? null : (
        <span className={styles.affiliation} title="Self-reported affiliation">
          {identity.affiliation}
        </span>
      )}
      {xLink && identity.provider === "x" ? (
        <a
          className={styles.xLink}
          href={`https://x.com/${identity.handle}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${name} on X`}
        >
          X
        </a>
      ) : null}
      {identity.flagged ? (
        <span className={styles.flag} title="Flagged: excluded from the crowd aggregate">
          Flagged
        </span>
      ) : null}
    </span>
  );
}
