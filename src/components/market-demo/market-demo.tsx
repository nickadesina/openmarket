import Link from "next/link";

import styles from "./market-demo.module.css";

/**
 * Decision 0005: the listed names trade on paper, and their activity comes
 * from five labelled demo accounts. The board and every market page say so,
 * and point to the tournament, where forecasts count.
 */
export function DemoBanner() {
  return (
    // A labelled region, not a note: the market page keeps `note` for the
    // restricted-person reason, which stands in for the ticket.
    <section className={styles.banner} aria-label="Demo markets">
      <strong className={styles.label}>Demo markets</strong>
      <p>
        These are paper demo markets. Trades tagged Demo come from five demo accounts, to show how
        the markets work. Forecasts count in the tournament.
      </p>
      <Link className={styles.link} href="/t">
        Go to the tournament
      </Link>
    </section>
  );
}

/**
 * The tag on every row a demo account wrote. A `small`, not a `span`, so a
 * tape's own span rules (muted metadata) never restyle it.
 */
export function DemoTag() {
  return (
    <small className={styles.tag}>
      Demo<span className={styles.visuallyHidden}> account</span>
    </small>
  );
}
