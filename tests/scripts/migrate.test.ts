import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../src/lib/db/client.js", () => ({
  createDirectDatabase: vi.fn(),
  destroyDatabase: vi.fn(),
}));
vi.mock("../../src/lib/db/migrator.js", () => ({
  migrateToLatest: vi
    .fn()
    .mockRejectedValue(
      Object.assign(new Error("credential-that-must-not-be-logged"), { code: "42701" }),
    ),
}));

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

it("fails migrations with the error class and SQLSTATE, never the raw message", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await import("../../scripts/migrate.js");
  expect(process.exitCode).toBe(1);
  expect(error).toHaveBeenCalledExactlyOnceWith(
    "Database migration failed (Error 42701); no credentials or database error details were logged.",
  );
  expect(JSON.stringify(error.mock.calls)).not.toContain("credential-that-must-not-be-logged");
});
