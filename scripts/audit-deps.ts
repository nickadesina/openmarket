/**
 * Layer audit: import direction inside src, enforced.
 *
 *   engine      → engine only, no packages. Pure arithmetic.
 *   services    → never components, app, or lib/client; never react or next.
 *   lib/client  → never db or a service's runtime code (types are fine).
 *   components  → never db; services only as `import type`; never node: builtins.
 *   app         → anything (pages are server components, routes are the API).
 *
 * Exit 1 with a file:line list on any violation.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly specifier: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

function layerOf(
  file: string,
): "engine" | "services" | "db" | "client" | "lib" | "components" | "app" | "other" {
  if (file.startsWith("src/lib/engine/")) return "engine";
  if (file.startsWith("src/lib/services/")) return "services";
  if (file.startsWith("src/lib/db/")) return "db";
  if (file.startsWith("src/lib/client/")) return "client";
  if (file.startsWith("src/lib/")) return "lib";
  if (file.startsWith("src/components/")) return "components";
  if (file.startsWith("src/app/")) return "app";
  return "other";
}

const violations: Violation[] = [];
for (const absolute of walk(join(ROOT, "src"))) {
  const file = relative(ROOT, absolute);
  const layer = layerOf(file);
  const lines = readFileSync(absolute, "utf8").split("\n");
  lines.forEach((text, index) => {
    const match = text.match(/^\s*import\s+(type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/);
    if (!match) return;
    const typeOnly = match[1] !== undefined;
    const specifier = match[2]!;
    const line = index + 1;
    const isRelative = specifier.startsWith(".");
    const target = isRelative
      ? relative(ROOT, resolve(dirname(absolute), specifier)).replace(/\.js$/, "")
      : specifier;
    const targetLayer = isRelative ? layerOf(`${target}.ts`) : "package";
    const fail = (rule: string) => violations.push({ file, line, rule, specifier });

    switch (layer) {
      case "engine":
        if (!isRelative || targetLayer !== "engine") fail("engine imports engine only");
        break;
      case "services":
        if (targetLayer === "components" || targetLayer === "app" || targetLayer === "client")
          fail("services never import UI or client code");
        if (/^(react|next)(\/|$)/.test(specifier)) fail("services never import react or next");
        break;
      case "client":
        if (!typeOnly && (targetLayer === "db" || targetLayer === "services"))
          fail("lib/client uses services and db as types only");
        break;
      case "components":
        if (targetLayer === "db") fail("components never import db");
        if (!typeOnly && targetLayer === "services")
          fail("components use services as types only; data arrives through the API");
        if (specifier.startsWith("node:")) fail("components never import node builtins");
        break;
      default:
        break;
    }
  });
}

if (violations.length === 0) {
  console.log("Layer audit: no violations.");
} else {
  for (const violation of violations) {
    console.log(
      `${violation.file}:${violation.line}  ${violation.rule}\n    ${violation.specifier}`,
    );
  }
  console.log(`Layer audit: ${violations.length} violation(s).`);
  process.exitCode = 1;
}
