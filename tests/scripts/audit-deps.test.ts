import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const script = resolve("scripts/audit-deps.ts");
const tsx = resolve("node_modules/tsx/dist/cli.mjs");

function audit(source: string, file = "src/components/example.ts") {
  const root = mkdtempSync(join(tmpdir(), "openmarket-layer-audit-"));
  try {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
    return spawnSync(process.execPath, [tsx, script], { cwd: root, encoding: "utf8" });
  } finally {
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
  ])("rejects runtime service access: %s", (source) => {
    const result = audit(source);
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
  ])("permits type-only service references: %s", (source) => {
    expect(audit(source).status).toBe(0);
  });

  it("checks type-only imports against the engine boundary", () => {
    const result = audit(
      'type Shape = import("../../db/schema.js").Shape;',
      "src/lib/engine/example.ts",
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("engine imports engine only");
  });
});
