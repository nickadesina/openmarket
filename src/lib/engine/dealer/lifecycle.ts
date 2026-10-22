import { assertDate } from "../assert.js";
/**
 * The `instruments.state` machine (CONTRACTS.md → Lifecycle,
 * TECHNICAL_DESIGN.md §6) as a pure transition function. It decides state
 * and names effects; the dealer and settle jobs carry the effects out.
 *
 *     quoting → widened (flag) → quoting (newer mid, or widened_until passes)
 *     quoting | widened → resolved (qualifying event ≤ T) → successor
 *     quoting | widened → expired (T passes)              → successor
 *
 * resolved and expired are terminal: every transition into them emits
 * list_successor, and every later event is a no-op, so a job that replays
 * an event cannot settle or roll twice.
 */
import {
  afterGrace,
  type BinaryResolution,
  type ForwardResolution,
  type SourceRank,
} from "./rulebook.js";

const HOUR_MS = 3_600_000;

export const INSTRUMENT_STATES = ["quoting", "widened", "resolved", "expired"] as const;
export type InstrumentState = (typeof INSTRUMENT_STATES)[number];

export type InstrumentKind = "binary" | "forward";

/** `event_flags.kind` (decision 0001). */
export const FLAG_KINDS = [
  "form_d",
  "form_d_amend",
  "charter",
  "scoop",
  "release",
  "s1_public",
  "print",
  "user_submitted",
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/**
 * Flags that widen the forward (TECHNICAL_DESIGN.md §6). `print` and
 * `s1_public` resolve through the rulebook and arrive as a `resolve` event,
 * not a widening; `user_submitted` does nothing until an operator confirms it
 * as one of the others.
 */
const WIDENING_FLAGS: ReadonlySet<FlagKind> = new Set([
  "scoop",
  "form_d",
  "form_d_amend",
  "charter",
  "release",
]);

export function flagWidens(kind: FlagKind): boolean {
  if (!FLAG_KINDS.includes(kind)) throw new RangeError(`unknown flag kind ${String(kind)}`);
  return WIDENING_FLAGS.has(kind);
}

export interface InstrumentSnapshot {
  readonly kind: InstrumentKind;
  readonly state: InstrumentState;
  /** Binary: the quarter-end cutoff. Forward: T. */
  readonly expiresAt: Date;
  /** The latest widening flag's time; set exactly when state is `widened`. */
  readonly widenedAt: Date | null;
  readonly widenedUntil: Date | null;
}

export type LifecycleEvent =
  | { readonly type: "flag"; readonly at: Date; readonly kind: FlagKind }
  /** A newer `model_mids` row, published at `at`. */
  | { readonly type: "remid"; readonly at: Date }
  | { readonly type: "tick"; readonly now: Date }
  /** A rulebook resolution, applied at `at` (the rulebook's asOf). */
  | {
      readonly type: "resolve";
      readonly at: Date;
      readonly resolution: BinaryResolution | ForwardResolution;
    };

export type LifecycleEffect =
  /** Forward only: s × flag_spread_mult, Q × flag_cap_mult for new positions. */
  | { readonly type: "widen"; readonly widenedUntil: Date }
  | { readonly type: "restore" }
  | {
      readonly type: "settle";
      readonly instrument: "binary";
      readonly outcome: "yes";
      readonly eventId: string;
      readonly at: Date;
    }
  | {
      readonly type: "settle";
      readonly instrument: "forward";
      readonly eventId: string;
      readonly at: Date;
      readonly rank: SourceRank;
      readonly settleLn: number;
      readonly final: boolean;
    }
  | { readonly type: "pay_no" }
  | { readonly type: "void" }
  | {
      readonly type: "list_successor";
      readonly instrument: InstrumentKind;
      /** The successor's listing time: the same moment its predecessor ends. */
      readonly listedAt: Date;
      /** Forward only: the print to anchor on, or null for the current mid. */
      readonly anchorLn: number | null;
    };

export interface LifecycleParams {
  /** `dealer.flag_hours`. */
  readonly flagHours: number;
}

export interface Transition {
  readonly instrument: InstrumentSnapshot;
  readonly effects: readonly LifecycleEffect[];
}

function validateSnapshot(instrument: InstrumentSnapshot): void {
  if (instrument.kind !== "binary" && instrument.kind !== "forward") {
    throw new RangeError('kind must be "binary" or "forward"');
  }
  if (!INSTRUMENT_STATES.includes(instrument.state)) {
    throw new RangeError(`unknown state ${String(instrument.state)}`);
  }
  assertDate(instrument.expiresAt, "expiresAt");
  const widened = instrument.state === "widened";
  if (widened && instrument.kind === "binary") {
    throw new RangeError("a binary is never widened");
  }
  if (widened !== (instrument.widenedAt !== null && instrument.widenedUntil !== null)) {
    throw new RangeError("widenedAt and widenedUntil are set exactly when state is widened");
  }
  if (widened) {
    assertDate(instrument.widenedAt!, "widenedAt");
    assertDate(instrument.widenedUntil!, "widenedUntil");
  }
}

function unchanged(instrument: InstrumentSnapshot): Transition {
  return { instrument, effects: [] };
}

function quoting(instrument: InstrumentSnapshot): InstrumentSnapshot {
  return { ...instrument, state: "quoting", widenedAt: null, widenedUntil: null };
}

function end(
  instrument: InstrumentSnapshot,
  state: "resolved" | "expired",
  outcome: LifecycleEffect,
  listedAt: Date,
  anchorLn: number | null,
): Transition {
  return {
    instrument: { ...instrument, state, widenedAt: null, widenedUntil: null },
    effects: [outcome, { type: "list_successor", instrument: instrument.kind, listedAt, anchorLn }],
  };
}

/**
 * A widening flag widens the forward only. The binary is seeded once per
 * quarter with a fixed b and never re-scaled (README D12), so a flag has
 * nothing to change on it and it stays `quoting`. A flag while already
 * widened extends widened_until to the later of the two windows.
 */
function onFlag(
  instrument: InstrumentSnapshot,
  at: Date,
  kind: FlagKind,
  params: LifecycleParams,
): Transition {
  if (!flagWidens(kind) || instrument.kind === "binary") return unchanged(instrument);

  const until = new Date(at.getTime() + params.flagHours * HOUR_MS);
  // A remid restores only if it postdates the latest flag, so widenedAt moves forward even when
  // the window does not.
  const widenedAt =
    instrument.widenedAt !== null && instrument.widenedAt > at ? instrument.widenedAt : at;
  if (instrument.widenedUntil !== null && until <= instrument.widenedUntil) {
    return { instrument: { ...instrument, widenedAt }, effects: [] };
  }
  return {
    instrument: { ...instrument, state: "widened", widenedAt, widenedUntil: until },
    effects: [{ type: "widen", widenedUntil: until }],
  };
}

/** A mid newer than the latest flag means the model has re-priced it: restore. */
function onRemid(instrument: InstrumentSnapshot, at: Date): Transition {
  if (instrument.state !== "widened" || at <= instrument.widenedAt!) return unchanged(instrument);
  return { instrument: quoting(instrument), effects: [{ type: "restore" }] };
}

/**
 * Time passing. Past T plus the rulebook's observation grace with nothing
 * resolved, the instrument expires: the binary pays NO, the forward voids.
 * The settle job applies the rulebook's `resolve` before ticking, so an
 * announcement dated ≤ T but observed in the grace day still resolves it.
 */
function onTick(instrument: InstrumentSnapshot, now: Date): Transition {
  if (afterGrace(instrument.expiresAt, now)) {
    const outcome: LifecycleEffect =
      instrument.kind === "binary" ? { type: "pay_no" } : { type: "void" };
    return end(instrument, "expired", outcome, now, null);
  }
  if (instrument.state === "widened" && now >= instrument.widenedUntil!) {
    return { instrument: quoting(instrument), effects: [{ type: "restore" }] };
  }
  return unchanged(instrument);
}

function onBinaryResolve(
  instrument: InstrumentSnapshot,
  at: Date,
  resolution: BinaryResolution | ForwardResolution,
): Transition {
  switch (resolution.status) {
    case "open":
      return unchanged(instrument);
    case "yes":
      return end(
        instrument,
        "resolved",
        {
          type: "settle",
          instrument: "binary",
          outcome: "yes",
          eventId: resolution.eventId,
          at: resolution.at,
        },
        at,
        null,
      );
    case "no":
      return end(instrument, "expired", { type: "pay_no" }, at, null);
    default:
      throw new RangeError(`a binary cannot resolve ${resolution.status}`);
  }
}

/**
 * A void before T's grace has passed can only be an acquisition with no
 * disclosed equity value, an event, so the instrument is `resolved`; after
 * it, no print came and the instrument is `expired`. Both refund and roll at
 * the current mid.
 */
function onForwardResolve(
  instrument: InstrumentSnapshot,
  at: Date,
  resolution: BinaryResolution | ForwardResolution,
): Transition {
  switch (resolution.status) {
    case "open":
      return unchanged(instrument);
    case "settled":
      return end(
        instrument,
        "resolved",
        {
          type: "settle",
          instrument: "forward",
          eventId: resolution.eventId,
          at: resolution.at,
          rank: resolution.rank,
          settleLn: resolution.settleLn,
          final: resolution.final,
        },
        at,
        resolution.settleLn,
      );
    case "void":
      return end(
        instrument,
        afterGrace(instrument.expiresAt, at) ? "expired" : "resolved",
        { type: "void" },
        at,
        null,
      );
    default:
      throw new RangeError(`a forward cannot resolve ${resolution.status}`);
  }
}

export function transition(
  instrument: InstrumentSnapshot,
  event: LifecycleEvent,
  params: LifecycleParams,
): Transition {
  validateSnapshot(instrument);
  if (!Number.isFinite(params.flagHours) || params.flagHours <= 0) {
    throw new RangeError("flagHours must be finite and greater than zero");
  }
  if (instrument.state === "resolved" || instrument.state === "expired") {
    return unchanged(instrument);
  }

  switch (event.type) {
    case "flag":
      assertDate(event.at, "at");
      return onFlag(instrument, event.at, event.kind, params);
    case "remid":
      assertDate(event.at, "at");
      return onRemid(instrument, event.at);
    case "tick":
      assertDate(event.now, "now");
      return onTick(instrument, event.now);
    case "resolve":
      assertDate(event.at, "at");
      return instrument.kind === "binary"
        ? onBinaryResolve(instrument, event.at, event.resolution)
        : onForwardResolve(instrument, event.at, event.resolution);
    default:
      throw new RangeError("unknown lifecycle event");
  }
}
