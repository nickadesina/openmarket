"use client";

import { formatDate, sideLabel } from "../../lib/client/format.js";
import type { ListingView, TradeSelection } from "../market-workspace/types.js";
import { BinaryTicket } from "./binary-ticket.js";
import { ForwardTicket } from "./forward-ticket.js";
import styles from "./trade-ticket.module.css";

interface TradeTicketProps {
  readonly listing: ListingView;
  readonly selection: TradeSelection;
  readonly onSelectionChange: (selection: TradeSelection) => void;
  readonly onAuthoritativeRefresh: () => Promise<void>;
  readonly onClose?: () => void;
}

/** "LONG · Next post-money" or "YES · By Dec 31, 2026": what the ticket is working. */
export function workingContract(listing: ListingView, selection: TradeSelection): string {
  if (selection.contract === "forward") return `${sideLabel(selection.side)} · Next post-money`;
  const expiry = listing.binary === null ? "" : ` by ${formatDate(listing.binary.expires_at)}`;
  const event = listing.binaryEvent === "public_s1" ? "Public S-1" : "Priced round";
  return `${sideLabel(selection.side)} · ${event}${expiry}`;
}

/**
 * The one trade ticket on a listed name's page: the forward (how big) or the
 * quarterly binary (when), chosen by an ink segmented control, under the
 * page's single red name plate.
 */
export function TradeTicket({
  listing,
  selection,
  onSelectionChange,
  onAuthoritativeRefresh,
  onClose,
}: TradeTicketProps) {
  return (
    <section className={styles.ticket} aria-labelledby="trade-ticket-title">
      <header className={styles.header}>
        <div>
          <h2 id="trade-ticket-title" className={styles.tab}>
            Trade ticket
          </h2>
          <p className={styles.contract}>{workingContract(listing, selection)}</p>
        </div>
        {onClose !== undefined ? (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close trade ticket"
          >
            Close
          </button>
        ) : null}
      </header>

      <div className={styles.contractSwitch}>
        <div className={styles.segmented} role="group" aria-label="Contract">
          <button
            type="button"
            aria-pressed={selection.contract === "forward"}
            disabled={listing.forward === null}
            onClick={() =>
              selection.contract !== "forward" &&
              onSelectionChange({ contract: "forward", side: "long" })
            }
          >
            Forward
          </button>
          <button
            type="button"
            aria-pressed={selection.contract === "binary"}
            disabled={listing.binary === null}
            onClick={() =>
              selection.contract !== "binary" &&
              onSelectionChange({ contract: "binary", side: "yes" })
            }
          >
            Binary
          </button>
        </div>
      </div>

      {selection.contract === "forward" && listing.forward !== null ? (
        <ForwardTicket
          forward={listing.forward}
          side={selection.side}
          onSideChange={(side) => onSelectionChange({ contract: "forward", side })}
          onAuthoritativeRefresh={onAuthoritativeRefresh}
        />
      ) : selection.contract === "binary" && listing.binary !== null ? (
        <BinaryTicket
          binary={listing.binary}
          side={selection.side}
          onSideChange={(side) => onSelectionChange({ contract: "binary", side })}
          onAuthoritativeRefresh={onAuthoritativeRefresh}
        />
      ) : (
        <div className={styles.body}>
          <p className={styles.pending} role="status">
            This contract is not trading right now: its epoch has ended and the next one lists
            when the dealer job rolls it.
          </p>
        </div>
      )}
    </section>
  );
}
