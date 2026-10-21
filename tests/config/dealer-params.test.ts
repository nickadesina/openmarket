import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEALER_PARAMS,
  MODEL_VERSION,
  PARAMS_SHA256_BY_MODEL_VERSION,
} from "../../src/lib/config/dealer.js";

/**
 * Parameters are data (README D12). The backtest writes
 * backtest/out/params.json; nothing else may set a number the model reads.
 * Each check below is one way a hand-edited parameter would slip in.
 */

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const PARAMS_PATH = "backtest/out/params.json";
const onDisk = JSON.parse(readFileSync(PARAMS_PATH, "utf8")) as {
  inputs_sha256: Record<string, string>;
};

describe("dealer parameters", () => {
  it("were produced from the backtest inputs as committed", () => {
    // Editing events.csv, sim.py or analyze.py without rerunning analyze.py
    // leaves params.json describing a different backtest.
    for (const [name, digest] of Object.entries(onDisk.inputs_sha256)) {
      expect(sha256(`backtest/${name}`), `${name} changed; rerun backtest/analyze.py`).toBe(digest);
    }
    expect(Object.keys(onDisk.inputs_sha256).sort()).toEqual([
      "analyze.py",
      "events.csv",
      "sim.py",
    ]);
  });

  it("are pinned to the model version that publishes them", () => {
    // A rerun that changes any number adds a model version with the new
    // digest, so every published mid names its parameters.
    expect(
      sha256(PARAMS_PATH),
      `params.json changed; add a model version after ${MODEL_VERSION} with its digest`,
    ).toBe(PARAMS_SHA256_BY_MODEL_VERSION[MODEL_VERSION]);
  });

  it("never reuse a digest or a version out of order", () => {
    const versions = Object.keys(PARAMS_SHA256_BY_MODEL_VERSION);
    const digests = Object.values(PARAMS_SHA256_BY_MODEL_VERSION);
    expect(new Set(digests).size).toBe(digests.length);
    const parsed = versions.map((version) => version.split(".").map(Number));
    for (const parts of parsed) expect(parts).toHaveLength(3);
    for (let index = 1; index < parsed.length; index += 1) {
      const [a, b] = [parsed[index - 1]!, parsed[index]!];
      const order = a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
      expect(order, `${versions[index]} must follow ${versions[index - 1]}`).toBeLessThan(0);
    }
    expect(MODEL_VERSION).toBe(versions.at(-1));
  });

  it("are read from the file, never overridden in code", () => {
    expect(DEALER_PARAMS).toEqual(JSON.parse(readFileSync(PARAMS_PATH, "utf8")));
  });
});
