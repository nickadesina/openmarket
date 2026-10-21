import { type Kysely, sql } from "kysely";

/**
 * Milestone 6's ledger additions (README D12, TECHNICAL_DESIGN.md §6).
 *
 * `quotes.sequence` orders the tape: one dealer run posts several quotes for
 * an instrument at the same `posted_at` (a widen, then the requote after the
 * mid moved), and the latest quote is the one the next requote compares with.
 *
 * `dealer_pnl` is the dealer's position per listing per instrument epoch, in
 * cents, from the dealer's side, recomputed on every read (a plain view, so
 * replay has nothing to rebuild):
 *
 *   realised     a settled book's market-maker cash flow: what users paid in
 *                less everything credited back (payouts, refunds, credits);
 *                0 while the book is open.
 *   open_collateral  a forward's N·κ held for its open positions.
 *   unrealised   an open forward's positions marked at the latest mid,
 *                −Σ ±N·clip(m − F₀, ±κ); an open binary's cash flow less its
 *                holders' claims at the current YES price.
 *   bound        the published worst case: Q·κ for a forward,
 *                b·ln(1/p_floor) for a binary.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table quotes add column sequence bigint generated always as identity`.execute(db);
  await sql`create unique index quotes_sequence on quotes (sequence)`.execute(db);

  await sql`
    create view dealer_pnl as
    select
      listings.id as listing_id,
      companies.name as company,
      instruments.id as instrument_id,
      instruments.kind,
      instruments.epoch,
      instruments.state,
      markets.id as market_id,
      markets.status as market_status,
      case when markets.status = 'settled' then markets.mm_cash_flow_cents else 0 end::bigint
        as realised_cents,
      coalesce(positions.open_collateral_cents, 0)::bigint as open_collateral_cents,
      case
        when markets.status = 'settled' then 0
        when instruments.kind = 'forward' then coalesce(positions.unrealised_cents, 0)
        else markets.mm_cash_flow_cents - coalesce(claims.claims_cents, 0)
      end::double precision as unrealised_cents,
      case
        when instruments.kind = 'forward' then listings.cap_cents * listings.kappa
        else listings.b_cents * ln(1 / listings.p_floor)
      end::double precision as bound_cents,
      latest_mid.mid_ln as latest_mid_ln,
      markets.current_metric
    from instruments
    join listings on listings.id = instruments.listing_id
    join companies on companies.id = listings.company_id
    join markets on markets.instrument_id = instruments.id
    left join lateral (
      select mid_ln from model_mids
      where model_mids.instrument_id = instruments.id
      order by computed_at desc, id desc
      limit 1
    ) latest_mid on true
    left join lateral (
      select
        sum(collateral_cents) as open_collateral_cents,
        sum(
          case when side = 'long' then -1 else 1 end * notional_cents
          * greatest(-listings.kappa, least(listings.kappa, latest_mid.mid_ln - entry_ln))
        ) as unrealised_cents
      from forward_positions
      where forward_positions.instrument_id = instruments.id
        and settled_at is null and voided_at is null
    ) positions on instruments.kind = 'forward'
    left join lateral (
      select sum(h[1] * (1 - markets.current_metric) + h[2] * markets.current_metric) * 100
        as claims_cents
      from holdings
      where holdings.market_id = markets.id
    ) claims on instruments.kind = 'binary'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop view dealer_pnl`.execute(db);
  await sql`drop index quotes_sequence`.execute(db);
  await sql`alter table quotes drop column sequence`.execute(db);
}
