import { parseCsv } from "../config/listing-anchors.js";
import { csvLine } from "./csv.js";

/**
 * The backtest's public outputs (docs/prompts/tradeables, item 3): the prior's
 * errors and the contracts' outcomes, never their construction. Pure: callers
 * pass backtest/out/calibration.csv, backtest/out/summary.csv and
 * tests/fixtures/rulebook-events.json, and get public/data/backtest/* back.
 *
 * What is dropped stays dropped: calibration's mid0, ln_last, ln_print,
 * loss_fwd, pred and real reconstruct the step-up, and summary's loss columns
 * imply Q and b. tests/scripts/export-backtest-public.test.ts greps public/
 * for them and for params.json's names and values.
 */

export const CALIBRATION_COLUMNS = [
  "company",
  "tier",
  "listed",
  "expiry",
  "print_date",
  "voided",
  "prior_err",
] as const;

export const DROPPED_CALIBRATION_COLUMNS = [
  "mid0",
  "ln_last",
  "ln_print",
  "loss_fwd",
  "pred",
  "real",
] as const;

/** Uniform expiries the backtest ran, in months; the void-rate chart's two bars. */
export const UNIFORM_T_MONTHS = ["3", "12"] as const;

type ForwardStatus = "settled" | "void" | "open";
type BinaryStatus = "yes" | "no" | "open";

export interface RulebookFixture {
  readonly listed: Readonly<
    Record<
      string,
      {
        readonly binary_event: string;
        readonly forward_t_days: number;
        readonly forwards: readonly { readonly status: ForwardStatus }[];
        readonly binaries: readonly {
          readonly quarter_end: string;
          readonly status: BinaryStatus;
        }[];
      }
    >
  >;
}

export interface BacktestPublicInputs {
  readonly calibrationCsv: string;
  readonly summaryCsv: string;
  readonly fixture: RulebookFixture;
  /** params.json `data_through`. */
  readonly dataThrough: string;
  readonly rulebookVersion: string;
  /** The forward's clip in log units; used only to count prints outside it. */
  readonly kappa: number;
}

function field(record: Record<string, string>, name: string): string {
  const value = record[name];
  if (value === undefined) throw new Error(`CSV has no ${name} column`);
  return value;
}

/** Python's str(round(x, 3)) for the ratios here: shortest form, no trailing zeros. */
function ratio(numerator: number, denominator: number): string {
  return String(Number((numerator / denominator).toFixed(3)));
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map(csvLine).join("");
}

export function calibrationCsv(inputs: BacktestPublicInputs): string {
  return table(
    CALIBRATION_COLUMNS,
    parseCsv(inputs.calibrationCsv).map((row) => CALIBRATION_COLUMNS.map((c) => field(row, c))),
  );
}

export function resolutionsCsv(inputs: BacktestPublicInputs): string {
  return table(
    ["company", "binary_event", "quarter_end", "binary_resolved"],
    Object.entries(inputs.fixture.listed).flatMap(([company, name]) =>
      name.binaries.map((binary) => [
        company,
        name.binary_event,
        binary.quarter_end,
        binary.status,
      ]),
    ),
  );
}

export function voidRatesCsv(inputs: BacktestPublicInputs): string {
  return table(
    [
      "company",
      "binary_event",
      "forward_t_days",
      "forward_lives",
      "settled",
      "voided",
      "open",
      "void_rate_of_resolved",
      "binary_quarters",
      "binary_yes",
    ],
    Object.entries(inputs.fixture.listed).map(([company, name]) => {
      const count = (status: ForwardStatus) =>
        name.forwards.filter((forward) => forward.status === status).length;
      const settled = count("settled");
      const voided = count("void");
      return [
        company,
        name.binary_event,
        String(name.forward_t_days),
        String(name.forwards.length),
        String(settled),
        String(voided),
        String(count("open")),
        ratio(voided, settled + voided),
        String(name.binaries.length),
        String(name.binaries.filter((binary) => binary.status === "yes").length),
      ];
    }),
  );
}

function uniformTRows(inputs: BacktestPublicInputs): Record<string, string>[] {
  const rows = parseCsv(inputs.summaryCsv).filter(
    (row) => field(row, "scenario") === "at_listing" && field(row, "group") === "listed",
  );
  return UNIFORM_T_MONTHS.map((months) => {
    const row = rows.find((candidate) => field(candidate, "T_months") === months);
    if (row === undefined)
      throw new Error(`summary.csv has no at_listing listed row for T=${months}`);
    return row;
  });
}

export function voidRatesUniformTCsv(inputs: BacktestPublicInputs): string {
  return table(
    [
      "T_months",
      "group",
      "forward_lives",
      "settled",
      "voided",
      "void_rate",
      "binary_quarters",
      "binary_yes",
    ],
    uniformTRows(inputs).map((row) => {
      const settled = Number(field(row, "settlements"));
      const voided = Number(field(row, "voids"));
      return [
        field(row, "T_months"),
        field(row, "group"),
        String(settled + voided),
        String(settled),
        String(voided),
        ratio(voided, settled + voided),
        field(row, "bin_quarters"),
        field(row, "bin_yes"),
      ];
    }),
  );
}

/** The figures the README's reading states, each computed from the files it describes. */
export function readingFigures(inputs: BacktestPublicInputs): {
  readonly sdByTier: Readonly<Record<"mega" | "redhot", number>>;
  readonly outsideClip: number;
  readonly prints: number;
  readonly shortVoidRate: number;
} {
  const rows = parseCsv(inputs.calibrationCsv);
  const errors = (tier: string) =>
    rows.filter((row) => field(row, "tier") === tier).map((row) => Number(field(row, "prior_err")));
  const sd = (values: readonly number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    return Math.sqrt(squares / (values.length - 1));
  };
  const short = uniformTRows(inputs)[0]!;
  const voids = Number(field(short, "voids"));
  return {
    sdByTier: { mega: sd(errors("mega")), redhot: sd(errors("redhot")) },
    outsideClip: rows.filter((row) => Math.abs(Number(field(row, "prior_err"))) > inputs.kappa)
      .length,
    prints: rows.length,
    shortVoidRate: voids / (voids + Number(field(short, "settlements"))),
  };
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** An integer below one hundred in words, as the README's prose writes counts. */
export function numberWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 99) throw new RangeError(`${value}`);
  if (value < 20) return ONES[value]!;
  const tens = TENS[Math.floor(value / 10)]!;
  return value % 10 === 0 ? tens : `${tens}-${ONES[value % 10]}`;
}

/** A void rate as "n of every d", the nearest of halves, thirds and quarters. */
function fractionWords(rate: number): string {
  let best = { error: Number.POSITIVE_INFINITY, text: "" };
  for (const denominator of [2, 3, 4]) {
    const numerator = Math.round(rate * denominator);
    const error = Math.abs(rate - numerator / denominator);
    if (numerator > 0 && error < best.error) {
      best = { error, text: `${numberWords(numerator)} of every ${numberWords(denominator)}` };
    }
  }
  return best.text;
}

export function backtestReadme(inputs: BacktestPublicInputs): string {
  const figures = readingFigures(inputs);
  return `# OpenMarket backtest, public outputs

Data through ${inputs.dataThrough}; rulebook v${inputs.rulebookVersion}. Reproduced from the backtest
in the OpenMarket repository. The construction of the prior is not
published; these files carry its errors and the contracts' outcomes,
not its inputs.

- \`calibration.csv\`: one row per forward life that settled on a print
  for the listed names and comparables. \`prior_err\` is ln(print) minus
  ln(prior mid at listing). Its standard deviation by tier is the
  dispersion the dealer's spread is built on.
- \`resolutions.csv\`: for each listed name and calendar quarter since
  2024, whether a quarterly timing binary would have resolved yes
  under rulebook v${inputs.rulebookVersion.split(".")[0]}.
- \`void-rates.csv\`: per listed name at its launch expiry, how many
  forward lives settled, voided or are open, with the binary's event
  (a priced round, or a public S-1 for the labs).
- \`void-rates-uniform-t.csv\`: the same names under a uniform expiry of
  ${UNIFORM_T_MONTHS.join(" and ")} months, from the backtest's no-trader scenario.

What the numbers say: the prior landed within about ${figures.sdByTier.mega.toFixed(2)} log of the
print on mega-cap names and about ${figures.sdByTier.redhot.toFixed(2)} on red-hot names; ${numberWords(figures.outsideClip)} ${figures.outsideClip === 1 ? "print" : "prints"} in
${numberWords(figures.prints)} fell outside the clip. A uniform ${numberWords(Number(UNIFORM_T_MONTHS[0]))}-month forward expiry
voided ${fractionWords(figures.shortVoidRate)} lives on these names, which is why expiry is
set per name.

License: CC BY 4.0, cite OpenMarket.
`;
}

export function backtestPublicFiles(
  inputs: BacktestPublicInputs,
): Readonly<Record<string, string>> {
  return {
    "README.md": backtestReadme(inputs),
    "calibration.csv": calibrationCsv(inputs),
    "resolutions.csv": resolutionsCsv(inputs),
    "void-rates.csv": voidRatesCsv(inputs),
    "void-rates-uniform-t.csv": voidRatesUniformTCsv(inputs),
  };
}
