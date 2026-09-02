import type { Kysely } from "kysely";
import { describe, expect, it, type Mock, vi } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";
import { ACTIVITY_MAX_LIMIT, getActivity } from "../../src/lib/services/get-activity.js";

function queryReturning(rows: readonly unknown[]): Record<string, Mock> {
  const query: Record<string, Mock> = {};
  for (const method of ["innerJoin", "select", "where", "orderBy", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.execute = vi.fn(async () => rows);
  query.executeTakeFirst = vi.fn(async () => rows[0]);
  return query;
}

function readDatabase(selectFrom: Mock): Kysely<Database> {
  const transactionDb = { selectFrom };
  const execute = vi.fn(async (callback: (transaction: typeof transactionDb) => Promise<unknown>) =>
    callback(transactionDb),
  );
  const setAccessMode = vi.fn(() => ({ execute }));
  const setIsolationLevel = vi.fn(() => ({ setAccessMode }));
  return {
    transaction: vi.fn(() => ({ setIsolationLevel })),
  } as unknown as Kysely<Database>;
}

function activityRow(id: string, sequence: string, minute: number) {
  return {
    id,
    market_sequence: sequence,
    action: "buy" as const,
    contract_side: "yes" as const,
    strike_index: 3,
    strike_value: "1000000000.00",
    quantity: 5,
    cash_amount_cents: "1234",
    metric_before: 10,
    metric_after: 12,
    created_at: new Date(Date.UTC(2026, 0, 1, 12, minute)),
    metric_kind: "valuation_median" as const,
    company_name: "Acme",
    company_slug: "acme",
    company_logo_path: "/acme.svg",
    user_id: "private-user",
    idempotency_key: "private-key",
    request_fingerprint: "private-fingerprint",
  };
}

describe("getActivity", () => {
  it("returns a bounded public page and an opaque stable cursor", async () => {
    const firstQuery = queryReturning([
      activityRow("00000000-0000-4000-8000-000000000003", "3", 3),
      activityRow("00000000-0000-4000-8000-000000000002", "2", 2),
      activityRow("00000000-0000-4000-8000-000000000001", "1", 1),
    ]);
    const firstPage = await getActivity(readDatabase(vi.fn(() => firstQuery)), { limit: 2 });

    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(firstPage.items[0]).not.toHaveProperty("id");
    expect(firstPage.items[0]).not.toHaveProperty("userId");
    expect(firstPage.items[0]).not.toHaveProperty("idempotencyKey");
    expect(firstPage.items[0]).not.toHaveProperty("requestFingerprint");
    expect(JSON.stringify(firstPage.items)).not.toContain("private-");

    const secondQuery = queryReturning([
      activityRow("00000000-0000-4000-8000-000000000001", "1", 1),
    ]);
    const secondPage = await getActivity(readDatabase(vi.fn(() => secondQuery)), {
      limit: 2,
      cursor: firstPage.nextCursor!,
    });

    expect(secondPage.items.map((item) => item.marketSequence)).toEqual(["1"]);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondQuery.where).toHaveBeenCalledTimes(1);
  });

  it("checks a company filter and rejects missing slugs", async () => {
    const companyQuery = queryReturning([]);
    const tradesQuery = queryReturning([]);
    const selectFrom = vi.fn((table: string) =>
      table === "companies" ? companyQuery : tradesQuery,
    );

    await expect(getActivity(readDatabase(selectFrom), { slug: "missing" })).rejects.toMatchObject({
      code: "MARKET_NOT_FOUND",
    });
    expect(tradesQuery.execute).not.toHaveBeenCalled();
  });

  it("rejects malformed cursors and out-of-range limits before reading", async () => {
    const transaction = vi.fn();
    const db = { transaction } as unknown as Kysely<Database>;

    await expect(getActivity(db, { cursor: "not-json" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(getActivity(db, { limit: ACTIVITY_MAX_LIMIT + 1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(getActivity(db, { slug: "acme\n" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(getActivity(db, { cursor: "not-json\n" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
