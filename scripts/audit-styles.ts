/**
 * Style audit: the design system's mechanical rules, enforced.
 *
 *   1. No literal font-size outside src/styles/tokens.css: every size is a ramp token.
 *   2. Every rem spacing (padding, margin, gap, inset) and height sits on the 4px grid.
 *   3. No color literal outside src/styles/tokens.css except pure white.
 *   4. The module tab is never restated: compose `.moduleTab` from shared.module.css.
 *
 * Exit 1 with a file:line list on any finding. See DESIGN.md for the rules' intent.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const TOKENS = "src/styles/tokens.css";
const SHARED = "src/styles/shared.module.css";
const GRID_REM = 0.25;

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".css")) out.push(path);
  }
  return out;
}

function onGrid(rem: number): boolean {
  return Math.abs(rem / GRID_REM - Math.round(rem / GRID_REM)) < 1e-9;
}

const findings: Finding[] = [];
for (const absolute of walk(join(ROOT, "src"))) {
  const file = relative(ROOT, absolute);
  const source = readFileSync(absolute, "utf8");
  const lines = source.split("\n");
  lines.forEach((text, index) => {
    const line = index + 1;
    const trimmed = text.trim();
    if (trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

    if (file !== TOKENS && /font-size:\s*[0-9.]+(rem|px|em)/.test(trimmed)) {
      findings.push({ file, line, rule: "font-size must be a ramp token", text: trimmed });
    }

    const spacing = trimmed.match(
      /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|(min-|max-)?height|(min-|max-)?width)[a-z-]*:\s*([^;]+);/,
    );
    if (spacing && file !== TOKENS) {
      for (const value of spacing[4]!.matchAll(/(-?[0-9]*\.?[0-9]+)rem/g)) {
        const rem = Math.abs(Number(value[1]));
        if (!onGrid(rem)) {
          findings.push({ file, line, rule: "rem value off the 4px grid", text: trimmed });
          break;
        }
      }
    }

    if (file !== TOKENS) {
      for (const hex of trimmed.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
        const value = hex[1]!.toLowerCase();
        if (value !== "fff" && value !== "ffffff") {
          findings.push({ file, line, rule: "color literal belongs in tokens.css", text: trimmed });
          break;
        }
      }
    }
  });

  if (file !== SHARED) {
    for (const block of source.matchAll(/[^{}]+\{[^{}]*\}/g)) {
      const body = block[0];
      if (
        body.includes("background: var(--color-primary)") &&
        body.includes("text-transform: uppercase") &&
        body.includes("letter-spacing: 0.09em")
      ) {
        const line = source.slice(0, block.index).split("\n").length;
        findings.push({
          file,
          line,
          rule: "module tab restated; compose .moduleTab",
          text: body.split("\n")[0]!.trim(),
        });
      }
    }
  }
}

if (findings.length === 0) {
  console.log("Style audit: no findings.");
} else {
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line}  ${finding.rule}\n    ${finding.text}`);
  }
  console.log(`Style audit: ${findings.length} finding(s).`);
  process.exitCode = 1;
}
