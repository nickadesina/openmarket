import type { Metadata } from "next";
import Link from "next/link";

import examples from "../../../docs/tradeables/ref-examples.json";
import { REF_CACHE_SECONDS } from "../../lib/api/ref-route.js";
import { DEFAULT_KEY_QUOTA_PER_MINUTE, DESIGN_PARTNER_KEY_DAYS } from "../../lib/auth/api-key.js";
import { METHODOLOGY_VERSION } from "../../lib/engine/index/methodology.js";
import { RULEBOOK_VERSION } from "../../lib/engine/rulebook.js";
import { LAG_NOTE } from "../../lib/services/index/ref-envelope.js";
import { RATE_LIMIT_POLICIES } from "../../lib/services/rate-limit.js";
import {
  ATTRIBUTION,
  DATA_LICENSE_PATH,
  DATASETS,
  ENVELOPE_FIELDS,
  REF_ROUTES,
  type RouteDoc,
} from "../../lib/tradeables/ref-docs.js";
import styles from "./page.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Reference API",
  description:
    "OpenMarket's reference API and datasets: the marks index as JSON and CSV, versioned, public, CC BY 4.0.",
};

interface Example {
  readonly request: string;
  readonly response: unknown;
  readonly cuts: readonly { readonly path: string; readonly length: number }[];
}

const EXAMPLES: Readonly<Record<string, Example>> = examples.examples;

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

function ExampleBlock({ example }: { readonly example: Example }) {
  return (
    <details className={styles.example}>
      <summary>
        Example: <code>{example.request}</code>
      </summary>
      <pre className={styles.payload}>
        <code>{JSON.stringify(example.response, null, 2)}</code>
      </pre>
      {example.cuts.length > 0 ? (
        <p className={styles.muted}>
          Cut for reading:{" "}
          {example.cuts.map((cut, index) => (
            <span key={cut.path}>
              {index > 0 ? "; " : ""}
              <code>{cut.path}</code> ({cut.length})
            </span>
          ))}
          .
        </p>
      ) : null}
    </details>
  );
}

function Route({ route }: { readonly route: RouteDoc }) {
  const example = route.example === undefined ? undefined : EXAMPLES[route.example];
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
      {example === undefined ? null : <ExampleBlock example={example} />}
    </section>
  );
}

export default function RefPage() {
  const publicQuota = RATE_LIMIT_POLICIES.ref.limit;
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Reference API</p>
        <h1>The marks index as data</h1>
        <p>
          Every filer mark OpenMarket reads, with the filing it came from, and every figure derived
          from them, as JSON and CSV. Every payload carries the versions that produced it, so it can
          be cited and recomputed. No key needed to start.
        </p>
        <p className={styles.links}>
          <a className={styles.link} href="#routes">
            Routes
          </a>
          <a className={styles.link} href="#data">
            Datasets
          </a>
          <a className={styles.link} href="#access">
            Keys and quotas
          </a>
          <a className={styles.link} href="#licence">
            Licence and citation
          </a>
        </p>
      </header>

      <section className={styles.section} aria-labelledby="envelope">
        <h2 className={styles.sectionLabel} id="envelope">
          The envelope
        </h2>
        <p>Every payload opens with the same fields, in this order.</p>
        <Fields fields={ENVELOPE_FIELDS} />
        <p className={styles.muted}>{LAG_NOTE}</p>
        <p className={styles.muted}>
          Live now: methodology{" "}
          <Link className={styles.link} href="/methodology">
            {METHODOLOGY_VERSION}
          </Link>
          , rulebook{" "}
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
          Every route is <code>GET</code>, read-only and answers JSON. Dates are ISO 8601; times are
          UTC. Money is USD; figures as filed are decimal strings, derived figures are numbers. A
          name&apos;s <code>{"{slug}"}</code> is its slug in <code>/api/ref/names</code>. The
          examples were generated from the development database with{" "}
          <code>npm run export:ref-examples</code> on {examples.generated_at.slice(0, 10)}.
        </p>
        {REF_ROUTES.map((route) => (
          <Route key={route.path} route={route} />
        ))}
      </section>

      <section className={styles.section} aria-labelledby="data">
        <h2 className={styles.sectionLabel} id="data">
          Datasets
        </h2>
        <p>
          CSV generated from the tables on each request (cached {REF_CACHE_SECONDS} seconds), UTF-8,
          RFC 4180 quoting, with a header row. Every row carries its document&apos;s accession and
          URL. The versions the rows were produced under come as <code>OpenMarket-*</code> response
          headers, and a <code>Link</code> header points to the licence.
        </p>
        <ul className={styles.list}>
          {DATASETS.map((dataset) => (
            <li key={dataset.path}>
              <a className={styles.link} href={dataset.path}>
                {dataset.path}
              </a>
              : {dataset.summary}
              {dataset.query.map(([name, text]) => (
                <span key={name}>
                  {" "}
                  <code>{name}</code>: {text}
                </span>
              ))}
            </li>
          ))}
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
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="access">
        <h2 className={styles.sectionLabel} id="access">
          Keys and quotas
        </h2>
        <ul className={styles.list}>
          <li>
            Public: {publicQuota} requests a minute per network, no key, for the routes and the
            datasets alike. Responses are cached for {REF_CACHE_SECONDS} seconds.
          </li>
          <li>
            Keyed: send <code>Authorization: Bearer &lt;key&gt;</code>. A key draws on its own quota
            ({DEFAULT_KEY_QUOTA_PER_MINUTE} a minute by default) instead of the network&apos;s, and
            its responses are private, never shared-cached. Keys are issued by OpenMarket (
            <code>npm run api-key:create</code>); only a hash of the key is stored.
          </li>
          <li>
            Design-partner keys are free and expire {DESIGN_PARTNER_KEY_DAYS} days after they are
            issued.
          </li>
          <li>
            Errors share one envelope, <code>{"{ error: { code, message, details } }"}</code>:{" "}
            <code>404 NAME_NOT_FOUND</code> for an unknown slug, <code>400 INVALID_INPUT</code> for
            an unknown or malformed query parameter or cursor, <code>401 API_KEY_INVALID</code> for
            an unknown or revoked key, <code>401 API_KEY_EXPIRED</code> past a key&apos;s expiry
            (the message names it), and <code>429 RATE_LIMITED</code> with <code>Retry-After</code>.
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="licence">
        <h2 className={styles.sectionLabel} id="licence">
          Licence and citation
        </h2>
        <p>
          The datasets and the payloads are licensed under{" "}
          <a className={styles.link} href="https://creativecommons.org/licenses/by/4.0/">
            CC BY 4.0
          </a>{" "}
          (
          <a className={styles.link} href={DATA_LICENSE_PATH}>
            notice
          </a>
          ). Attribute them as <q>{ATTRIBUTION}</q>, and cite the route or dataset, the
          payload&apos;s <code>as_of</code> and the versions it carries.
        </p>
      </section>
    </article>
  );
}
