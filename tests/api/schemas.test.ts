import { describe, expect, it } from "vitest";

import { USD_MAX_LENGTH } from "../../src/lib/api/money.js";

import { quoteInputSchema, tradeInputSchema } from "../../src/lib/api/schemas.js";

const quoteBase = {
  market_id: "0f8a0c1e-6c1d-4f7a-9d2b-3c4e5f607182",
  side: "yes" as const,
  strike_index: 0,
};
const idempotencyKey = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const lineTerminators = ["\n", "\r\n", "\u2028", "\u2029"];

describe("service input schemas", () => {
  it("rejects trailing line terminators and overlong USD fields", () => {
    for (const terminator of lineTerminators) {
      expect(
        quoteInputSchema.safeParse({
          ...quoteBase,
          market_id: `${quoteBase.market_id}${terminator}`,
          action: "buy",
          quantity: 1,
        }).success,
      ).toBe(false);
      expect(
        quoteInputSchema.safeParse({
          ...quoteBase,
          action: "buy",
          spend_usd: `1.00${terminator}`,
        }).success,
      ).toBe(false);
    }

    expect(
      quoteInputSchema.safeParse({
        ...quoteBase,
        action: "buy",
        spend_usd: "9".repeat(USD_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("enforces buy quantity/spend XOR and sell quantity-only", () => {
    expect(
      quoteInputSchema.safeParse({
        ...quoteBase,
        action: "buy",
        quantity: 0.000001,
      }).success,
    ).toBe(true);
    expect(
      quoteInputSchema.safeParse({
        ...quoteBase,
        action: "buy",
        spend_usd: "0.01",
      }).success,
    ).toBe(true);
    expect(
      quoteInputSchema.safeParse({
        ...quoteBase,
        action: "sell",
        quantity: 1,
      }).success,
    ).toBe(true);

    for (const input of [
      { ...quoteBase, action: "buy" },
      {
        ...quoteBase,
        action: "buy",
        quantity: 1,
        spend_usd: "1.00",
      },
      {
        ...quoteBase,
        action: "sell",
        quantity: 1,
        spend_usd: "1.00",
      },
      { ...quoteBase, action: "sell", spend_usd: "1.00" },
      { ...quoteBase, action: "buy", quantity: 0.0000009 },
      { ...quoteBase, action: "buy", spend_usd: "0.001" },
      { ...quoteBase, action: "buy", quantity: 1, unexpected: true },
    ]) {
      expect(quoteInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("requires a UUID and the action-specific trade guard", () => {
    expect(
      tradeInputSchema.safeParse({
        ...quoteBase,
        action: "buy",
        spend_usd: "5.00",
        max_cost_usd: "5.00",
        idempotency_key: idempotencyKey,
      }).success,
    ).toBe(true);
    expect(
      tradeInputSchema.safeParse({
        ...quoteBase,
        action: "sell",
        quantity: 1,
        min_proceeds_usd: "0.00",
        idempotency_key: idempotencyKey,
      }).success,
    ).toBe(true);

    expect(
      tradeInputSchema.parse({
        ...quoteBase,
        action: "buy",
        quantity: 1,
        max_cost_usd: "1.00",
        idempotency_key: idempotencyKey.toUpperCase(),
      }).idempotency_key,
    ).toBe(idempotencyKey);

    for (const input of [
      {
        ...quoteBase,
        action: "buy",
        quantity: 1,
        max_cost_usd: "1.00",
        idempotency_key: "not-a-uuid",
      },
      {
        ...quoteBase,
        action: "buy",
        quantity: 1,
        min_proceeds_usd: "1.00",
        idempotency_key: idempotencyKey,
      },
      {
        ...quoteBase,
        action: "sell",
        quantity: 1,
        spend_usd: "1.00",
        min_proceeds_usd: "1.00",
        idempotency_key: idempotencyKey,
      },
    ]) {
      expect(tradeInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("addresses a binary by market id alone, at strike index 0", () => {
    const { market_id: _marketId, ...noBook } = quoteBase;
    for (const input of [
      { ...noBook, action: "buy", quantity: 1 },
      { ...quoteBase, slug: "anthropic", action: "buy", quantity: 1 },
      { ...noBook, slug: "anthropic", action: "buy", quantity: 1 },
      { ...quoteBase, strike_index: 31, action: "buy", quantity: 1 },
    ]) {
      expect(quoteInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("caps trade quantity and spend", () => {
    expect(
      quoteInputSchema.safeParse({ ...quoteBase, action: "buy", quantity: 1e308 }).success,
    ).toBe(false);
    expect(
      quoteInputSchema.safeParse({ ...quoteBase, action: "buy", spend_usd: "1000000001.00" })
        .success,
    ).toBe(false);
    expect(
      quoteInputSchema.safeParse({ ...quoteBase, action: "buy", spend_usd: "1000000000.00" })
        .success,
    ).toBe(true);
    expect(
      tradeInputSchema.safeParse({
        ...quoteBase,
        action: "buy",
        quantity: 5,
        max_cost_usd: "1000000001.00",
        idempotency_key: idempotencyKey,
      }).success,
    ).toBe(false);
  });
});
