import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import params from "../../backtest/out/params.json";
import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import { RULEBOOK_VERSION } from "../../src/lib/engine/dealer/rulebook.js";
import {
  backtestPublicFiles,
  DROPPED_CALIBRATION_COLUMNS,
  numberWords,
  type RulebookFixture,
  readingFigures,
} from "../../src/lib/tradeables/backtest-public.js";
import fixture from "../fixtures/rulebook-events.json";

const inputs = {
  calibrationCsv: readFileSync("backtest/out/calibration.csv", "utf8"),
  summaryCsv: readFileSync("backtest/out/summary.csv", "utf8"),
  fixture: fixture as RulebookFixture,
  dataThrough: params.data_through,
  rulebookVersion: RULEBOOK_VERSION,
  kappa: DEALER_PARAMS.dealer.kappa,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/**
 * Everything served from public/, as text. A number inside a URL is part of
 * an address (an SVG's xmlns, a source link), not a published figure.
 */
const PUBLIC = [
  ...walk("public"),
  // Served at /resolution-sources.md.
  "docs/tradeables/resolution-sources.md",
].map((path) => ({
  path,
  text: readFileSync(path, "latin1").replace(/https?:\/\/[^\s"')<>]+/g, " "),
}));

/**
 * The construction that never leaves the repo (the brief's rules): every key
 * and number under params.json's `prior` and `dealer`, and `sigma_tier`. The
 * per-name keys under mu_stepup are company and tier names, which are public.
 * Published elsewhere and so not searched: forward_t_days (contract terms),
 * tier.mega_threshold_usd (the listing rule, README D10), contract and the
 * inputs' digests.
 */
const SECRET = { prior: params.prior, dealer: params.dealer, sigma_tier: params.sigma_tier };
const PUBLIC_KEYS = new Set(["mega", "redhot", ...Object.keys(params.forward_t_days)]);

function secretNames(value: unknown, out = new Set<string>()): Set<string> {
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (!PUBLIC_KEYS.has(key)) out.add(key);
      secretNames(child, out);
    }
  }
  return out;
}

function secretNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") out.push(value);
  else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) secretNumbers(child, out);
  }
  return out;
}

/**
 * The spellings a value could appear in. Whole numbers below 100 (the
 * cadences, flag hours, the leak window, the multipliers 1 and 3) are not
 * searched: as bare tokens they are every date, count and SVG coordinate.
 * Fractions are searched at full precision and at every rounding from three
 * significant digits; CONTRACTS.md already publishes two-digit roundings.
 */
function spellings(value: number): string[] {
  if (Number.isInteger(value)) {
    return value < 100 ? [] : [String(value), value.toLocaleString("en-US")];
  }
  const forms = new Set([String(value)]);
  const digits = String(value).replace(/^-?0\.0*|\./g, "").length;
  for (let precision = 3; precision < digits; precision += 1) {
    forms.add(value.toPrecision(precision));
  }
  return [...forms];
}

function token(form: string): RegExp {
  return new RegExp(`(?<![\\d.])${form.replaceAll(".", "\\.")}(?![\\d])`);
}

describe("the backtest's public export", () => {
  const files = backtestPublicFiles(inputs);

  it("reproduces public/data/backtest/ byte for byte", () => {
    for (const [name, text] of Object.entries(files)) {
      expect(readFileSync(join("public/data/backtest", name), "utf8"), name).toBe(text);
    }
    expect(readdirSync("public/data/backtest").sort()).toEqual(Object.keys(files).sort());
  });

  it("states figures the files support", () => {
    const figures = readingFigures(inputs);
    const readme = files["README.md"]!;
    expect(readme).toContain(`about ${figures.sdByTier.mega.toFixed(2)} log`);
    expect(readme).toContain(`about ${figures.sdByTier.redhot.toFixed(2)} on red-hot`);
    expect(readme).toContain(
      `${numberWords(figures.outsideClip)} print in\n${numberWords(figures.prints)}`,
    );
    expect(Math.round(figures.shortVoidRate * 3)).toBe(2);
    expect(readme).toContain(`Data through ${params.data_through}`);
    expect(readme).toContain("The construction of the prior is not\npublished");
  });

  it("drops the columns that reconstruct the step-up and the losses", () => {
    for (const [name, text] of Object.entries(files)) {
      for (const column of DROPPED_CALIBRATION_COLUMNS) {
        expect(new RegExp(`\\b${column}\\b`).test(text), `${name}: ${column}`).toBe(false);
      }
      expect(/loss/i.test(text), `${name}: a loss column or figure`).toBe(false);
      expect(text.includes("$"), `${name}: a dollar figure`).toBe(false);
    }
  });
});

describe("everything under public/", () => {
  it("is searched", () => {
    expect(PUBLIC.map((file) => file.path)).toEqual(
      expect.arrayContaining(["public/data/round-history.csv", "public/data/backtest/README.md"]),
    );
  });

  it("names none of params.json's dealer and prior parameters", () => {
    const names = ["sigma_tier", ...secretNames(params.prior), ...secretNames(params.dealer)];
    expect(names).toEqual(expect.arrayContaining(["sigma_tier", "mu_stepup", "kappa", "b_usd"]));
    const hits = PUBLIC.flatMap(({ path, text }) =>
      names
        .filter((name) => new RegExp(`\\b${name}\\b`).test(text))
        .map((name) => `${path}: ${name}`),
    );
    expect(hits).toEqual([]);
  });

  it("carries none of their values", () => {
    const forms = [...new Set(secretNumbers(SECRET).flatMap(spellings))];
    expect(forms).toEqual(expect.arrayContaining(["2000", "25000", "0.05", "0.3455074891727178"]));
    const hits = PUBLIC.flatMap(({ path, text }) =>
      forms.filter((form) => token(form).test(text)).map((form) => `${path}: ${form}`),
    );
    expect(hits).toEqual([]);
  });

  it("catches a planted parameter, so the search is not vacuous", () => {
    const planted = `x,${params.sigma_tier.mega.toPrecision(4)},${params.dealer.cap_usd.toLocaleString("en-US")}`;
    const forms = secretNumbers(SECRET).flatMap(spellings);
    expect(forms.filter((form) => token(form).test(planted)).length).toBeGreaterThanOrEqual(2);
  });
});
