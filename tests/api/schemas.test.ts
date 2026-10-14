import { describe, expect, it } from "vitest";

import { USD_MAX_LENGTH } from "../../src/lib/api/money.js";

import {
  quoteInputSchema,
  seedInputSchema,
  settlementInputSchema,
  tradeInputSchema,
  usernameInputSchema,
} from "../../src/lib/api/schemas.js";

const quoteBase = {
  slug: "anthropic",
  side: "yes" as const,
  strike_index: 31,
};
const idempotencyKey = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const lineTerminators = ["\n", "\r\n", "\u2028", "\u2029"];

describe("service input schemas", () => {
  it("validates username boundaries and rejects unknown keys", () => {
    expect(usernameInputSchema.parse({ username: "Ab_" })).toEqual({
      username: "Ab_",
    });
    expect(usernameInputSchema.safeParse({ username: "a".repeat(20) }).success).toBe(true);

    for (const input of [
      { username: "ab" },
      { username: "a".repeat(21) },
      { username: "bad-name" },
      { username: "valid_name", user_id: "injected" },
    ]) {
      expect(usernameInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("rejects trailing line terminators and overlong USD fields", () => {
    for (const terminator of lineTerminators) {
      expect(usernameInputSchema.safeParse({ username: `Alice${terminator}` }).success).toBe(false);
      expect(
        quoteInputSchema.safeParse({
          ...quoteBase,
          slug: `anthropic${terminator}`,
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

  it("validates valuation and binary seed inputs strictly", () => {
    const common = {
      name: "Anthropic",
      slug: "anthropic",
      logo_path: "/logos/anthropic.svg",
      b: 25_000,
    };

    expect(
      seedInputSchema.safeParse({
        ...common,
        metric_kind: "valuation_median",
        anchor_valuation_usd: "60000000000.00",
        anchor_date: "2026-08-30",
        anchor_description: "Verified public reporting",
        sigma: 0.5,
      }).success,
    ).toBe(true);
    expect(
      seedInputSchema.safeParse({
        ...common,
        metric_kind: "yes_probability",
        yes_probability: 0.5,
      }).success,
    ).toBe(true);
    expect(
      seedInputSchema.safeParse({
        ...common,
        metric_kind: "yes_probability",
        yes_probability: 1,
      }).success,
    ).toBe(false);
  });

  it("requires exact settlement confirmation and an HTTP(S) source", () => {
    const valid = {
      slug: "anthropic",
      confirm_slug: "anthropic",
      settled_value_usd: "70000000000.00",
      source_url: "https://example.com/source",
    };
    expect(settlementInputSchema.safeParse(valid).success).toBe(true);
    expect(
      settlementInputSchema.safeParse({
        ...valid,
        settled_value_usd: "0.00",
      }).success,
    ).toBe(true);
    expect(settlementInputSchema.safeParse({ ...valid, confirm_slug: "stripe" }).success).toBe(
      false,
    );
    expect(settlementInputSchema.safeParse({ ...valid, source_url: "file:///tmp/x" }).success).toBe(
      false,
    );
    expect(settlementInputSchema.safeParse({ ...valid, admin: true }).success).toBe(false);
  });

  it("caps trade quantity and spend while leaving settlement values uncapped", () => {
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
