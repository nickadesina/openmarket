import type { Metadata } from "next";
import Link from "next/link";

import { REF_CACHE_SECONDS } from "../../lib/api/ref-route.js";
import { DEFAULT_KEY_QUOTA_PER_MINUTE, DESIGN_PARTNER_KEY_DAYS } from "../../lib/auth/api-key.js";
import { RULEBOOK_VERSION } from "../../lib/engine/rulebook.js";
import { RATE_LIMIT_POLICIES } from "../../lib/services/rate-limit.js";
import { ENVELOPE_FIELDS, REF_ROUTES, type RouteDoc } from "../../lib/tradeables/ref-docs.js";
import styles from "./page.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Reference API",
  description:
    "OpenMarket's reference API, versioned and public: routes, fields, quotas and how to cite a payload.",
  robots: { index: false, follow: false },
};

function Fields({ fields }: { readonly fields: Readonly<Record<string, string>> }) {
  return (
    <dl className={styles.fields}>
      {Object.entries(fields).map(([name, text]) => (
        <div key={name}>
          <dt>
            <code>{name}</code>
          </dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Route({ route }: { readonly route: RouteDoc }) {
  return (
    <section className={styles.route} id={route.id} aria-labelledby={`${route.id}-head`}>
      <h3 id={`${route.id}-head`}>
        <code>GET {route.path}</code>
      </h3>
      <p>{route.summary}</p>
      {route.query.length > 0 ? (
        <>
          <h4 className={styles.minorHead}>Query</h4>
          <Fields fields={Object.fromEntries(route.query)} />
        </>
      ) : null}
      <h4 className={styles.minorHead}>Fields, after the envelope</h4>
      <Fields
        fields={Object.fromEntries(
          Object.entries(route.fields).filter(([name]) => !(name in ENVELOPE_FIELDS)),
        )}
      />
    </section>
  );
}

export default function RefPage() {
  const publicQuota = RATE_LIMIT_POLICIES.ref.limit;
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Reference API</p>
        <h1>The reference API, versioned and public</h1>
        <p>
          Every payload carries the versions that produced it, so it can be cited and reproduced.
          JSON over HTTPS, no key needed to start. The index's routes are not built yet; the
          rulebook is published now.
        </p>
        <p className={styles.links}>
          <a className={styles.link} href="#routes">
            Routes
          </a>
          <a className={styles.link} href="#access">
            Access and quotas
          </a>
          <a className={styles.link} href="#cite">
            How to cite
          </a>
        </p>
      </header>

      <section className={styles.section} aria-labelledby="envelope">
        <h2 className={styles.sectionLabel} id="envelope">
          The envelope
        </h2>
        <p>Every payload opens with the same fields.</p>
        <Fields fields={ENVELOPE_FIELDS} />
        <p className={styles.muted}>
          Live now: rulebook{" "}
          <Link className={styles.link} href="/rulebook">
            {RULEBOOK_VERSION}
          </Link>
          .
        </p>
      </section>

      <section className={styles.section} aria-labelledby="routes">
        <h2 className={styles.sectionLabel} id="routes">
          Routes
        </h2>
        <p>
          Every route is <code>GET</code>, read-only and answers JSON. Times are in UTC ISO 8601.
        </p>
        {REF_ROUTES.map((route) => (
          <Route key={route.path} route={route} />
        ))}
      </section>

      <section className={styles.section} aria-labelledby="access">
        <h2 className={styles.sectionLabel} id="access">
          Access and quotas
        </h2>
        <ul className={styles.list}>
          <li>
            Public: {publicQuota} requests a minute per network, no key. Responses are cached for{" "}
            {REF_CACHE_SECONDS} seconds.
          </li>
          <li>
            Keyed: send <code>Authorization: Bearer &lt;key&gt;</code>. A key draws on its own quota
            ({DEFAULT_KEY_QUOTA_PER_MINUTE} a minute by default) instead of the network's, and its
            responses are private, never shared-cached.
          </li>
          <li>
            Design-partner keys are free and expire {DESIGN_PARTNER_KEY_DAYS} days after they are
            issued.
          </li>
          <li>
            Errors share one envelope, <code>{"{ error: { code, message, details } }"}</code>.{" "}
            <code>401 API_KEY_INVALID</code> for an unknown or revoked key,{" "}
            <code>401 API_KEY_EXPIRED</code> past a key's expiry (the message names it),{" "}
            <code>429 RATE_LIMITED</code> with <code>Retry-After</code>, and{" "}
            <code>400 INVALID_INPUT</code> for an unknown query parameter.
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="cite">
        <h2 className={styles.sectionLabel} id="cite">
          How to cite
        </h2>
        <p>
          Cite the route, the payload's <code>as_of</code> and the versions it carries. Attribute it
          to OpenMarket.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="data">
        <h2 className={styles.sectionLabel} id="data">
          Data
        </h2>
        <ul className={styles.list}>
          <li>
            Round history, every priced round with its source:{" "}
            <a className={styles.link} href="/data/round-history.csv">
              CSV
            </a>
            ,{" "}
            <a className={styles.link} href="/data/round-history.json">
              JSON
            </a>
            .
          </li>
          <li>
            The settlement rulebook:{" "}
            <Link className={styles.link} href="/rulebook">
              /rulebook
            </Link>
            .
          </li>
        </ul>
        <p className={styles.muted}>Datasets: CC BY 4.0, cite OpenMarket.</p>
      </section>
    </article>
  );
}
