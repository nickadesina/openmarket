import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Database } from "../../src/lib/db/schema.js";

afterEach(() => {
  vi.doUnmock("../../src/lib/db/client.js");
  vi.resetModules();
});

describe("Part 3 database runtime", () => {
  it("does not create a pool on import and reuses one pool for the warm process", async () => {
    const database = {} as Kysely<Database>;
    const createPooledDatabase = vi.fn(() => database);
    vi.doMock("../../src/lib/db/client.js", () => ({ createPooledDatabase }));
    // The dynamic import is the behavior under test: module evaluation must not open a pool.
    const runtime = await import("../../src/lib/db/runtime.js");

    expect(createPooledDatabase).not.toHaveBeenCalled();
    expect(runtime.getRuntimeDatabase()).toBe(database);
    expect(runtime.getRuntimeDatabase()).toBe(database);
    expect(createPooledDatabase).toHaveBeenCalledTimes(1);
  });
});
