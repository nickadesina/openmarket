import { describe, expect, it } from "vitest";

import {
  forwardQuoteQuerySchema,
  forwardTradeInputSchema,
  quoteInputSchema,
} from "../../src/lib/api/schemas.js";
import { DEALER_PARAMS } from "../../src/lib/config/dealer.js";
import type { EventFlagRow, QuoteRow } from "../../src/lib/db/schema.js";
import { settlementCreditCents } from "../../src/lib/engine/dealer/forward.js";
import { replayLifecycle } from "../../src/lib/services/dealer/apply-flags.js";
import {
  type LiveInstrument,
  withPrintAnchor,
} from "../../src/lib/services/dealer/compute-mids.js";
import {
  binaryQuoteRow,
  forwardQuoteFor,
  forwardQuoteRow,
  isWidened,
  sameQuote,
} from "../../src/lib/services/dealer/dealer-books.js";
import { fillPreview } from "../../src/lib/services/dealer/get-instrument-quote.js";
import {
  instrumentExpiry,
  instrumentQuestion,
} from "../../src/lib/services/dealer/list-instruments.js";
import { rulebookEvents } from "../../src/lib/services/dealer/settle-instruments.js";
import { analyzeReplay, type ReplaySnapshot } from "../../src/lib/services/verify-replay.js";
import { fixtureFlagsFor, utcDay } from "./event-flags-fixture.js";

/** The dealer services' pure helpers; their I/O halves run in tests/integration/dealer-*. */

const LISTING = {
  tier: "mega",
  kappa: 1,
  cap_cents: "2500000",
  gamma: 0.5,
  spread_floor: 0.05,
} as const;
const HOUR = 3_600_000;

describe("forwardQuoteFor", () => {
  it("is forward.ts's quote at the listing's parameters and params.json's σ", () => {
    const quote = forwardQuoteFor(LISTING, Math.log(1e10), -500_000, "normal");
    const sigma = DEALER_PARAMS.sigma_tier.mega;
    expect(quote.adjustedMid).toBeCloseTo(Math.log(1e10) + 0.5 * 0.2, 12);
    expect(quote.halfSpread).toBeCloseTo(0.05 + sigma * 0.2, 12);
    expect(quote).toMatchObject({ maxLongCents: 2_000_000, maxShortCents: 3_000_000 });
  });

  it("triples the spread and halves the cap while widened", () => {
    const normal = forwardQuoteFor(LISTING, 20, 0, "normal");
    const widened = forwardQuoteFor(LISTING, 20, 0, "widened");
    expect(widened.halfSpread).toBeCloseTo(3 * normal.halfSpread, 12);
    expect(widened.effectiveCapCents).toBe(1_250_000);
  });
});

describe("isWidened", () => {
  it("holds only while the instrument is widened and before widened_until", () => {
    const until = new Date("2026-09-18T00:00:00Z");
    expect(
      isWidened({ state: "widened", widened_until: until }, new Date(until.getTime() - 1)),
    ).toBe(true);
    expect(isWidened({ state: "widened", widened_until: until }, until)).toBe(false);
    expect(isWidened({ state: "quoting", widened_until: null }, until)).toBe(false);
  });
});

describe("sameQuote", () => {
  const base = {
    instrumentId: "i",
    postedAt: new Date(0),
    reason: "requote",
    modelMidId: "m",
  } as const;
  function stored(row: ReturnType<typeof forwardQuoteRow>): QuoteRow {
    return { ...row, id: "q", sequence: "1", trade_id: null } as QuoteRow;
  }

  it("repeats a quote whatever its time or reason, and not one whose inputs moved", () => {
    const quote = forwardQuoteFor(LISTING, 20, 0, "normal");
    const previous = stored(forwardQuoteRow(base, quote, "normal"));
    expect(
      sameQuote(previous, forwardQuoteRow({ ...base, postedAt: new Date(1) }, quote, "normal")),
    ).toBe(true);
    expect(
      sameQuote(previous, forwardQuoteRow({ ...base, modelMidId: "n" }, quote, "normal")),
    ).toBe(false);
    const moved = forwardQuoteFor(LISTING, 20, 100, "normal");
    expect(sameQuote(previous, forwardQuoteRow(base, moved, "normal"))).toBe(false);
    expect(sameQuote(undefined, forwardQuoteRow(base, quote, "normal"))).toBe(false);
  });

  it("compares a binary on its price", () => {
    const previous = { ...binaryQuoteRow(base, 0.2), id: "q", sequence: "1" } as QuoteRow;
    expect(sameQuote(previous, binaryQuoteRow(base, 0.2))).toBe(true);
    expect(sameQuote(previous, binaryQuoteRow(base, 0.21))).toBe(false);
  });
});

describe("fillPreview", () => {
  it("previews the side's entry, N·κ collateral and the cap's refusal", () => {
    const quote = forwardQuoteFor(LISTING, 20, 0, "normal");
    expect(fillPreview(quote, 1, "long", 10_000)).toMatchObject({
      allowed: true,
      refusal: null,
      entry_ln: quote.ask,
      collateral_cents: "10000",
      max_notional_cents: "2500000",
    });
    expect(fillPreview(quote, 0.7, "short", 10)).toMatchObject({
      entry_ln: quote.bid,
      collateral_cents: "7",
    });
    expect(fillPreview(quote, 1, "long", 2_500_001)).toMatchObject({
      allowed: false,
      refusal: "exceeds_cap",
    });
  });
});

describe("instrumentQuestion and instrumentExpiry", () => {
  const listing = { binary_event: "priced_round", forward_t_days: 90 } as const;
  it("asks the binary by its expiry date and the forward for the next post-money", () => {
    const opens = new Date("2026-09-01T00:05:00Z");
    const binaryExpiry = instrumentExpiry(listing, "binary", opens);
    expect(binaryExpiry.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(instrumentQuestion(listing, "Instinct", "binary", binaryExpiry)).toBe(
      "Will Instinct announce a priced round by 2026-09-30?",
    );
    expect(
      instrumentQuestion({ binary_event: "public_s1" }, "OpenAI", "binary", binaryExpiry),
    ).toBe("Will OpenAI publicly file an S-1 by 2026-09-30?");
    expect(instrumentQuestion(listing, "Instinct", "forward", binaryExpiry)).toBe(
      "What will Instinct's next post-money valuation be?",
    );
    expect(instrumentExpiry(listing, "forward", opens).getTime() - opens.getTime()).toBe(
      90 * 86_400_000,
    );
  });
});

describe("replayLifecycle", () => {
  const start = {
    kind: "forward",
    state: "quoting",
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    widenedAt: null,
    widenedUntil: null,
  } as const;
  const flagAt = new Date("2026-09-15T00:00:00Z");

  it("widens on a flag for flag_hours, and a later mid restores", () => {
    const widened = replayLifecycle(
      start,
      [{ type: "flag", at: flagAt, kind: "scoop" }],
      new Date(flagAt.getTime() + HOUR),
      72,
    );
    expect(widened.instrument).toMatchObject({
      state: "widened",
      widenedUntil: new Date(flagAt.getTime() + 72 * HOUR),
    });
    const restored = replayLifecycle(
      widened.instrument,
      [{ type: "remid", at: new Date(flagAt.getTime() + 1) }],
      new Date(flagAt.getTime() + 2 * HOUR),
      72,
    );
    expect(restored.instrument.state).toBe("quoting");
    expect(restored.effects).toEqual([{ type: "restore" }]);
  });

  it("keeps a flag that ties the latest mid widened, and never applies expiry", () => {
    const tied = replayLifecycle(
      start,
      [
        { type: "flag", at: flagAt, kind: "release" },
        { type: "remid", at: flagAt },
      ],
      flagAt,
      72,
    );
    expect(tied.instrument.state).toBe("widened");
    const late = replayLifecycle(start, [], new Date("2027-01-01T00:00:00Z"), 72);
    expect(late).toEqual({ instrument: start, effects: [] });
  });

  it("ignores flags that do not widen", () => {
    const result = replayLifecycle(
      start,
      [{ type: "flag", at: flagAt, kind: "print" }],
      flagAt,
      72,
    );
    expect(result.instrument.state).toBe("quoting");
  });
});

describe("rulebookEvents", () => {
  function flag(
    kind: EventFlagRow["kind"],
    overrides: Partial<EventFlagRow> & { promoted_from_kind?: string | null } = {},
  ) {
    const release = fixtureFlagsFor("instinct", ["release"]).find(
      (row) => row.published_at === "2026-09-28",
    )!;
    return {
      id: `${kind}-1`,
      company_id: "c",
      kind,
      source_url: "https://example.test/release",
      source_rank: release.source_rank,
      observed_at: utcDay(release.observed_at),
      published_at: utcDay(release.published_at),
      terms_json: release.terms,
      confidence: release.confidence,
      dedupe_key: release.dedupe_key,
      promoted_from: null,
      run_id: null,
      submitted_by: null,
      submitted_kind: null,
      created_at: new Date(0),
      promoted_from_kind: null,
      ...overrides,
    };
  }

  it("settles the forward on prints only and resolves the binary on a release too", () => {
    const flags = [flag("release"), flag("print", { promoted_from_kind: "release" })];
    expect(rulebookEvents("forward", flags)).toEqual([
      expect.objectContaining({ id: "print-1", eventType: "priced_round", postMoneyUsd: 1e10 }),
    ]);
    expect(rulebookEvents("binary", flags).map((event) => event.id)).toEqual([
      "release-1",
      "print-1",
    ]);
  });

  it("needs high confidence and rank 1–2 before a release resolves anything", () => {
    expect(rulebookEvents("binary", [flag("release", { source_rank: 3 })])).toEqual([]);
    expect(rulebookEvents("binary", [flag("release", { confidence: "medium" })])).toEqual([]);
    expect(rulebookEvents("binary", [flag("scoop")])).toEqual([]);
  });

  it("reads an S-1 as the labs' event and a print promoted from it as an IPO", () => {
    expect(rulebookEvents("binary", [flag("s1_public")])[0]).toMatchObject({
      eventType: "public_s1",
    });
    expect(
      rulebookEvents("forward", [flag("print", { promoted_from_kind: "s1_public" })])[0],
    ).toMatchObject({ eventType: "ipo" });
  });
});

describe("withPrintAnchor", () => {
  const instrument: LiveInstrument = {
    id: "i",
    kind: "forward",
    opens_at: new Date("2026-09-29T00:41:00Z"),
    expires_at: new Date("2026-12-28T00:41:00Z"),
    company_id: "c",
    company: "Instinct",
    tier: "redhot",
    binary_event: "priced_round",
    p_floor: 0.05,
    anchor_round: "Series B",
    anchor_date: "2026-08-26",
    anchor_post_money_usd: "2500000000.00",
    anchor_source_url: "https://example.test/instinct-series-b",
  };
  const print = {
    id: "p",
    company_id: "c",
    at: new Date("2026-09-28T00:00:00Z"),
    observed_at: new Date("2026-09-29T00:41:00Z"),
    source_url: "https://example.test/series-c",
    terms_json: { valuation_usd: 1e10, valuation_basis: "post" },
  };

  it("moves the anchor to the latest print dated by the listing, whenever it was observed", () => {
    expect(withPrintAnchor(instrument, [print])).toMatchObject({
      anchor_date: "2026-09-28",
      anchor_post_money_usd: "10000000000",
      anchor_flag_id: "p",
    });
    // A binary rolled at the announcement itself still anchors on it.
    expect(withPrintAnchor({ ...instrument, opens_at: print.at }, [print]).anchor_flag_id).toBe(
      "p",
    );
  });

  it("keeps the listing's anchor for a later print, a same-day one or one without a post-money", () => {
    const later = { ...print, at: new Date("2026-10-01T00:00:00Z") };
    const sameDay = { ...print, at: new Date("2026-08-26T12:00:00Z") };
    const undisclosed = { ...print, terms_json: { valuation_basis: "unknown" } };
    for (const candidate of [later, sameDay, undisclosed]) {
      expect(withPrintAnchor(instrument, [candidate])).toBe(instrument);
    }
  });
});

describe("analyzeReplay on a forward book", () => {
  const marketId = "forward-1";
  const at = new Date("2026-09-10T00:00:00Z");
  function snapshot(overrides: Partial<ReplaySnapshot> = {}): ReplaySnapshot {
    const credit = settlementCreditCents(
      { side: "long", notionalCents: 100_000, entryLn: 22, kappa: 1 },
      23,
    );
    return {
      markets: [
        {
          id: marketId,
          companySlug: "instinct",
          metricKind: "forward_ln",
          nBuckets: 2,
          b: 1,
          initialQ: [0, 0],
          q: [1000, 0],
          lastMarketSequence: "1",
          mmCashFlowCents: String(100_000 - credit),
          roundingReserveCents: "0",
        },
      ],
      trades: [
        {
          id: "t-1",
          marketId,
          marketSequence: "1",
          action: "buy",
          contractSide: "long",
          delta: [1000, 0],
          cashAmountCents: "100000",
          redemptionQuantity: 0,
          redemptionCents: "0",
          metricAfter: Math.exp(21.9),
          createdAt: at,
        },
      ],
      marks: [
        { marketId, marketSequence: "0", tradeId: null, timestamp: new Date(0), value: 1 },
        { marketId, marketSequence: "1", tradeId: "t-1", timestamp: at, value: Math.exp(21.9) },
      ],
      holdings: [],
      users: [{ id: "u", cashBalanceCents: String(10_000_000 - 100_000 + credit) }],
      forwardPositions: [
        {
          id: "p-1",
          marketId,
          tradeId: "t-1",
          side: "long",
          notionalCents: "100000",
          entryLn: 22,
          collateralCents: "100000",
          settled: true,
          settleLn: 23,
          payoutCents: String(credit - 100_000),
          voided: false,
        },
      ],
      ...overrides,
    };
  }

  it("passes a settled long whose credit, cash and mm cash flow agree with forward.ts", () => {
    const report = analyzeReplay(snapshot());
    expect(report.markets[0]!.forwardFindings).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("flags a wrong payout, collateral, missing position and skimmed cash flow", () => {
    const clean = snapshot();
    const position = clean.forwardPositions![0]!;
    const wrongPayout = analyzeReplay(
      snapshot({ forwardPositions: [{ ...position, payoutCents: "1" }] }),
    );
    expect(wrongPayout.markets[0]!.forwardFindings.map((finding) => finding.code)).toContain(
      "CREDIT",
    );
    const wrongCollateral = analyzeReplay(
      snapshot({ trades: [{ ...clean.trades[0]!, cashAmountCents: "99999" }] }),
    );
    expect(wrongCollateral.markets[0]!.forwardFindings.map((finding) => finding.code)).toContain(
      "COLLATERAL",
    );
    const orphan = analyzeReplay(snapshot({ forwardPositions: [] }));
    expect(orphan.markets[0]!.forwardFindings.map((finding) => finding.code)).toEqual([
      "TRADE_WITHOUT_POSITION",
      "MM_CASH_FLOW",
    ]);
    expect(orphan.passed).toBe(false);
  });
});

describe("dealer request schemas", () => {
  const instrumentId = "00000000-0000-4000-8000-000000000001";
  it("takes a forward trade's guard by side and nothing else", () => {
    const base = {
      idempotency_key: "00000000-0000-4000-8000-000000000002",
      instrument_id: instrumentId,
      notional_usd: "100.00",
    };
    expect(
      forwardTradeInputSchema.safeParse({ ...base, side: "long", max_entry_ln: 23 }).success,
    ).toBe(true);
    expect(
      forwardTradeInputSchema.safeParse({ ...base, side: "long", min_entry_ln: 23 }).success,
    ).toBe(false);
    expect(
      forwardTradeInputSchema.safeParse({ ...base, side: "short", min_entry_ln: 23 }).success,
    ).toBe(true);
    expect(
      forwardTradeInputSchema.safeParse({
        ...base,
        notional_usd: "0.00",
        side: "short",
        min_entry_ln: 1,
      }).success,
    ).toBe(false);
  });

  it("previews a forward fill with a side and notional together, or neither", () => {
    expect(forwardQuoteQuerySchema.safeParse({}).success).toBe(true);
    expect(forwardQuoteQuerySchema.safeParse({ side: "short", notional_usd: "5.00" }).success).toBe(
      true,
    );
    expect(forwardQuoteQuerySchema.safeParse({ side: "short" }).success).toBe(false);
  });

  it("addresses an LMSR book by market_id only", () => {
    const buy = { action: "buy", side: "yes", strike_index: 0, quantity: 1 } as const;
    expect(quoteInputSchema.safeParse({ ...buy, market_id: instrumentId }).success).toBe(true);
    expect(quoteInputSchema.safeParse({ ...buy, slug: "anthropic" }).success).toBe(false);
    expect(quoteInputSchema.safeParse(buy).success).toBe(false);
    expect(
      quoteInputSchema.safeParse({ ...buy, slug: "anthropic", market_id: instrumentId }).success,
    ).toBe(false);
  });
});
