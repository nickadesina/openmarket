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

describe("layer audit: ingest", () => {
  it("keeps parsers pure: engine, other parsers and zod only", async () => {
    for (const source of [
      'import { assertDate } from "../../engine/assert.js";',
      'import { tagText } from "./xml.js";',
      'import { z } from "zod";',
    ]) {
      expect((await audit(source, "src/lib/ingest/parse/example.ts")).status, source).toBe(0);
    }
    for (const source of [
      'import { createSecClient } from "../fetch/sec.js";',
      'import type { Database } from "../../db/schema.js";',
      'import { readFileSync } from "node:fs";',
    ]) {
      const result = await audit(source, "src/lib/ingest/parse/example.ts");
      expect(result.status, source).toBe(1);
      expect(result.stdout).toContain("ingest/parse imports engine, ingest/parse and zod only");
    }
  });

  it("lets the source clients use ingest and node builtins, nothing else", async () => {
    for (const source of [
      'import { parseNport } from "../parse/nport.js";',
      'import { createHash } from "node:crypto";',
    ]) {
      expect((await audit(source, "src/lib/ingest/fetch/example.ts")).status, source).toBe(0);
    }
    for (const source of [
      'import { getRuntimeDatabase } from "../../db/runtime.js";',
      'import { searchIssuers } from "../../services/index/search-filings.js";',
      'import { z } from "zod";',
    ]) {
      const result = await audit(source, "src/lib/ingest/fetch/example.ts");
      expect(result.status, source).toBe(1);
      expect(result.stdout).toContain("ingest/fetch imports ingest and node builtins only");
    }
  });

  it("keeps the engine out of ingest", async () => {
    const result = await audit(
      'import { parseNport } from "../../ingest/parse/nport.js";',
      "src/lib/engine/example.ts",
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("engine imports engine only");
  });
});
