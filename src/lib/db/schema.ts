import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

export type MarketStatus = "open" | "settled";
export type MetricKind = "valuation_median" | "yes_probability";
export type TradeAction = "buy" | "sell";
export type ContractSide = "yes" | "no";

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
}

export interface UsersTable {
  id: GeneratedImmutable<string>;
  username: string;
  username_normalized: string;
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
  scope: Immutable<"admin_login" | "user_create" | "quote" | "trade">;
  key: Immutable<string>;
  window_started_at: Date;
  request_count: number;
}

export type TournamentUnit = "USD_B" | "USD_T" | "bool";
export type TournamentQuestionStatus = "draft" | "open" | "closed" | "resolved" | "voided";
export type TournamentProvider = "x" | "dev";

export interface TournamentUsersTable {
  id: GeneratedImmutable<string>;
  created_at: GeneratedImmutable<Date>;
  flagged: Generated<boolean>;
  flag_reason: string | null;
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
