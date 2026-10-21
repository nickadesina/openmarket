/**
 * Suggestions offered when a forecaster states an affiliation. Free text is
 * accepted too; affiliations are self-reported and never verified.
 */
export interface AffiliationSuggestion {
  readonly name: string;
  readonly kind: "lab" | "school" | "investor";
}

export const AFFILIATION_SUGGESTIONS: readonly AffiliationSuggestion[] = [
  { name: "Anthropic", kind: "lab" },
  { name: "OpenAI", kind: "lab" },
  { name: "Google DeepMind", kind: "lab" },
  { name: "Meta", kind: "lab" },
  { name: "xAI", kind: "lab" },
  { name: "Microsoft", kind: "lab" },
  { name: "Nvidia", kind: "lab" },
  { name: "Mistral AI", kind: "lab" },
  { name: "Stanford", kind: "school" },
  { name: "MIT", kind: "school" },
  { name: "UC Berkeley", kind: "school" },
  { name: "Harvard", kind: "school" },
  { name: "Carnegie Mellon", kind: "school" },
  { name: "Princeton", kind: "school" },
  { name: "Oxford", kind: "school" },
  { name: "Cambridge", kind: "school" },
  { name: "Andreessen Horowitz", kind: "investor" },
  { name: "Sequoia Capital", kind: "investor" },
  { name: "Founders Fund", kind: "investor" },
  { name: "Benchmark", kind: "investor" },
  { name: "Accel", kind: "investor" },
  { name: "Lightspeed", kind: "investor" },
  { name: "Kleiner Perkins", kind: "investor" },
  { name: "General Catalyst", kind: "investor" },
  { name: "Thrive Capital", kind: "investor" },
  { name: "Y Combinator", kind: "investor" },
];

export const AFFILIATION_MAX_LENGTH = 60;
