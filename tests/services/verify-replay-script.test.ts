import { expect, it, vi } from "vitest";

vi.mock("../../src/lib/db/client.js", () => ({
  createDirectDatabase: () => {
    throw new TypeError("do not log postgresql://private:secret@host/db");
  },
  destroyDatabase: vi.fn(),
}));

it("fails replay with an error class while withholding driver connection details", async () => {
  const previous = process.exitCode;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await import("../../scripts/verify-replay.js");
    expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("TypeError"));
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret");
  } finally {
    log.mockRestore();
    process.exitCode = previous;
  }
});
