/**
 * A reader for the checked-in CSV inputs, and writers matching the formats the public data files were first made in
 * (Python's csv and json modules), so an export reproduces them byte for byte.
 */

/** One CSV record, quoted only where a field needs it, CRLF-terminated. */
export function csvLine(fields: readonly string[]): string {
  return `${fields.map(csvField).join(",")}\r\n`;
}

function csvField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** A value a generated CSV cell holds: text as is, null as empty, anything structured as JSON. */
export type CsvValue = string | number | boolean | null | Date | readonly unknown[] | object;

/** One cell's text: null is empty, a Date is ISO 8601 UTC, an array or object is its JSON. */
export function csvCell(value: CsvValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** One record of typed values, escaped as csvLine escapes text. */
export function csvRecord(values: readonly CsvValue[]): string {
  return csvLine(values.map(csvCell));
}

/** JSON indented by one space with non-ASCII escaped, no trailing newline. */
export function pythonJson(value: unknown): string {
  return JSON.stringify(value, null, 1).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** RFC 4180 records with a header row: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || record.length > 0) records.push([...record, field]);
  const [header, ...rows] = records.filter((row) => row.some((value) => value !== ""));
  if (header === undefined) return [];
  return rows.map((row) => {
    if (row.length !== header.length) {
      throw new Error(`CSV row has ${row.length} fields; the header has ${header.length}`);
    }
    return Object.fromEntries(header.map((name, i) => [name, row[i]!]));
  });
}
