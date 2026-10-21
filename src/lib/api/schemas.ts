import { z } from "zod";

import { VALUATION_BOUNDARIES_USD } from "../engine/buckets.js";
import { MAX_QUANTITY, MAX_TRADE_SPEND_CENTS, MIN_QUANTITY } from "../engine/types.js";
import { USERNAME_PATTERN } from "../services/user.js";
import { parseUsdToCents, USD_MAX_LENGTH } from "./money.js";

const usernameSchema = z.string().regex(USERNAME_PATTERN);
const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/);
const quantitySchema = z.number().finite().min(MIN_QUANTITY).max(MAX_QUANTITY);
const idempotencyKeySchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const strikeIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(VALUATION_BOUNDARIES_USD.length - 1);

function isUsd(value: string, allowZero: boolean): boolean {
  try {
    const cents = parseUsdToCents(value);
    return allowZero ? cents >= 0 : cents > 0;
  } catch {
    return false;
  }
}

const positiveUsdSchema = z
  .string()
  .max(USD_MAX_LENGTH)
  .refine((value) => isUsd(value, false), "Must be a positive USD amount");
const nonnegativeUsdSchema = z
  .string()
  .max(USD_MAX_LENGTH)
  .refine((value) => isUsd(value, true), "Must be a non-negative USD amount");

function isTradeUsd(value: string, allowZero: boolean): boolean {
  try {
    const cents = parseUsdToCents(value);
    return (allowZero ? cents >= 0 : cents > 0) && cents <= MAX_TRADE_SPEND_CENTS;
  } catch {
    return false;
  }
}

/** Trade money is capped; seed anchors and settlement values are not. */
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
const httpUrlSchema = z
  .string()
  .max(4_096)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Must be an HTTP(S) URL");

export const usernameInputSchema = z
  .object({
    username: usernameSchema,
  })
  .strict();

/**
 * A book is addressed by `market_id` (a dealer binary) or by `slug` (a
 * company's ladder market, which has no instrument); exactly one of them.
 */
const quoteFields = {
  slug: slugSchema.optional(),
  market_id: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase())
    .optional(),
  side: z.enum(["yes", "no"]),
  strike_index: strikeIndexSchema,
} as const;

function oneBook(input: {
  readonly slug?: string | undefined;
  readonly market_id?: string | undefined;
}): boolean {
  return (input.slug === undefined) !== (input.market_id === undefined);
}
const ONE_BOOK = { message: "Give exactly one of slug or market_id" } as const;

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

export const quoteInputSchema = z
  .union([buyQuantityQuoteSchema, buySpendQuoteSchema, sellQuoteSchema])
  .refine(oneBook, ONE_BOOK);

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

export const tradeInputSchema = z
  .union([buyQuantityTradeSchema, buySpendTradeSchema, sellTradeSchema])
  .refine(oneBook, ONE_BOOK);

/** A dealer book or instrument id: a UUID, compared lower-case. */
const bookIdSchema = idempotencyKeySchema;
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

const seedFields = {
  name: z.string().trim().min(1).max(200),
  slug: slugSchema,
  logo_path: z.string().trim().min(1).max(2_048),
  b: z.number().finite().positive(),
} as const;

const valuationSeedSchema = z
  .object({
    ...seedFields,
    metric_kind: z.literal("valuation_median"),
    anchor_valuation_usd: positiveUsdSchema,
    anchor_date: z.iso.date(),
    anchor_description: z.string().trim().min(1).max(1_000),
    sigma: z.number().finite().positive(),
  })
  .strict();
const binarySeedSchema = z
  .object({
    ...seedFields,
    metric_kind: z.literal("yes_probability"),
    yes_probability: z.number().finite().gt(0).lt(1),
  })
  .strict();

export const seedInputSchema = z.discriminatedUnion("metric_kind", [
  valuationSeedSchema,
  binarySeedSchema,
]);

export const settlementInputSchema = z
  .object({
    slug: slugSchema,
    confirm_slug: slugSchema,
    settled_value_usd: nonnegativeUsdSchema,
    source_url: httpUrlSchema,
    source_description: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .refine((input) => input.slug === input.confirm_slug, {
    message: "Confirmation slug must match slug",
    path: ["confirm_slug"],
  });

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

export type UsernameInput = z.infer<typeof usernameInputSchema>;
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type TradeInput = z.infer<typeof tradeInputSchema>;
export type SeedInput = z.infer<typeof seedInputSchema>;
export type SettlementInput = z.infer<typeof settlementInputSchema>;
export type ForwardQuoteQuery = z.infer<typeof forwardQuoteQuerySchema>;
export type ForwardTradeInput = z.infer<typeof forwardTradeInputSchema>;
