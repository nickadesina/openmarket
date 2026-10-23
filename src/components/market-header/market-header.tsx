import {
  formatCompactUsd,
  formatDate,
  formatDateTime,
  formatPrice,
  formatProbability,
  formatRoundMultiple,
  formatValuation,
  tierLabel,
} from "../../lib/client/format.js";
import { CompanyLogo } from "../company-logo/company-logo.js";
import { MovementArrow } from "../icons/icons.js";
import type { ListingView } from "../market-workspace/types.js";
import styles from "./market-header.module.css";

interface MarketHeaderProps {
  readonly listing: ListingView;
  readonly movement: "up" | "down" | "flat";
}

/**
 * The quote band: one ruled row that reads like a brokerage quote page, name
 * first, then the forward mid (how big), the round it stands against, the
 * implied band, the binary (when), open interest and the last trade. Every
 * figure is the API's.
 */
export function MarketHeader({ listing, movement }: MarketHeaderProps) {
  const { forward, binary, distribution, anchor } = listing;
  const multiple = formatRoundMultiple(listing.vsLastRound);
  const binaryLabel = listing.binaryEvent === "public_s1" ? "Public S-1" : "Priced round";

  return (
    <header className={styles.header}>
      <div className={styles.band}>
        <div className={styles.identity}>
          <CompanyLogo name={listing.company.name} logoPath={listing.company.logoPath} size="lg" />
          <div>
            <div className={styles.titleRow}>
              <h1>{listing.company.name}</h1>
            </div>
            <p className={styles.prompt}>
              {tierLabel(listing.tier)} · Next post-money, and whether a{" "}
              {listing.binaryEvent === "public_s1" ? "public S-1" : "priced round"} lands this
              quarter
            </p>
          </div>
        </div>

        <dl className={styles.cells} aria-label="Current market figures">
          <div className={styles.cell}>
            <dt>Forward mid</dt>
            <dd
              className={`${styles.price} ${movement === "up" ? styles.flashUp : movement === "down" ? styles.flashDown : ""}`}
            >
              {forward === null ? "Not trading" : formatPrice(forward.mid_usd)}
              <span className={styles.movement} aria-live="polite" aria-atomic="true">
                {movement === "flat" ? null : (
                  <>
                    <MovementArrow direction={movement} /> {movement === "up" ? "Up" : "Down"}
                  </>
                )}
              </span>
            </dd>
            {forward === null ? null : (
              <dd className={styles.note}>
                Bid {formatPrice(forward.bid_usd)} · Ask {formatPrice(forward.ask_usd)}
              </dd>
            )}
          </div>

          <div className={styles.cell}>
            <dt>Last round</dt>
            <dd className={styles.figure}>{formatValuation(anchor.postMoneyUsd)}</dd>
            <dd className={styles.note}>
              {anchor.round} · <time dateTime={anchor.date}>{formatDate(anchor.date)}</time> ·{" "}
              <a href={anchor.sourceUrl} target="_blank" rel="noreferrer">
                Source
              </a>
            </dd>
            {multiple === null ? null : (
              <dd className={styles.note}>
                The forward mid is {multiple} this: the model's step-up for a{" "}
                {tierLabel(listing.tier).toLowerCase()} name, until a scoop or print moves it
              </dd>
            )}
          </div>

          {distribution === null ? null : (
            <div className={styles.cell}>
              <dt>80% band</dt>
              <dd className={styles.figure}>
                {formatPrice(distribution.band.p10)} – {formatPrice(distribution.band.p90)}
              </dd>
              {distribution.mode.fromUsd !== null && distribution.mode.toUsd !== null ? (
                <dd className={styles.note}>
                  Most likely {formatValuation(distribution.mode.fromUsd)}–
                  {formatValuation(distribution.mode.toUsd)} ·{" "}
                  {formatProbability(distribution.mode.mass)}
                </dd>
              ) : null}
            </div>
          )}

          <div className={styles.cell}>
            <dt>{binaryLabel} this quarter</dt>
            <dd className={styles.figure}>
              {binary === null ? "Not trading" : `YES ${formatProbability(binary.yes_price)}`}
            </dd>
            {binary === null ? null : (
              <dd className={styles.note}>
                By <time dateTime={binary.expires_at}>{formatDate(binary.expires_at)}</time> · model
                p {formatProbability(binary.model_p)}
              </dd>
            )}
          </div>

          <div className={styles.cell}>
            <dt>Open interest</dt>
            <dd className={styles.figure}>{formatCompactUsd(listing.openInterest.totalUsd)}</dd>
            <dd className={styles.note}>
              Forward {formatCompactUsd(listing.openInterest.forwardNotionalUsd)} · Binary{" "}
              {formatCompactUsd(listing.openInterest.binaryUsd)}
            </dd>
          </div>

          <div className={styles.cell}>
            <dt>Last trade</dt>
            <dd className={styles.figure}>
              {/* ICU output differs between Node and the browser; the client value wins. */}
              <time dateTime={listing.lastTradeAt ?? undefined} suppressHydrationWarning>
                {listing.lastTradeAt === null ? "None yet" : formatDateTime(listing.lastTradeAt)}
              </time>
            </dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
