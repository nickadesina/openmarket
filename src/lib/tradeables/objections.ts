/**
 * The objection catalog's export (docs/prompts/tradeables, item 8).
 * docs/tradeables/objections.md is the private catalog; objections-anon.md is
 * the copy that leaves the repo: the Who column replaced by role and firm
 * type from docs/tradeables/objections-who.json, the answer column dropped.
 * A row whose Who has no entry there stops the export, so a new row never
 * leaves with a name in it by default. Pure: callers pass the files' text.
 */

export const OBJECTION_COLUMNS = [
  "Date",
  "Who",
  "Objection, in their words",
  "Element",
  "Current answer",
  "Status",
] as const;

export const ANON_COLUMNS = [
  "Date",
  "Who (role, firm type)",
  "Objection, in their words",
  "Element",
  "Status",
] as const;

export interface Objection {
  readonly date: string;
  readonly who: string;
  readonly objection: string;
  readonly element: string;
  readonly answer: string;
  readonly status: string;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** The catalog's one table, checked against its fixed row shape. */
export function parseObjections(markdown: string): Objection[] {
  const lines = markdown.split("\n").filter((line) => line.trimStart().startsWith("|"));
  const [head, separator, ...rows] = lines;
  if (head === undefined || separator === undefined) throw new Error("objections.md has no table");
  const columns = cells(head);
  if (columns.join("|") !== OBJECTION_COLUMNS.join("|")) {
    throw new Error(`objections.md columns are ${columns.join(", ")}`);
  }
  return rows.map((line, index) => {
    const row = cells(line);
    if (row.length !== OBJECTION_COLUMNS.length) {
      throw new Error(`objections.md row ${index + 1} has ${row.length} cells`);
    }
    const [date, who, objection, element, answer, status] = row as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    return { date, who, objection, element, answer, status };
  });
}

/** The design-element legend, as the catalog states it. */
export function elementLegend(markdown: string): string {
  const legend = /^Design elements:[\s\S]*?(?=\n\n)/m.exec(markdown)?.[0];
  if (legend === undefined) throw new Error("objections.md has no design-element legend");
  return legend.replace(/\s*\n\s*/g, " ");
}

export function renderAnonymizedObjections(
  markdown: string,
  whoMap: Readonly<Record<string, string>>,
): string {
  const objections = parseObjections(markdown);
  const unmapped = objections.map((row) => row.who).filter((who) => whoMap[who] === undefined);
  if (unmapped.length > 0) {
    throw new Error(
      `add role and firm type to docs/tradeables/objections-who.json for: ${[...new Set(unmapped)].join("; ")}`,
    );
  }
  const lines = [
    "# Objection catalog",
    "",
    "What people on OpenMarket's pipeline objected to, in their words, and which part of the design each objection hits. Who said it is reduced to role and firm type. Status is open, answered (an answer exists) or conceded (the design changed).",
    "",
    elementLegend(markdown),
    "",
    `| ${ANON_COLUMNS.join(" | ")} |`,
    `| ${ANON_COLUMNS.map(() => "---").join(" | ")} |`,
    ...objections.map(
      (row) =>
        `| ${[row.date, whoMap[row.who]!, row.objection, row.element, row.status].join(" | ")} |`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
