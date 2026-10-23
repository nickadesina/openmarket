import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

async function audit(source: string, file = "src/components/example.ts") {
  const root = mkdtempSync(join(tmpdir(), "openmarket-layer-audit-"));
  vi.resetModules();
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
    await import("../../scripts/audit-deps.js");
    return { status: process.exitCode ?? 0, stdout: log.mock.calls.flat().join("\n") };
  } finally {
    cwd.mockRestore();
    log.mockRestore();
    process.exitCode = previousExitCode;
    rmSync(root, { recursive: true, force: true });
  }
}

describe("layer audit syntax coverage", () => {
  it.each([
    'import {\n  runtime\n} from "../lib/services/example.js";',
    'export { runtime } from "../lib/services/example.js";',
    'export * from "../lib/services/example.js";',
    'const runtime = import("../lib/services/example.js");',
    'import { type Shape, runtime } from "../lib/services/example.js";',
  ])("rejects runtime service access: %s", async (source) => {
    const result = await audit(source);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("components use services as types only");
    expect(result.stdout).toContain("src/components/example.ts:1");
  });

  it.each([
    'import type {\n Shape\n} from "../lib/services/example.js";',
    'import { type Shape } from "../lib/services/example.js";',
    'export type { Shape } from "../lib/services/example.js";',
    'export { type Shape } from "../lib/services/example.js";',
    'type Shape = import("../lib/services/example.js").Shape;',
  ])("permits type-only service references: %s", async (source) => {
    expect((await audit(source)).status).toBe(0);
  });

  it("checks type-only imports against the engine boundary", async () => {
    const result = await audit(
      'type Shape = import("../../db/schema.js").Shape;',
      "src/lib/engine/example.ts",
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("engine imports engine only");
  });
});
