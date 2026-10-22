import { type Kysely, sql } from "kysely";

/**
 * Milestone 6 (README D1, D10; TECHNICAL_DESIGN.md §12). A deliberate,
 * owner-approved exception to append-only migrations (Nick, 2026-10-21):
 * it deletes data.
 *
 * - Every market with no instrument (the Anthropic and Stripe 41-bucket
 *   ladders and any other pre-dealer book) goes with its comments, marks,
 *   settlements, holdings and trades.
 * - Every `users` row goes: each was a shared-username paper account. Their
 *   comments, holdings, trades and quota rows go first. A paper account is
 *   now keyed by a tournament user and opened on first use.
 * - Stripe, and any company left with no market, listing or event flag, goes.
 * - The `user_create` and `admin_login` quota scopes go with the username
 *   flow and the passphrase admin.
 *
 * It refuses to run once a dealer book has traded: those trades are tied to
 * the append-only quote tape and are not this migration's to remove.
 *
 * `down` restores the shape only. The deleted rows are not recoverable, and
 * surviving paper accounts get a placeholder username derived from their id.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1 from trades join markets on markets.id = trades.market_id
        where markets.instrument_id is not null
      ) or exists (select 1 from forward_positions) then
        raise exception '008 runs before dealer trading: a dealer book already has trades';
      end if;
    end
    $$
  `.execute(db);

  // Every comment's author is a username account, so every comment goes;
  // comment quota rows are keyed by those users or by the retired network HMAC.
  await sql`delete from market_comments`.execute(db);
  await sql`delete from comment_rate_limits`.execute(db);

  await sql`
    delete from marks
    where trade_id is not null
       or market_id in (select id from markets where instrument_id is null)
  `.execute(db);
  await sql`
    delete from settlements
    where market_id in (select id from markets where instrument_id is null)
  `.execute(db);
  await sql`delete from holdings`.execute(db);
  await sql`delete from trades`.execute(db);
  await sql`delete from markets where instrument_id is null`.execute(db);

  await sql`
    delete from rate_limits
    where scope in ('user_create', 'admin_login')
       or (scope in ('quote', 'trade') and key in (select id::text from users))
  `.execute(db);
  await sql`delete from users`.execute(db);

  await sql`
    delete from companies
    where slug = 'stripe'
       or (
         not exists (select 1 from markets where markets.company_id = companies.id)
         and not exists (select 1 from listings where listings.company_id = companies.id)
         and not exists (select 1 from event_flags where event_flags.company_id = companies.id)
       )
  `.execute(db);

  await db.schema
    .alterTable("users")
    .dropColumn("username")
    .dropColumn("username_normalized")
    .execute();
  await db.schema
    .alterTable("users")
    .addColumn("tournament_user_id", "uuid", (column) =>
      column.notNull().unique().references("tournament_users.id"),
    )
    .execute();

  await db.schema.alterTable("rate_limits").dropConstraint("rate_limits_scope").execute();
  await db.schema
    .alterTable("rate_limits")
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('quote', 'trade', 'tournament_register', 'tournament_login')`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("rate_limits").dropConstraint("rate_limits_scope").execute();
  await db.schema
    .alterTable("rate_limits")
    .addCheckConstraint(
      "rate_limits_scope",
      sql`scope in ('admin_login', 'user_create', 'quote', 'trade', 'tournament_register', 'tournament_login')`,
    )
    .execute();

  await db.schema.alterTable("users").addColumn("username", "text").execute();
  await db.schema.alterTable("users").addColumn("username_normalized", "text").execute();
  // `u_` and 18 hex digits of the id: inside 001's 3–20 character username rule.
  await sql`
    update users
    set username = 'u_' || substr(replace(id::text, '-', ''), 1, 18),
        username_normalized = 'u_' || substr(replace(id::text, '-', ''), 1, 18)
  `.execute(db);
  await db.schema
    .alterTable("users")
    .alterColumn("username", (column) => column.setNotNull())
    .execute();
  await db.schema
    .alterTable("users")
    .alterColumn("username_normalized", (column) => column.setNotNull())
    .execute();
  await db.schema
    .alterTable("users")
    .addUniqueConstraint("users_username_normalized_key", ["username_normalized"])
    .execute();
  await db.schema.alterTable("users").dropColumn("tournament_user_id").execute();
}
