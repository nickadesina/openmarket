import { type Kysely, sql } from "kysely";

/**
 * Demo accounts (decision 0005): `tournament_users.demo` marks the five
 * accounts `npm run seed:demo` creates to show the markets working. Additive:
 * no row changes.
 *
 * A demo account cannot sign in or forecast, and the database says so: a
 * session, a password credential or a forecast for a demo user is refused,
 * and so is any identity but its `password`-namespace handle (no X id, no
 * development sign-in). `down` refuses while a demo user exists: their
 * trades are ledger rows, and dropping the flag would leave them unlabelled.
 */
const GUARDED_TABLES = [
  "tournament_sessions",
  "tournament_password_credentials",
  "tournament_forecast_events",
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("tournament_users")
    .addColumn("demo", "boolean", (column) => column.notNull().defaultTo(false))
    .execute();

  await sql`
    create function tournament_refuse_demo_user() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from tournament_users where id = new.user_id and demo) then
        raise exception 'demo account %: % refused (decision 0005)', new.user_id, tg_table_name;
      end if;
      return new;
    end
    $$
  `.execute(db);
  await sql`
    create function tournament_demo_identity_password_only() returns trigger language plpgsql as $$
    begin
      if new.provider <> 'password'
        and exists (select 1 from tournament_users where id = new.user_id and demo) then
        raise exception 'demo account %: % identity refused (decision 0005)', new.user_id, new.provider;
      end if;
      return new;
    end
    $$
  `.execute(db);
  for (const table of GUARDED_TABLES) {
    await sql`
      create trigger ${sql.raw(`${table}_no_demo`)}
      before insert on ${sql.table(table)}
      for each row execute function tournament_refuse_demo_user()
    `.execute(db);
  }
  await sql`
    create trigger tournament_identities_demo_password_only
    before insert or update on tournament_identities
    for each row execute function tournament_demo_identity_password_only()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (select 1 from tournament_users where demo) then
        raise exception '015 down runs only without demo accounts: a demo user exists';
      end if;
    end
    $$
  `.execute(db);
  await sql`drop trigger tournament_identities_demo_password_only on tournament_identities`.execute(
    db,
  );
  for (const table of GUARDED_TABLES) {
    await sql`drop trigger ${sql.raw(`${table}_no_demo`)} on ${sql.table(table)}`.execute(db);
  }
  await sql`drop function tournament_demo_identity_password_only()`.execute(db);
  await sql`drop function tournament_refuse_demo_user()`.execute(db);
  await db.schema.alterTable("tournament_users").dropColumn("demo").execute();
}
