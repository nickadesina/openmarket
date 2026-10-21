import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEALER_PARAMS,
  MODEL_VERSION,
  PARAMS_SHA256,
  PARAMS_SOURCE,
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
    // A rerun that changes any number must bump MODEL_VERSION and re-pin the
    // digest in the same commit, so every published mid names its parameters.
    expect(
      sha256(PARAMS_PATH),
      `params.json changed; bump MODEL_VERSION (now ${MODEL_VERSION}) and re-pin PARAMS_SHA256`,
    ).toBe(PARAMS_SHA256);
  });

  it("are read from the file, never overridden in code", () => {
    expect(DEALER_PARAMS).toEqual(JSON.parse(readFileSync(PARAMS_PATH, "utf8")));
    expect(PARAMS_SOURCE).toBe(PARAMS_PATH);
  });
});
