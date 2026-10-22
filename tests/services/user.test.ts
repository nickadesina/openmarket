import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";
import { ensurePaperAccount, INITIAL_USER_BALANCE_CENTS } from "../../src/lib/services/user.js";

describe("ensurePaperAccount", () => {
  it("inserts at the opening balance, yields to a concurrent insert, and reads the one row", async () => {
    const doNothing = vi.fn(() => "do nothing");
    const conflict = { column: vi.fn(() => ({ doNothing })) };
    const insert = {
      values: vi.fn(),
      onConflict: vi.fn((build: (builder: typeof conflict) => unknown) => {
        build(conflict);
        return insert;
      }),
      execute: vi.fn(async () => []),
    };
    insert.values.mockReturnValue(insert);
    const select = {
      select: vi.fn(),
      where: vi.fn(),
      executeTakeFirstOrThrow: vi.fn(async () => ({ id: "paper-1" })),
    };
    select.select.mockReturnValue(select);
    select.where.mockReturnValue(select);
    const db = {
      insertInto: vi.fn(() => insert),
      selectFrom: vi.fn(() => select),
    } as unknown as Kysely<Database>;

    await expect(ensurePaperAccount(db, "tournament-1")).resolves.toBe("paper-1");
    expect(INITIAL_USER_BALANCE_CENTS).toBe("10000000");
    expect(insert.values).toHaveBeenCalledWith({
      tournament_user_id: "tournament-1",
      cash_balance_cents: INITIAL_USER_BALANCE_CENTS,
    });
    expect(conflict.column).toHaveBeenCalledWith("tournament_user_id");
    expect(doNothing).toHaveBeenCalledOnce();
    expect(select.where).toHaveBeenCalledWith("tournament_user_id", "=", "tournament-1");
  });
});
