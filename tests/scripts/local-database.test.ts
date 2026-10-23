import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  migrate: vi.fn().mockResolvedValue({ results: [] }),
  client: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock("pg", () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.client(options);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
vi.mock("../../src/lib/db/client.js", () => ({
  createDirectDatabase: mocks.create,
  destroyDatabase: vi.fn(),
}));
vi.mock("../../src/lib/db/migrator.js", () => ({ migrateToLatest: mocks.migrate }));

const argv = process.argv;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.query.mockReset();
  mocks.migrate.mockResolvedValue({ results: [] });
  process.exitCode = undefined;
  process.argv = ["node", "scripts/migrate.ts", "--test-local"];
  vi.stubEnv("DATABASE_URL_TEST", "postgresql://local:local_secret@localhost:5433/disposable");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.argv = argv;
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("creates and migrates the explicitly configured disposable database", async () => {
  await import("../../scripts/migrate.js");
  expect(mocks.client).toHaveBeenCalledWith({
    connectionString: "postgresql://local:local_secret@localhost:5433/postgres",
  });
  expect(mocks.query).toHaveBeenCalledWith('create database "disposable"');
  expect(mocks.create).toHaveBeenCalledWith(process.env.DATABASE_URL_TEST);
  expect(mocks.end).toHaveBeenCalled();
});

it("ignores only PostgreSQL's already-exists error", async () => {
  mocks.query.mockRejectedValue({ code: "42P04" });
  await import("../../scripts/migrate.js");
  expect(mocks.migrate).toHaveBeenCalled();
  expect(process.exitCode).not.toBe(1);
});

it("stops before migration when creating the database fails", async () => {
  mocks.query.mockRejectedValue({ code: "42501", message: "private details" });
  await import("../../scripts/migrate.js");
  expect(mocks.migrate).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(mocks.end).toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("private details"));
});
