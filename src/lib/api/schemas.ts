import { z } from "zod";

import { MAX_QUANTITY, MAX_TRADE_SPEND_CENTS, MIN_QUANTITY } from "../engine/types.js";
import { parseUsdToCents, USD_MAX_LENGTH } from "./money.js";

const quantitySchema = z.number().finite().min(MIN_QUANTITY).max(MAX_QUANTITY);
const idempotencyKeySchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
/** A dealer binary has one strike: its two outcomes split at index 0. */
const strikeIndexSchema = z.literal(0);

function isTradeUsd(value: string, allowZero: boolean): boolean {
  try {
    const cents = parseUsdToCents(value);
    return (allowZero ? cents >= 0 : cents > 0) && cents <= MAX_TRADE_SPEND_CENTS;
  } catch {
    return false;
  }
}

/** Trade money is capped; settlement values are not. */
const positiveTradeUsdSchema = z
  .string()
  .max(USD_MAX_LENGTH)
  .refine(
    (value) => isTradeUsd(value, false),
    "Must be a positive USD amount within the trade ceiling",
  );
const nonnegativeTradeUsdSchema = z
  .string()
  .max(USD_MAX_LENGTH)
  .refine(
    (value) => isTradeUsd(value, true),
    "Must be a non-negative USD amount within the trade ceiling",
  );
/** An LMSR quote or trade addresses a dealer binary's book by `market_id`. */
const quoteFields = {
  market_id: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  side: z.enum(["yes", "no"]),
  strike_index: strikeIndexSchema,
} as const;

const buyQuantityQuoteSchema = z
  .object({
    ...quoteFields,
    action: z.literal("buy"),
    quantity: quantitySchema,
  })
  .strict();
const buySpendQuoteSchema = z
  .object({
    ...quoteFields,
    action: z.literal("buy"),
    spend_usd: positiveTradeUsdSchema,
  })
  .strict();
const sellQuoteSchema = z
  .object({
    ...quoteFields,
    action: z.literal("sell"),
    quantity: quantitySchema,
  })
  .strict();

export const quoteInputSchema = z.union([
  buyQuantityQuoteSchema,
  buySpendQuoteSchema,
  sellQuoteSchema,
]);

const tradeFields = {
  ...quoteFields,
  idempotency_key: idempotencyKeySchema,
} as const;

const buyQuantityTradeSchema = z
  .object({
    ...tradeFields,
    action: z.literal("buy"),
    quantity: quantitySchema,
    max_cost_usd: positiveTradeUsdSchema,
  })
  .strict();
const buySpendTradeSchema = z
  .object({
    ...tradeFields,
    action: z.literal("buy"),
    spend_usd: positiveTradeUsdSchema,
    max_cost_usd: positiveTradeUsdSchema,
  })
  .strict();
const sellTradeSchema = z
  .object({
    ...tradeFields,
    action: z.literal("sell"),
    quantity: quantitySchema,
    min_proceeds_usd: nonnegativeTradeUsdSchema,
  })
  .strict();

export const tradeInputSchema = z.union([
  buyQuantityTradeSchema,
  buySpendTradeSchema,
  sellTradeSchema,
]);

/** A dealer book or instrument id: a UUID, compared lower-case. */
const bookIdSchema = idempotencyKeySchema;
export const marketIdSchema = bookIdSchema;
const entryLnSchema = z.number().finite();

/** `GET /api/instruments/[instrumentId]/quote`: a side and notional preview a fill, or neither. */
export const forwardQuoteQuerySchema = z
  .object({
    side: z.enum(["long", "short"]).optional(),
    notional_usd: positiveTradeUsdSchema.optional(),
  })
  .strict()
  .refine((input) => (input.side === undefined) === (input.notional_usd === undefined), {
    message: "side and notional_usd go together",
  });

const forwardTradeFields = {
  idempotency_key: idempotencyKeySchema,
  instrument_id: bookIdSchema,
  notional_usd: positiveTradeUsdSchema,
} as const;

/**
 * `POST /api/forward/trade`. The guard is the worst entry the caller accepts:
 * the highest ask for a long, the lowest bid for a short, in ln USD.
 */
export const forwardTradeInputSchema = z.discriminatedUnion("side", [
  z
    .object({ ...forwardTradeFields, side: z.literal("long"), max_entry_ln: entryLnSchema })
    .strict(),
  z
    .object({ ...forwardTradeFields, side: z.literal("short"), min_entry_ln: entryLnSchema })
    .strict(),
]);

export const commentIdSchema = idempotencyKeySchema;

export const commentInputSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .refine((body) => !body.includes("\0")),
    parentId: commentIdSchema.optional(),
    clientRequestId: commentIdSchema,
    expectedUserId: commentIdSchema,
  })
  .strict();

export const removeCommentInputSchema = z.object({}).strict();

export type CommentInput = z.infer<typeof commentInputSchema>;

export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type TradeInput = z.infer<typeof tradeInputSchema>;
export type ForwardQuoteQuery = z.infer<typeof forwardQuoteQuerySchema>;
export type ForwardTradeInput = z.infer<typeof forwardTradeInputSchema>;
