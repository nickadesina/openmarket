import type {
  ColumnType,
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from "kysely";

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

export interface Database {
  companies: CompaniesTable;
  markets: MarketsTable;
  users: UsersTable;
  holdings: HoldingsTable;
  trades: TradesTable;
  marks: MarksTable;
  settlements: SettlementsTable;
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
