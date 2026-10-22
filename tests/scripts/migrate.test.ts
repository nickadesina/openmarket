import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../src/lib/db/client.js", () => ({
  createDirectDatabase: vi.fn(),
  destroyDatabase: vi.fn(),
}));
vi.mock("../../src/lib/db/migrator.js", () => ({
  migrateToLatest: vi.fn().mockRejectedValue(new Error("credential-that-must-not-be-logged")),
}));

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

it("fails migrations without logging raw database errors", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await import("../../scripts/migrate.js");
  expect(process.exitCode).toBe(1);
  expect(error).toHaveBeenCalledExactlyOnceWith(
    "Database migration failed; no credentials or database error details were logged.",
  );
});
