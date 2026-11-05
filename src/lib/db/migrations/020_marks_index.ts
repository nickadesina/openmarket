import { type Kysely, sql } from "kysely";

/**
 * The marks index (decision 0003; docs/prompts/v2/README.md, "Data model").
 * The unit is one `filer_marks` row: one per-share mark on one security,
 * from one filer, as of one date, with its source document. Everything the
 * index publishes is derived from these rows and the checked-in data files.
 *
 * Money is `numeric` USD (per-share marks need more than two decimals).
 * Nothing is updated in place except `filer_marks.superseded_by`, set once
 * when a later filing (an amendment) replaces the row; a correction is a new
 * row plus a `corrections` row. Triggers hold `source_documents` and
 * `corrections` append-only and `filer_marks` supersede-only.
 *
 * Every table the v2 build needs is here, so later parts add no migration:
 * prints, certificates, certificate_series, spv_vehicles and spv_quotes are
 * P4's; corrections are P5's page.
 */

const SOURCE_CLASSES = sql`('ncsr', 'nport', 'fund_holdings_page', 'closed_end_nav',
  'delaware_coi', 'form_d', 'spv_quote_page', 'company_statement', 'press')`;

const SECURITY_KINDS = sql`('preferred', 'common', 'convertible_note', 'safe',
  'spv_interest', 'warrant', 'other', 'unknown')`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table source_documents (
      id uuid primary key default gen_random_uuid(),
      source_class text not null check (source_class in ${SOURCE_CLASSES}),
      source_rank smallint not null check (source_rank > 0),
      accession text unique check (accession ~ '^\\d{10}-\\d{2}-\\d{6}$'),
      document_url text not null check (document_url ~ '^https://'),
      filer_cik text check (filer_cik ~ '^[1-9][0-9]*$'),
      filer_name text not null check (length(btrim(filer_name)) > 0),
      fund_series_id text,
      fund_series_name text,
      form_type text,
      filed_on date,
      period_end date,
      fetched_at timestamptz not null,
      content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
      parser_version text not null check (length(btrim(parser_version)) > 0),
      constraint source_documents_url_content unique (document_url, content_sha256)
    )
  `.execute(db);
  await sql`
    create index source_documents_class_filed on source_documents (source_class, filed_on)
  `.execute(db);

  await sql`
    create table issuers (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      name text not null check (length(btrim(name)) > 0),
      legal_name text,
      search_phrases jsonb not null
        check (jsonb_typeof(search_phrases) = 'array' and jsonb_array_length(search_phrases) > 0),
      match_pattern text not null check (length(match_pattern) > 0),
      incorporation_state text,
      incorporation_source_id uuid references source_documents (id),
      watchlisted boolean not null default false,
      created_at timestamptz not null default now(),
      -- The state of incorporation is recorded only from a filing, with the filing.
      constraint issuers_incorporation_sourced
        check (incorporation_state is null or incorporation_source_id is not null)
    )
  `.execute(db);

  await sql`
    create table corrections (
      id uuid primary key default gen_random_uuid(),
      published_at timestamptz not null,
      methodology_version text not null,
      kind text not null check (kind in ('row', 'methodology', 'parser')),
      summary text not null check (length(btrim(summary)) > 0),
      diff_md text not null,
      affected jsonb not null
    )
  `.execute(db);

  await sql`
    create table filer_marks (
      id uuid primary key default gen_random_uuid(),
      document_id uuid not null references source_documents (id),
      issuer_id uuid not null references issuers (id),
      holding_index integer not null check (holding_index >= 0),
      holding_name text not null,
      holding_title text not null,
      asset_category text,
      security_label text not null check (length(btrim(security_label)) > 0),
      security_kind text not null check (security_kind in ${SECURITY_KINDS}),
      balance numeric,
      units text,
      value_usd numeric not null,
      mark_per_share_usd numeric,
      fair_value_level text,
      is_restricted boolean,
      as_of date not null,
      superseded_by uuid references filer_marks (id),
      correction_id uuid references corrections (id),
      created_at timestamptz not null default now(),
      constraint filer_marks_document_issuer_holding unique (document_id, issuer_id, holding_index),
      constraint filer_marks_not_self_superseded check (superseded_by is null or superseded_by <> id),
      -- A per-share mark is value over shares: only for a share balance above zero.
      constraint filer_marks_per_share
        check (mark_per_share_usd is null or (units = 'NS' and balance > 0 and mark_per_share_usd >= 0))
    )
  `.execute(db);
  await sql`
    create index filer_marks_issuer_label_as_of on filer_marks (issuer_id, security_label, as_of)
  `.execute(db);
  await sql`
    create index filer_marks_superseded_by on filer_marks (superseded_by)
    where superseded_by is not null
  `.execute(db);

  await sql`
    create table prints (
      id uuid primary key default gen_random_uuid(),
      issuer_id uuid not null references issuers (id),
      round_name text not null check (length(btrim(round_name)) > 0),
      event_type text not null,
      announced_on date not null,
      post_money_usd numeric check (post_money_usd > 0),
      amount_raised_usd numeric check (amount_raised_usd > 0),
      series_label text,
      price_per_share_usd numeric check (price_per_share_usd > 0),
      price_source_id uuid references source_documents (id),
      source_url text,
      origin text not null check (origin in ('events.csv', 'certificate', 'form_d')),
      constraint prints_issuer_round unique (issuer_id, round_name)
    )
  `.execute(db);

  await sql`
    create table certificates (
      id uuid primary key default gen_random_uuid(),
      issuer_id uuid not null references issuers (id),
      document_id uuid not null references source_documents (id),
      filed_on date not null,
      kind text not null check (kind in ('restated', 'amendment')),
      entered_by text not null check (length(btrim(entered_by)) > 0),
      notes text
    )
  `.execute(db);

  await sql`
    create table certificate_series (
      id uuid primary key default gen_random_uuid(),
      certificate_id uuid not null references certificates (id),
      series_label text not null check (length(btrim(series_label)) > 0),
      original_issue_price_usd numeric not null check (original_issue_price_usd >= 0),
      liquidation_multiple numeric not null check (liquidation_multiple >= 0),
      participating boolean not null,
      participation_cap_multiple numeric
        check (participation_cap_multiple is null or (participating and participation_cap_multiple > 0)),
      seniority integer not null check (seniority >= 1),
      shares_authorized numeric not null check (shares_authorized >= 0),
      conversion_price_usd numeric check (conversion_price_usd > 0),
      ratchet jsonb,
      constraint certificate_series_label unique (certificate_id, series_label)
    )
  `.execute(db);

  await sql`
    create table spv_vehicles (
      id uuid primary key default gen_random_uuid(),
      document_id uuid not null unique references source_documents (id),
      issuer_id uuid references issuers (id),
      vehicle_name text not null check (length(btrim(vehicle_name)) > 0),
      vehicle_cik text not null check (vehicle_cik ~ '^[1-9][0-9]*$'),
      related_persons jsonb not null default '[]' check (jsonb_typeof(related_persons) = 'array'),
      jurisdiction text,
      total_offering_usd numeric check (total_offering_usd >= 0),
      total_sold_usd numeric check (total_sold_usd >= 0),
      min_investment_usd numeric check (min_investment_usd >= 0),
      sales_commission_usd numeric check (sales_commission_usd >= 0),
      finders_fee_usd numeric check (finders_fee_usd >= 0),
      first_sale_on date,
      match_method text not null check (match_method in ('alias', 'manual', 'unmatched')),
      match_note text,
      constraint spv_vehicles_matched check ((match_method = 'unmatched') = (issuer_id is null))
    )
  `.execute(db);

  await sql`
    create table spv_quotes (
      id uuid primary key default gen_random_uuid(),
      issuer_id uuid not null references issuers (id),
      spv_vehicle_id uuid references spv_vehicles (id),
      document_id uuid not null references source_documents (id),
      platform text not null check (length(btrim(platform)) > 0),
      quoted_price_per_share_usd numeric check (quoted_price_per_share_usd > 0),
      quoted_valuation_usd numeric check (quoted_valuation_usd > 0),
      upfront_fee_pct numeric check (upfront_fee_pct >= 0),
      mgmt_fee_pct numeric check (mgmt_fee_pct >= 0),
      carry_pct numeric check (carry_pct >= 0),
      layers integer not null default 1 check (layers >= 1),
      captured_at timestamptz not null,
      constraint spv_quotes_priced
        check (quoted_price_per_share_usd is not null or quoted_valuation_usd is not null)
    )
  `.execute(db);

  await sql`
    create table ingest_runs (
      id uuid primary key default gen_random_uuid(),
      source_class text not null check (source_class in ${SOURCE_CLASSES}),
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      status text not null check (status in ('running', 'ok', 'failed')),
      documents_seen integer not null default 0 check (documents_seen >= 0),
      documents_new integer not null default 0 check (documents_new >= 0),
      marks_new integer not null default 0 check (marks_new >= 0),
      error text,
      constraint ingest_runs_finished check (
        (status = 'running') = (finished_at is null)
        and (finished_at is null or finished_at >= started_at)
      ),
      constraint ingest_runs_failed_has_error check (status <> 'failed' or error is not null)
    )
  `.execute(db);
  await sql`
    create index ingest_runs_class_started on ingest_runs (source_class, started_at desc)
  `.execute(db);

  await sql`
    create function index_reject_mutation() returns trigger language plpgsql as $$
    begin
      raise exception '% is append-only', tg_table_name;
    end
    $$
  `.execute(db);
  await sql`
    create function index_mark_supersede_only() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE'
        or old.superseded_by is not null
        or new.superseded_by is null
        or (to_jsonb(new) - 'superseded_by') <> (to_jsonb(old) - 'superseded_by') then
        raise exception 'filer_marks change only by being superseded';
      end if;
      return new;
    end
    $$
  `.execute(db);
  for (const table of ["source_documents", "corrections"]) {
    await sql`
      create trigger ${sql.raw(`${table}_append_only`)}
      before update or delete on ${sql.table(table)}
      for each row execute function index_reject_mutation()
    `.execute(db);
  }
  await sql`
    create trigger filer_marks_supersede_only
    before update or delete on filer_marks
    for each row execute function index_mark_supersede_only()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "ingest_runs",
    "spv_quotes",
    "spv_vehicles",
    "certificate_series",
    "certificates",
    "prints",
    "filer_marks",
    "corrections",
    "issuers",
    "source_documents",
  ]) {
    await sql`drop table ${sql.table(table)}`.execute(db);
  }
  await sql`drop function index_mark_supersede_only()`.execute(db);
  await sql`drop function index_reject_mutation()`.execute(db);
}
