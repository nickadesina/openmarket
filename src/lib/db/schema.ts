import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

import type { SecurityKind } from "../engine/index/series.js";
import type { SourceClass } from "../engine/rulebook.js";

/*
 * Most tables below are v1's (the dealer and the tournament, archived at the
 * tags `archive/dealer-v1` and `archive/tournament-v1`). They stay in the
 * database and in this schema because migrations 001-019 created them; v2
 * code reads only `api_keys`, `api_key_usage` and `rate_limits` of them, and
 * the marks index's own tables (migration 020, after the v1 tables below).
 */

/** `event_flags.kind` (decision 0001); inlined from v1's dealer lifecycle (tag archive/dealer-v1). */
export type FlagKind =
  | "form_d"
  | "form_d_amend"
  | "charter"
  | "scoop"
  | "release"
  | "s1_public"
  | "print"
  | "user_submitted";
/** `listings.tier`; inlined from v1's dealer prior (tag archive/dealer-v1). */
export type Tier = "mega" | "redhot";

export type MarketStatus = "open" | "settled";
/**
 * A dealer book: `yes_probability` a binary's two-outcome LMSR, `forward_ln` a
 * forward's (q = [open long, open short] notional in USD). The ladder's
 * `valuation_median` books went with migration 008; the column still admits it.
 */
export type MetricKind = "yes_probability" | "forward_ln";
export type TradeAction = "buy" | "sell";
/** An LMSR claim side: a binary trades these. */
export type ClaimSide = "yes" | "no";
export type ForwardSide = "long" | "short";
export type ContractSide = ClaimSide | ForwardSide;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

type Immutable<T> = ColumnType<T, T, never>;
type GeneratedImmutable<T> = ColumnType<T, T | undefined, never>;

export interface CompaniesTable {
  id: GeneratedImmutable<string>;
  name: string;
  slug: string;
  logo_path: string;
  created_at: GeneratedImmutable<Date>;
}

export interface MarketsTable {
  id: GeneratedImmutable<string>;
  company_id: Immutable<string>;
  status: MarketStatus;
  n_buckets: Immutable<number>;
  bucket_grid_version: Immutable<string>;
  metric_kind: Immutable<MetricKind>;
  anchor_valuation: Immutable<string | null>;
  anchor_date: Immutable<string | null>;
  anchor_description: Immutable<string | null>;
  b: Immutable<number>;
  sigma: Immutable<number | null>;
  initial_q: Immutable<number[]>;
  q: number[];
  current_metric: number;
  last_market_sequence: Generated<string>;
  mm_cash_flow_cents: Generated<string>;
  rounding_reserve_cents: Generated<string>;
  created_at: GeneratedImmutable<Date>;
  settled_at: Date | null;
  /** A dealer instrument's book; 008 removed every market without one. */
  instrument_id: GeneratedImmutable<string | null>;
}

/** A paper account: one per tournament user, opened on first use (README D1). */
export interface UsersTable {
  id: GeneratedImmutable<string>;
  tournament_user_id: Immutable<string>;
  cash_balance_cents: string;
  created_at: GeneratedImmutable<Date>;
}

export interface HoldingsTable {
  user_id: Immutable<string>;
  market_id: Immutable<string>;
  h: number[];
  updated_at: Date;
}

export interface TradesTable {
  id: GeneratedImmutable<string>;
  idempotency_key: Immutable<string>;
  request_fingerprint: Immutable<string>;
  user_id: Immutable<string>;
  market_id: Immutable<string>;
  market_sequence: Immutable<string>;
  action: Immutable<TradeAction>;
  contract_side: Immutable<ContractSide>;
  strike_index: Immutable<number>;
  strike_value: Immutable<string | null>;
  quantity: Immutable<number>;
  requested_spend_cents: Immutable<string | null>;
  engine_cost_usd: Immutable<number>;
  cash_amount_cents: Immutable<string>;
  redemption_quantity: GeneratedImmutable<number>;
  redemption_cents: GeneratedImmutable<string>;
  delta: Immutable<number[]>;
  q_before: Immutable<number[]>;
  q_after: Immutable<number[]>;
  metric_before: Immutable<number>;
  metric_after: Immutable<number>;
  execution_result: Immutable<JsonValue>;
  created_at: Immutable<Date>;
}

export interface MarksTable {
  market_id: Immutable<string>;
  market_sequence: Immutable<string>;
  trade_id: Immutable<string | null>;
  ts: Immutable<Date>;
  value: Immutable<number>;
}

export interface SettlementsTable {
  market_id: Immutable<string>;
  settled_value: Immutable<string>;
  winning_bucket: Immutable<number>;
  source_url: Immutable<string>;
  source_description: Immutable<string | null>;
  ts: Immutable<Date>;
}

export interface MarketCommentsTable {
  id: GeneratedImmutable<string>;
  market_id: Immutable<string>;
  user_id: Immutable<string>;
  parent_id: Immutable<string | null>;
  body: string | null;
  client_request_id: Immutable<string>;
  request_fingerprint: Immutable<string>;
  created_at: GeneratedImmutable<Date>;
  removed_at: Date | null;
}

export interface CommentRateLimitsTable {
  scope: Immutable<"user" | "network">;
  key: Immutable<string>;
  window_started_at: Date;
  post_count: number;
}

export interface RateLimitsTable {
  scope: Immutable<
    "quote" | "trade" | "tournament_register" | "tournament_login" | "ref" | "evidence"
  >;
  key: Immutable<string>;
  window_started_at: Date;
  request_count: number;
}

/** A tournament question is one of the dealer's two contracts (decision 0004). */
export type TournamentQuestionKind = "binary" | "forward";
/** A forward's unit; a binary has none. */
export type TournamentUnit = "USD_B" | "USD_T";
export type TournamentQuestionStatus = "draft" | "open" | "closed" | "resolved" | "voided";
export type TournamentProvider = "x" | "dev" | "password";

export interface TournamentUsersTable {
  id: GeneratedImmutable<string>;
  created_at: GeneratedImmutable<Date>;
  flagged: Generated<boolean>;
  flag_reason: string | null;
  /** Self-reported (lab, school, firm); shown beside the name, never verified. */
  affiliation: string | null;
  /**
   * A demo account (decision 0005, migration 015): trades to show the markets
   * working, labelled wherever it appears; it never signs in or forecasts.
   */
  demo: Generated<boolean>;
}

export interface TournamentPasswordCredentialsTable {
  user_id: Immutable<string>;
  username_normalized: Immutable<string>;
  password_hash: string;
  created_at: GeneratedImmutable<Date>;
  updated_at: Generated<Date>;
}

export interface TournamentIdentitiesTable {
  user_id: Immutable<string>;
  provider: Immutable<TournamentProvider>;
  provider_user_id: Immutable<string>;
  handle: string;
  handle_normalized: string;
  display_name: string;
  avatar_url: string | null;
  verified: boolean;
  provider_created_at: Date | null;
  last_login_at: Date;
}

export interface TournamentSessionsTable {
  id: Immutable<string>;
  user_id: Immutable<string>;
  created_at: GeneratedImmutable<Date>;
  expires_at: Date;
}

export interface TournamentQuestionsTable {
  id: GeneratedImmutable<string>;
  slug: string;
  title: string;
  description_md: string;
  rulebook_md: string;
  rulebook_version: number;
  kind: TournamentQuestionKind;
  /** Set iff `kind = 'forward'`. */
  unit: TournamentUnit | null;
  /** A forward's short name for its level, e.g. "First-day market cap" (migration 014). */
  level_label: Generated<string | null>;
  opens_at: Date;
  closes_at: Date;
  expiry_at: Date;
  closed_at: Date | null;
  status: TournamentQuestionStatus;
  min_account_age_days: Generated<number>;
  extremization: Generated<number>;
  x_thread_url: string | null;
  /** Who proposed the question, as they want it shown (migration 019). */
  proposed_by: Generated<string | null>;
  void_note_md: string | null;
  created_at: GeneratedImmutable<Date>;
}

export interface TournamentForecastEventsTable {
  id: GeneratedImmutable<string>;
  user_id: Immutable<string>;
  question_id: Immutable<string>;
  submitted_at: Immutable<Date>;
  /**
   * numeric; pg returns strings. A binary's P(YES) or a forward's level in the
   * question's unit: exactly one is set, except on legacy events (both null),
   * whose bucket vector is in `tournament_archived_forecast_vectors`.
   */
  p: Immutable<string | null>;
  value: Immutable<string | null>;
  client_hash: Immutable<string | null>;
  event_hash: Immutable<string>;
}

/** A pre-013 event's bucket vector, kept so its hash and Merkle leaf still verify. */
export interface TournamentArchivedForecastVectorsTable {
  event_id: Immutable<string>;
  /** numeric[]; pg parses the array's elements as numbers. */
  probs: Immutable<number[]>;
}

export interface TournamentResolutionsTable {
  id: GeneratedImmutable<string>;
  question_id: Immutable<string>;
  resolved_at: Immutable<Date>;
  /** A binary's outcome; exactly one of this and `resolved_value`. */
  outcome: Immutable<"yes" | "no" | null>;
  /** numeric; a forward's settling value in the question's unit. */
  resolved_value: Immutable<string | null>;
  rung_fired: Immutable<number | null>;
  source_url: Immutable<string | null>;
  source_excerpt: Immutable<string | null>;
  note_md: Immutable<string>;
  /** The admin who resolved it; null when the settle job did (migration 011). */
  resolver_user_id: Immutable<string | null>;
  /** The settle run that resolved a linked question; exactly one of this and the resolver. */
  settle_run_id: GeneratedImmutable<string | null>;
  superseded_by: string | null;
}

export interface TournamentResolutionNotesTable {
  id: GeneratedImmutable<string>;
  question_id: Immutable<string>;
  created_at: GeneratedImmutable<Date>;
  note_md: Immutable<string>;
}

export interface TournamentScoresTable {
  resolution_id: Immutable<string>;
  user_id: Immutable<string>;
  question_id: Immutable<string>;
  time_avg_log_score: Immutable<number>;
  final_log_score: Immutable<number>;
  coverage: Immutable<number>;
  computed_at: Immutable<Date>;
}

export interface TournamentAggregatesTable {
  id: GeneratedImmutable<string>;
  question_id: Immutable<string>;
  computed_at: Immutable<Date>;
  n_forecasters: Immutable<number>;
  /**
   * numeric; pg returns strings. The binary crowd P(YES) or the forward crowd
   * median in the question's unit: both null below one forecaster, else exactly one.
   */
  p: Immutable<string | null>;
  value: Immutable<string | null>;
  extremization: Immutable<number>;
  weighting_version: Immutable<string>;
}

export interface TournamentProvenanceBatchesTable {
  id: GeneratedImmutable<string>;
  hour_start: Immutable<Date>;
  root: Immutable<string>;
  leaf_count: Immutable<number>;
  memo: Immutable<string>;
  tx_signature: string | null;
  posted_at: Date | null;
  confirmed_at: Date | null;
  created_at: GeneratedImmutable<Date>;
}

export interface TournamentProvenanceLeavesTable {
  event_id: Immutable<string>;
  batch_id: Immutable<string>;
  leaf_index: Immutable<number>;
  path: Immutable<string[]>;
}

export type ListingTier = Tier;
export type BinaryEventKind = "priced_round" | "public_s1";
export type InstrumentKind = "binary" | "forward";
export type InstrumentState = "quoting" | "widened" | "resolved" | "expired";
export type EventFlagKind = FlagKind;
export type EventFlagConfidence = "high" | "medium" | "low";
export type CronRunStatus = "running" | "succeeded" | "failed";
export type QuoteReason = "list" | "requote" | "fill" | "widen" | "restore";
export type QuoteFlagState = "normal" | "widened";

export interface ListingsTable {
  id: GeneratedImmutable<string>;
  company_id: Immutable<string>;
  tier: Immutable<ListingTier>;
  binary_event: Immutable<BinaryEventKind>;
  kappa: Immutable<number>;
  /** bigint; pg returns strings. */
  cap_cents: Immutable<string>;
  b_cents: Immutable<string>;
  spread_floor: Immutable<number>;
  gamma: Immutable<number>;
  p_floor: Immutable<number>;
  forward_t_days: Immutable<number>;
  model_version: Immutable<string>;
  anchor_round: Immutable<string>;
  anchor_date: Immutable<string>;
  /** numeric; pg returns strings. */
  anchor_post_money_usd: Immutable<string>;
  anchor_source_url: Immutable<string>;
  anchor_source_rank: Immutable<number | null>;
  listed_at: Immutable<Date>;
  delisted_at: Date | null;
}

export interface InstrumentsTable {
  id: GeneratedImmutable<string>;
  listing_id: Immutable<string>;
  kind: Immutable<InstrumentKind>;
  epoch: Immutable<number>;
  question: Immutable<string>;
  opens_at: Immutable<Date>;
  expires_at: Immutable<Date>;
  entry_ref_ln: Immutable<number | null>;
  state: InstrumentState;
  widened_until: Date | null;
  closed_at: Date | null;
  resolution_json: JsonValue | null;
}

export interface EventFlagsTable {
  id: GeneratedImmutable<string>;
  company_id: Immutable<string>;
  kind: Immutable<EventFlagKind>;
  source_url: Immutable<string | null>;
  source_rank: Immutable<number | null>;
  observed_at: Immutable<Date>;
  published_at: Immutable<Date | null>;
  terms_json: Immutable<JsonObject>;
  confidence: Immutable<EventFlagConfidence>;
  dedupe_key: Immutable<string>;
  promoted_from: Immutable<string | null>;
  run_id: Immutable<string | null>;
  /** The tournament user behind a `user_submitted` flag; null on every other kind (011). */
  submitted_by: GeneratedImmutable<string | null>;
  /** What a `user_submitted` flag claims to be; null on every other kind (011). */
  submitted_kind: GeneratedImmutable<EvidenceKind | null>;
  created_at: GeneratedImmutable<Date>;
}

export type EventFlagReviewDecision = "confirmed" | "rejected";
/** The kinds a forecaster may submit evidence as (POST /api/t/questions/[slug]/evidence). */
export type EvidenceKind = "scoop" | "release" | "s1_public";

/** An admin's review of user-submitted evidence (migration 011); append-only, one per flag. */
export interface EventFlagReviewsTable {
  id: GeneratedImmutable<string>;
  flag_id: Immutable<string>;
  decision: Immutable<EventFlagReviewDecision>;
  /** The later independent flag that confirms it; set exactly when confirmed. */
  confirming_flag_id: Immutable<string | null>;
  reviewer_user_id: Immutable<string>;
  note: Immutable<string | null>;
  created_at: GeneratedImmutable<Date>;
}

/** A restricted-person self-attestation (migration 011); the latest per user is in force. */
export interface TournamentRestrictionAttestationsTable {
  id: GeneratedImmutable<string>;
  user_id: Immutable<string>;
  attested_at: GeneratedImmutable<Date>;
}

export interface TournamentRestrictionCompaniesTable {
  attestation_id: Immutable<string>;
  company_id: Immutable<string>;
}

export interface CronRunsTable {
  id: GeneratedImmutable<string>;
  job: Immutable<string>;
  run_id: Immutable<string>;
  started_at: GeneratedImmutable<Date>;
  finished_at: Date | null;
  status: CronRunStatus;
  detail_json: JsonValue | null;
}

export interface ModelMidsTable {
  id: GeneratedImmutable<string>;
  instrument_id: Immutable<string>;
  model_version: Immutable<string>;
  rulebook_version: Immutable<string>;
  computed_at: Immutable<Date>;
  mid_ln: Immutable<number | null>;
  p: Immutable<number | null>;
  inputs_json: Immutable<JsonValue>;
  run_id: Immutable<string | null>;
}

export interface QuotesTable {
  id: GeneratedImmutable<string>;
  instrument_id: Immutable<string>;
  posted_at: Immutable<Date>;
  reason: Immutable<QuoteReason>;
  model_mid_id: Immutable<string | null>;
  mid_ln: Immutable<number | null>;
  bid_ln: Immutable<number | null>;
  ask_ln: Immutable<number | null>;
  price: Immutable<number | null>;
  half_spread: Immutable<number | null>;
  inventory_cents: Immutable<string>;
  cap_cents_effective: Immutable<string>;
  flag_state: Immutable<QuoteFlagState>;
  trade_id: Immutable<string | null>;
  model_version: Immutable<string>;
  rulebook_version: Immutable<string>;
  /** Tape order: quotes posted at one instant are ordered by this (migration 009). */
  sequence: ColumnType<string, never, never>;
}

export interface ForwardPositionsTable {
  id: GeneratedImmutable<string>;
  instrument_id: Immutable<string>;
  user_id: Immutable<string>;
  trade_id: Immutable<string>;
  side: Immutable<ForwardSide>;
  notional_cents: Immutable<string>;
  entry_ln: Immutable<number>;
  collateral_cents: Immutable<string>;
  opened_at: Immutable<Date>;
  settled_at: Date | null;
  settle_ln: number | null;
  payout_cents: string | null;
  voided_at: Date | null;
}

export interface ReferencePricesTable {
  id: GeneratedImmutable<string>;
  listing_id: Immutable<string>;
  kind: Immutable<InstrumentKind>;
  as_of: Immutable<Date>;
  value: Immutable<number>;
  blend_version: Immutable<string>;
  model_version: Immutable<string>;
  rulebook_version: Immutable<string>;
  w_model: Immutable<number>;
  w_traded: Immutable<number>;
  w_crowd: Immutable<number>;
  components_json: Immutable<JsonValue>;
}

export interface TournamentInstrumentLinksTable {
  id: GeneratedImmutable<string>;
  question_id: Immutable<string>;
  instrument_id: Immutable<string>;
}

export interface SourceHealthTable {
  source: Immutable<string>;
  last_success_at: Date | null;
  last_error_at: Date | null;
  last_error: string | null;
}

/** The reference API's keyed tier (migration 010); only the key's SHA-256 is stored. */
export interface ApiKeysTable {
  id: GeneratedImmutable<string>;
  name: Immutable<string>;
  key_hash: Immutable<string>;
  quota_per_minute: number;
  created_at: GeneratedImmutable<Date>;
  revoked_at: Date | null;
  /** Migration 018: `design_partner` keys expire; `standard` keys do not. */
  tier: ColumnType<ApiKeyTier, ApiKeyTier | undefined, never>;
  expires_at: ColumnType<Date | null, Date | null | undefined, never>;
}

export type ApiKeyTier = "design_partner" | "standard";

/** Served requests per key per UTC day (migration 018). */
export interface ApiKeyUsageTable {
  key_id: Immutable<string>;
  day: Immutable<string>;
  request_count: number;
}

/** The `dealer_pnl` view (migration 009): cents, from the dealer's side. */
export interface DealerPnlView {
  listing_id: ColumnType<string, never, never>;
  company: ColumnType<string, never, never>;
  instrument_id: ColumnType<string, never, never>;
  kind: ColumnType<InstrumentKind, never, never>;
  epoch: ColumnType<number, never, never>;
  state: ColumnType<InstrumentState, never, never>;
  market_id: ColumnType<string, never, never>;
  market_status: ColumnType<MarketStatus, never, never>;
  /** bigint; pg returns strings. */
  realised_cents: ColumnType<string, never, never>;
  open_collateral_cents: ColumnType<string, never, never>;
  unrealised_cents: ColumnType<number, never, never>;
  bound_cents: ColumnType<number, never, never>;
  latest_mid_ln: ColumnType<number | null, never, never>;
  current_metric: ColumnType<number, never, never>;
}

/*
 * The marks index (migration 020; docs/prompts/v2/README.md, "Data model").
 * `numeric` columns arrive from pg as decimal strings and are written as
 * strings, so no per-share mark passes through a float. Only
 * `filer_marks.superseded_by` (once) and `issuers`' watchlist fields change
 * after insert; triggers hold source_documents and corrections append-only.
 */

/** `source_documents.source_class`: the rulebook's classes; `source_rank` is `sourceRank(class)`. */
export type IndexSourceClass = SourceClass;

/** `filer_marks.security_kind`: the engine's kinds (src/lib/engine/index/series.ts). */
export type { SecurityKind };

/** A decimal string: pg's representation of `numeric`. */
type Numeric = string;

export interface IssuersTable {
  id: GeneratedImmutable<string>;
  slug: Immutable<string>;
  name: string;
  legal_name: string | null;
  search_phrases: ColumnType<string[], string, string>;
  match_pattern: string;
  incorporation_state: string | null;
  incorporation_source_id: string | null;
  watchlisted: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: GeneratedImmutable<Date>;
  /** The date of the issuer's final IPO prospectus on EDGAR (migration 022); null while private. */
  listed_on: ColumnType<string | null, string | null | undefined, string | null>;
  listing_url: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface SourceDocumentsTable {
  id: GeneratedImmutable<string>;
  source_class: Immutable<IndexSourceClass>;
  source_rank: Immutable<number>;
  accession: Immutable<string | null>;
  document_url: Immutable<string>;
  filer_cik: Immutable<string | null>;
  filer_name: Immutable<string>;
  fund_series_id: Immutable<string | null>;
  fund_series_name: Immutable<string | null>;
  form_type: Immutable<string | null>;
  filed_on: Immutable<string | null>;
  period_end: Immutable<string | null>;
  fetched_at: Immutable<Date>;
  content_sha256: Immutable<string>;
  parser_version: Immutable<string>;
}

export interface FilerMarksTable {
  id: GeneratedImmutable<string>;
  document_id: Immutable<string>;
  issuer_id: Immutable<string>;
  holding_index: Immutable<number>;
  holding_name: Immutable<string>;
  holding_title: Immutable<string>;
  asset_category: Immutable<string | null>;
  security_label: Immutable<string>;
  security_kind: Immutable<SecurityKind>;
  balance: Immutable<Numeric | null>;
  units: Immutable<string | null>;
  value_usd: Immutable<Numeric>;
  mark_per_share_usd: Immutable<Numeric | null>;
  fair_value_level: Immutable<string | null>;
  is_restricted: Immutable<boolean | null>;
  as_of: Immutable<string>;
  /** Set once, when a later filing replaces this row. */
  superseded_by: ColumnType<string | null, string | null | undefined, string>;
  correction_id: Immutable<string | null>;
  created_at: GeneratedImmutable<Date>;
}

export type PrintOrigin = "events.csv" | "certificate" | "form_d";

export interface PrintsTable {
  id: GeneratedImmutable<string>;
  issuer_id: Immutable<string>;
  round_name: Immutable<string>;
  event_type: string;
  announced_on: string;
  post_money_usd: Numeric | null;
  amount_raised_usd: Numeric | null;
  series_label: string | null;
  price_per_share_usd: Numeric | null;
  price_source_id: string | null;
  source_url: string | null;
  origin: PrintOrigin;
}

export interface CertificatesTable {
  id: GeneratedImmutable<string>;
  issuer_id: Immutable<string>;
  document_id: Immutable<string>;
  filed_on: Immutable<string>;
  kind: Immutable<"restated" | "amendment">;
  entered_by: Immutable<string>;
  notes: string | null;
  /** SHA-256 of the transcription as imported (migration 022). */
  transcription_sha256: Immutable<string>;
  /** Set once, when a changed transcription corrects this one. */
  superseded_by: ColumnType<string | null, string | null | undefined, string>;
  correction_id: Immutable<string | null>;
  created_at: GeneratedImmutable<Date>;
  /** Migration 023: the series the filing creates. */
  newest_series_label: Immutable<string>;
  common_shares_authorized: Immutable<Numeric | null>;
  unmodelled_terms: ColumnType<string[], string | undefined, never>;
}

export interface CertificateSeriesTable {
  id: GeneratedImmutable<string>;
  certificate_id: Immutable<string>;
  series_label: Immutable<string>;
  original_issue_price_usd: Immutable<Numeric>;
  liquidation_multiple: Immutable<Numeric>;
  participating: Immutable<boolean>;
  participation_cap_multiple: Immutable<Numeric | null>;
  seniority: Immutable<number>;
  shares_authorized: Immutable<Numeric>;
  conversion_price_usd: Immutable<Numeric | null>;
  ratchet: Immutable<JsonValue | null>;
}

export type SpvMatchMethod = "alias" | "manual" | "unmatched";

export interface SpvVehiclesTable {
  id: GeneratedImmutable<string>;
  document_id: Immutable<string>;
  issuer_id: string | null;
  vehicle_name: Immutable<string>;
  vehicle_cik: Immutable<string>;
  related_persons: ColumnType<JsonValue, string | undefined, string>;
  jurisdiction: Immutable<string | null>;
  total_offering_usd: Immutable<Numeric | null>;
  total_sold_usd: Immutable<Numeric | null>;
  min_investment_usd: Immutable<Numeric | null>;
  sales_commission_usd: Immutable<Numeric | null>;
  finders_fee_usd: Immutable<Numeric | null>;
  first_sale_on: Immutable<string | null>;
  match_method: SpvMatchMethod;
  match_note: string | null;
}

export interface SpvQuotesTable {
  id: GeneratedImmutable<string>;
  issuer_id: Immutable<string>;
  spv_vehicle_id: Immutable<string | null>;
  document_id: Immutable<string>;
  platform: Immutable<string>;
  quoted_price_per_share_usd: Immutable<Numeric | null>;
  quoted_valuation_usd: Immutable<Numeric | null>;
  upfront_fee_pct: Immutable<Numeric | null>;
  mgmt_fee_pct: Immutable<Numeric | null>;
  carry_pct: Immutable<Numeric | null>;
  layers: ColumnType<number, number | undefined, never>;
  captured_at: Immutable<Date>;
}

export interface CorrectionsTable {
  id: GeneratedImmutable<string>;
  published_at: Immutable<Date>;
  methodology_version: Immutable<string>;
  kind: Immutable<"row" | "methodology" | "parser">;
  summary: Immutable<string>;
  diff_md: Immutable<string>;
  affected: ColumnType<JsonValue, string, never>;
}

export type IngestRunStatus = "running" | "ok" | "failed";

export interface IngestRunsTable {
  id: GeneratedImmutable<string>;
  source_class: Immutable<IndexSourceClass>;
  started_at: GeneratedImmutable<Date>;
  finished_at: Date | null;
  status: IngestRunStatus;
  documents_seen: ColumnType<number, number | undefined, number>;
  documents_new: ColumnType<number, number | undefined, number>;
  marks_new: ColumnType<number, number | undefined, number>;
  error: string | null;
}

export interface Database {
  companies: CompaniesTable;
  markets: MarketsTable;
  users: UsersTable;
  holdings: HoldingsTable;
  trades: TradesTable;
  marks: MarksTable;
  settlements: SettlementsTable;
  market_comments: MarketCommentsTable;
  comment_rate_limits: CommentRateLimitsTable;
  rate_limits: RateLimitsTable;
  tournament_users: TournamentUsersTable;
  tournament_identities: TournamentIdentitiesTable;
  tournament_sessions: TournamentSessionsTable;
  tournament_questions: TournamentQuestionsTable;
  tournament_forecast_events: TournamentForecastEventsTable;
  tournament_archived_forecast_vectors: TournamentArchivedForecastVectorsTable;
  tournament_resolutions: TournamentResolutionsTable;
  tournament_resolution_notes: TournamentResolutionNotesTable;
  tournament_scores: TournamentScoresTable;
  tournament_aggregates: TournamentAggregatesTable;
  tournament_provenance_batches: TournamentProvenanceBatchesTable;
  tournament_provenance_leaves: TournamentProvenanceLeavesTable;
  tournament_password_credentials: TournamentPasswordCredentialsTable;
  listings: ListingsTable;
  instruments: InstrumentsTable;
  event_flags: EventFlagsTable;
  cron_runs: CronRunsTable;
  model_mids: ModelMidsTable;
  quotes: QuotesTable;
  forward_positions: ForwardPositionsTable;
  reference_prices: ReferencePricesTable;
  tournament_instrument_links: TournamentInstrumentLinksTable;
  source_health: SourceHealthTable;
  dealer_pnl: DealerPnlView;
  api_keys: ApiKeysTable;
  api_key_usage: ApiKeyUsageTable;
  event_flag_reviews: EventFlagReviewsTable;
  tournament_restriction_attestations: TournamentRestrictionAttestationsTable;
  tournament_restriction_companies: TournamentRestrictionCompaniesTable;
  issuers: IssuersTable;
  source_documents: SourceDocumentsTable;
  filer_marks: FilerMarksTable;
  prints: PrintsTable;
  certificates: CertificatesTable;
  certificate_series: CertificateSeriesTable;
  spv_vehicles: SpvVehiclesTable;
  spv_quotes: SpvQuotesTable;
  corrections: CorrectionsTable;
  ingest_runs: IngestRunsTable;
}

export type CompanyRow = Selectable<CompaniesTable>;
export type CompanyInsert = Insertable<CompaniesTable>;
export type CompanyUpdate = Updateable<CompaniesTable>;

export type MarketRow = Selectable<MarketsTable>;
export type MarketInsert = Insertable<MarketsTable>;
export type MarketUpdate = Updateable<MarketsTable>;

export type UserRow = Selectable<UsersTable>;
export type UserInsert = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

export type HoldingRow = Selectable<HoldingsTable>;
export type HoldingInsert = Insertable<HoldingsTable>;
export type HoldingUpdate = Updateable<HoldingsTable>;

export type TradeRow = Selectable<TradesTable>;
export type TradeInsert = Insertable<TradesTable>;
export type TradeUpdate = Updateable<TradesTable>;

export type MarkRow = Selectable<MarksTable>;
export type MarkInsert = Insertable<MarksTable>;
export type MarkUpdate = Updateable<MarksTable>;

export type SettlementRow = Selectable<SettlementsTable>;
export type SettlementInsert = Insertable<SettlementsTable>;
export type SettlementUpdate = Updateable<SettlementsTable>;

export type ListingRow = Selectable<ListingsTable>;
export type ListingInsert = Insertable<ListingsTable>;
export type ListingUpdate = Updateable<ListingsTable>;

export type InstrumentRow = Selectable<InstrumentsTable>;
export type InstrumentInsert = Insertable<InstrumentsTable>;
export type InstrumentUpdate = Updateable<InstrumentsTable>;

export type EventFlagRow = Selectable<EventFlagsTable>;
export type EventFlagInsert = Insertable<EventFlagsTable>;

export type CronRunRow = Selectable<CronRunsTable>;
export type CronRunInsert = Insertable<CronRunsTable>;
export type CronRunUpdate = Updateable<CronRunsTable>;

export type ModelMidRow = Selectable<ModelMidsTable>;
export type ModelMidInsert = Insertable<ModelMidsTable>;

export type QuoteRow = Selectable<QuotesTable>;
export type QuoteInsert = Insertable<QuotesTable>;

export type ForwardPositionRow = Selectable<ForwardPositionsTable>;
export type ForwardPositionInsert = Insertable<ForwardPositionsTable>;
export type ForwardPositionUpdate = Updateable<ForwardPositionsTable>;

export type ReferencePriceRow = Selectable<ReferencePricesTable>;
export type ReferencePriceInsert = Insertable<ReferencePricesTable>;

export type IssuerRow = Selectable<IssuersTable>;
export type IssuerInsert = Insertable<IssuersTable>;
export type SourceDocumentRow = Selectable<SourceDocumentsTable>;
export type SourceDocumentInsert = Insertable<SourceDocumentsTable>;
export type FilerMarkRow = Selectable<FilerMarksTable>;
export type FilerMarkInsert = Insertable<FilerMarksTable>;
export type PrintRow = Selectable<PrintsTable>;
export type PrintInsert = Insertable<PrintsTable>;
export type CertificateRow = Selectable<CertificatesTable>;
export type CertificateSeriesRow = Selectable<CertificateSeriesTable>;
export type SpvVehicleRow = Selectable<SpvVehiclesTable>;
export type SpvQuoteRow = Selectable<SpvQuotesTable>;
export type CorrectionRow = Selectable<CorrectionsTable>;
export type IngestRunRow = Selectable<IngestRunsTable>;
