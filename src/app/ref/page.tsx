import type { Metadata } from "next";
import Link from "next/link";

import examples from "../../../docs/tradeables/ref-examples.json";
import { REF_CACHE_SECONDS } from "../../lib/api/ref-route.js";
import { DEFAULT_KEY_QUOTA_PER_MINUTE, DESIGN_PARTNER_KEY_DAYS } from "../../lib/auth/api-key.js";
import { MODEL_VERSION } from "../../lib/config/dealer.js";
import { BLEND_VERSION } from "../../lib/engine/dealer/blend.js";
import { RULEBOOK_VERSION } from "../../lib/engine/dealer/rulebook.js";
import { RATE_LIMIT_POLICIES } from "../../lib/services/rate-limit.js";
import {
  ENVELOPE_FIELDS,
  QUOTE_FIELDS,
  REF_ROUTES,
  type RouteDoc,
  withholdKeys,
} from "../../lib/tradeables/ref-docs.js";
import styles from "./page.module.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Reference API",
  description:
    "OpenMarket's reference price for each listed name, versioned and public: routes, fields, quotas and how to cite a price.",
  robots: { index: false, follow: false },
};

const EXAMPLES = examples.examples as Readonly<
  Record<string, { readonly request: string; readonly response: unknown }>
>;

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
  const example = EXAMPLES[route.example];
  const id = route.example;
  return (
    <section className={styles.route} id={id} aria-labelledby={`${id}-head`}>
      <h3 id={`${id}-head`}>
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
      {route.items === undefined ? null : (
        <>
          <h4 className={styles.minorHead}>{route.items.name}</h4>
          <Fields fields={route.items.fields} />
        </>
      )}
      {route.example === "history" ? (
        <>
          <h4 className={styles.minorHead}>quotes[]</h4>
          <Fields fields={QUOTE_FIELDS} />
        </>
      ) : null}
      {example === undefined ? null : (
        <>
          <h4 className={styles.minorHead}>Example: {example.request}</h4>
          <pre className={styles.example}>
            <code>{JSON.stringify(withholdKeys(example.response), null, 2)}</code>
          </pre>
        </>
      )}
    </section>
  );
}

export default function RefPage() {
  const publicQuota = RATE_LIMIT_POLICIES.ref.limit;
  return (
    <article className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Reference API</p>
        <h1>The reference price, versioned and public</h1>
        <p>
          For each listed name, OpenMarket publishes a reference price for both contracts: the
          binary's probability of its event by quarter-end and the forward's level for the next
          post-money. Every figure carries the versions that produced it, so it can be cited and
          reproduced. JSON over HTTPS, no key needed to start.
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
          <Link className={styles.link} href="/ref/trial">
            Design-partner trial
          </Link>
        </p>
      </header>

      <section className={styles.section} aria-labelledby="envelope">
        <h2 className={styles.sectionLabel} id="envelope">
          The envelope
        </h2>
        <p>
          Every payload opens with the same four fields. Stored rows inside a payload also carry the
          versions they were computed under, which can be older than the envelope's.
        </p>
        <Fields fields={ENVELOPE_FIELDS} />
        <p className={styles.muted}>
          Live now: model {MODEL_VERSION}, rulebook{" "}
          <Link className={styles.link} href="/rulebook">
            {RULEBOOK_VERSION}
          </Link>
          , blend {BLEND_VERSION}.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="blend">
        <h2 className={styles.sectionLabel} id="blend">
          The blend
        </h2>
        <p>
          The reference is a pre-committed blend of three prices: the model mid, the 30-day traded
          price on the instrument's own book, and the tournament crowd's forecast for the linked
          question. The weights move on a published schedule as flow and forecasters arrive, and a
          changed schedule is a new blend version. With no flow and no crowd the reference is the
          model mid, and the payload says so with <code>model_only: true</code>.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="routes">
        <h2 className={styles.sectionLabel} id="routes">
          Routes
        </h2>
        <p>
          Every route is <code>GET</code>, read-only and answers JSON. Valuations are given in
          natural-log USD and in dollars; probabilities in [0, 1]; times in UTC ISO 8601. The
          examples are real responses from a development server, captured {examples.captured_at}.
          Fields that describe how the model and the blend are built are not listed or shown here,
          and each example's arrays keep their first two entries.
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
            issued. Terms: <Link href="/ref/trial">/ref/trial</Link>.
          </li>
          <li>
            Errors share one envelope, <code>{"{ error: { code, message, details } }"}</code>.{" "}
            <code>401 API_KEY_INVALID</code> for an unknown or revoked key,{" "}
            <code>401 API_KEY_EXPIRED</code> past a key's expiry (the message names it),{" "}
            <code>429 RATE_LIMITED</code> with <code>Retry-After</code>,{" "}
            <code>404 LISTING_NOT_FOUND</code> for an unknown slug, and{" "}
            <code>400 INVALID_INPUT</code> for an unknown query parameter.
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="cite">
        <h2 className={styles.sectionLabel} id="cite">
          How to cite a price
        </h2>
        <p>
          Cite the name's <code>slug</code>, the row's <code>as_of</code> and the three versions it
          carries: <code>model_version</code>, <code>rulebook_version</code> and{" "}
          <code>blend_version</code>. With those, anyone can find the same row in{" "}
          <code>/api/ref/{"{slug}"}/history</code> and see what produced it. Attribute it to
          OpenMarket.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="tournament">
        <h2 className={styles.sectionLabel} id="tournament">
          Tournament data
        </h2>
        <p>
          Each listed instrument has a forecasting question. Its forecast log and the crowd
          aggregate's history are public, need no key, and are cached for 10 seconds:{" "}
          <code>GET /api/t/questions/{"{slug}"}/forecasts</code> and{" "}
          <code>GET /api/t/questions/{"{slug}"}/aggregate/history</code>. The question's slug is{" "}
          <code>question_slug</code> on <code>/api/ref/{"{slug}"}</code>.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="data">
        <h2 className={styles.sectionLabel} id="data">
          Data
        </h2>
        <ul className={styles.list}>
          <li>
            Round history, every priced round the model was fit on with its source:{" "}
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
            The backtest's public outputs:{" "}
            <a className={styles.link} href="/data/backtest/README.md">
              /data/backtest
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
