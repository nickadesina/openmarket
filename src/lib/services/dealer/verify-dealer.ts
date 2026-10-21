import type { Kysely } from "kysely";

import { PARAMS_SHA256_BY_MODEL_VERSION } from "../../config/dealer.js";
import type { Database } from "../../db/schema.js";
import { type MidInputs, midFromInputs } from "./compute-mids.js";

/** A stored mid must recompute from its inputs this closely. */
export const MID_TOLERANCE = 1e-12;

export interface DealerFinding {
  readonly id: string;
  readonly check: "mid_recompute";
  readonly detail: string;
}

export interface DealerVerification {
  readonly midsChecked: number;
  readonly findings: DealerFinding[];
  readonly passed: boolean;
}

function isMidInputs(value: unknown): value is MidInputs {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "binary" || record.kind === "forward") &&
    typeof record.anchor === "object" &&
    record.anchor !== null
  );
}

/**
 * The dealer's half of verify:replay: every `model_mids` row recomputes
 * from its own inputs_json through prior.ts, under a published model
 * version, as the kind of value its instrument carries. Milestone 6 adds
 * quotes and forward payouts here.
 */
export async function verifyDealer(db: Kysely<Database>): Promise<DealerVerification> {
  const rows = await db
    .selectFrom("model_mids")
    .innerJoin("instruments", "instruments.id", "model_mids.instrument_id")
    .select([
      "model_mids.id",
      "model_mids.model_version",
      "model_mids.mid_ln",
      "model_mids.p",
      "model_mids.inputs_json",
      "instruments.kind",
    ])
    .orderBy("model_mids.computed_at")
    .orderBy("model_mids.id")
    .execute();

  const findings: DealerFinding[] = [];
  const fail = (id: string, detail: string) =>
    findings.push({ id, check: "mid_recompute", detail });
  for (const row of rows) {
    if (PARAMS_SHA256_BY_MODEL_VERSION[row.model_version] === undefined) {
      fail(row.id, `model_version ${row.model_version} was never published`);
      continue;
    }
    const inputs = row.inputs_json;
    if (!isMidInputs(inputs) || inputs.kind !== row.kind) {
      fail(row.id, `inputs_json does not describe a ${row.kind} mid`);
      continue;
    }
    const stored = row.kind === "forward" ? row.mid_ln : row.p;
    if (stored === null) {
      fail(row.id, `a ${row.kind} mid with no ${row.kind === "forward" ? "mid_ln" : "p"}`);
      continue;
    }
    let recomputed: number;
    try {
      recomputed = midFromInputs(inputs);
    } catch (error) {
      fail(row.id, error instanceof Error ? error.message : "inputs do not recompute");
      continue;
    }
    if (!(Math.abs(recomputed - stored) <= MID_TOLERANCE)) {
      fail(row.id, `stored ${stored}, recomputed ${recomputed}`);
    }
  }
  return { midsChecked: rows.length, findings, passed: findings.length === 0 };
}
