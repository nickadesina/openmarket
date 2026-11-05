/**
 * Layer audit: import direction inside src, enforced.
 *
 *   engine      → engine only, no packages. Pure arithmetic.
 *   ingest/parse → engine and ingest/parse only; of packages, zod. Pure parsers.
 *   ingest/fetch → ingest and node: builtins only. The only network code.
 *   ingest/*    → never db, services, components, app or lib/client.
 *   services    → never components, app, or lib/client; never react or next.
 *   lib/client  → never db or a service's runtime code (types are fine).
 *   components  → never db; services only as `import type`; never node: builtins.
 *   app         → anything (pages are server components, routes are the API).
 *
 * Exit 1 with a file:line list on any violation.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";

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
):
  | "engine"
  | "ingest-parse"
  | "ingest-fetch"
  | "ingest"
  | "services"
  | "db"
  | "client"
  | "lib"
  | "components"
  | "app"
  | "other" {
  if (file.startsWith("src/lib/engine/")) return "engine";
  if (file.startsWith("src/lib/ingest/parse/")) return "ingest-parse";
  if (file.startsWith("src/lib/ingest/fetch/")) return "ingest-fetch";
  if (file.startsWith("src/lib/ingest/")) return "ingest";
  if (file.startsWith("src/lib/services/")) return "services";
  if (file.startsWith("src/lib/db/")) return "db";
  if (file.startsWith("src/lib/client/")) return "client";
  if (file.startsWith("src/lib/")) return "lib";
  if (file.startsWith("src/components/")) return "components";
  if (file.startsWith("src/app/")) return "app";
  return "other";
}

interface ImportEdge {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly line: number;
}

function importEdge(node: ts.Node, source: ts.SourceFile): ImportEdge | undefined {
  let specifier: ts.Node | undefined;
  let typeOnly = false;
  if (ts.isImportDeclaration(node)) {
    specifier = node.moduleSpecifier;
    const clause = node.importClause;
    const bindings = clause?.namedBindings;
    typeOnly = Boolean(
      clause?.isTypeOnly ||
        (clause?.name === undefined &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly)),
    );
  } else if (ts.isExportDeclaration(node)) {
    specifier = node.moduleSpecifier;
    const clause = node.exportClause;
    typeOnly =
      node.isTypeOnly ||
      Boolean(
        clause &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly),
      );
  } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    specifier = node.arguments[0];
  } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    specifier = node.argument.literal;
    typeOnly = true;
  }
  if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return undefined;
  return {
    specifier: specifier.text,
    typeOnly,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  };
}

function imports(absolute: string): ImportEdge[] {
  const source = ts.createSourceFile(
    absolute,
    readFileSync(absolute, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const edges: ImportEdge[] = [];
  function visit(node: ts.Node): void {
    const edge = importEdge(node, source);
    if (edge !== undefined) edges.push(edge);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return edges;
}

const violations: Violation[] = [];
for (const absolute of walk(join(ROOT, "src"))) {
  const file = relative(ROOT, absolute);
  const layer = layerOf(file);
  for (const { specifier, typeOnly, line } of imports(absolute)) {
    const isRelative = specifier.startsWith(".");
    const target = isRelative
      ? relative(ROOT, resolve(dirname(absolute), specifier)).replace(/\.js$/, "")
      : specifier;
    const targetLayer = isRelative ? layerOf(`${target}.ts`) : "package";
    const fail = (rule: string) => violations.push({ file, line, rule, specifier });

    const isIngest = (target: string) =>
      target === "ingest-parse" || target === "ingest-fetch" || target === "ingest";

    switch (layer) {
      case "engine":
        if (!isRelative || targetLayer !== "engine") fail("engine imports engine only");
        break;
      case "ingest-parse":
        if (isRelative ? !["engine", "ingest-parse"].includes(targetLayer) : specifier !== "zod")
          fail("ingest/parse imports engine, ingest/parse and zod only");
        break;
      case "ingest-fetch":
        if (isRelative ? !isIngest(targetLayer) : !specifier.startsWith("node:"))
          fail("ingest/fetch imports ingest and node builtins only");
        break;
      case "ingest":
        if (isRelative && !(isIngest(targetLayer) || targetLayer === "engine"))
          fail("ingest never imports db, services or UI");
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
  }
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
