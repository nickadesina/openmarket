import { z } from "zod";

import { VALUATION_BOUNDARIES_USD } from "../engine/buckets.js";
import { MAX_QUANTITY, MAX_TRADE_SPEND_CENTS, MIN_QUANTITY } from "../engine/types.js";
import { parseUsdToCents, USD_MAX_LENGTH } from "./money.js";

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
const httpUrlSchema = z
  .string()
  .max(4_096)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Must be an HTTP(S) URL");

const quoteFields = {
  slug: slugSchema,
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

export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type TradeInput = z.infer<typeof tradeInputSchema>;
export type SettlementInput = z.infer<typeof settlementInputSchema>;
