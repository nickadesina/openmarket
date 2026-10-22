import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

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
  scope: Immutable<"quote" | "trade" | "tournament_register" | "tournament_login" | "ref">;
  key: Immutable<string>;
  window_started_at: Date;
  request_count: number;
}

export type TournamentUnit = "USD_B" | "USD_T" | "bool";
export type TournamentQuestionStatus = "draft" | "open" | "closed" | "resolved" | "voided";
export type TournamentProvider = "x" | "dev" | "password";

export interface TournamentUsersTable {
  id: GeneratedImmutable<string>;
  created_at: GeneratedImmutable<Date>;
  flagged: Generated<boolean>;
  flag_reason: string | null;
  /** Self-reported (lab, school, firm); shown beside the name, never verified. */
  affiliation: string | null;
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
  unit: TournamentUnit;
  bucket_count: number;
  opens_at: Date;
  closes_at: Date;
  expiry_at: Date;
  closed_at: Date | null;
  status: TournamentQuestionStatus;
  min_account_age_days: Generated<number>;
  extremization: Generated<number>;
  x_thread_url: string | null;
  void_note_md: string | null;
  created_at: GeneratedImmutable<Date>;
}

export interface TournamentBucketsTable {
  question_id: Immutable<string>;
  index: Immutable<number>;
  kind: Immutable<"range" | "floor">;
  /** numeric; pg returns strings. */
  lower: Immutable<string | null>;
  upper: Immutable<string | null>;
  label: Immutable<string>;
}

export interface TournamentForecastEventsTable {
  id: GeneratedImmutable<string>;
  user_id: Immutable<string>;
  question_id: Immutable<string>;
  submitted_at: Immutable<Date>;
  /** numeric[]; pg returns strings. */
  probs: Immutable<string[]>;
  client_hash: Immutable<string | null>;
  event_hash: Immutable<string>;
}

export interface TournamentResolutionsTable {
  id: GeneratedImmutable<string>;
  question_id: Immutable<string>;
  resolved_at: Immutable<Date>;
  winning_bucket_index: Immutable<number>;
  resolved_value: Immutable<string | null>;
  rung_fired: Immutable<number | null>;
  source_url: Immutable<string | null>;
  source_excerpt: Immutable<string | null>;
  note_md: Immutable<string>;
  resolver_user_id: Immutable<string>;
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
  probs: Immutable<string[] | null>;
  n_forecasters: Immutable<number>;
  median_value: Immutable<string | null>;
  p_floor: Immutable<string | null>;
  p_yes: Immutable<string | null>;
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

export type ListingTier = "mega" | "redhot";
export type BinaryEventKind = "priced_round" | "public_s1";
export type InstrumentKind = "binary" | "forward";
export type InstrumentState = "quoting" | "widened" | "resolved" | "expired";
export type EventFlagKind =
  | "form_d"
  | "form_d_amend"
  | "charter"
  | "scoop"
  | "release"
  | "s1_public"
  | "print"
  | "user_submitted";
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
  created_at: GeneratedImmutable<Date>;
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
  tournament_buckets: TournamentBucketsTable;
  tournament_forecast_events: TournamentForecastEventsTable;
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
