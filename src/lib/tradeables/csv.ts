/**
 * Writers matching the formats the public data files were first made in
 * (Python's csv and json modules), so an export reproduces them byte for byte.
 */

/** One CSV record, quoted only where a field needs it, CRLF-terminated. */
export function csvLine(fields: readonly string[]): string {
  return `${fields.map(csvField).join(",")}\r\n`;
}

function csvField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** JSON indented by one space with non-ASCII escaped, no trailing newline. */
export function pythonJson(value: unknown): string {
  return JSON.stringify(value, null, 1).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
