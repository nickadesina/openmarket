/**
 * Just enough XML for EDGAR's flat forms (N-PORT, Form D): the text of a
 * named element, every block of a repeated element, an attribute. Namespace
 * prefixes are ignored; entities are decoded. No DTDs, no nesting of an
 * element inside itself (neither form has any).
 */

const ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  amp: "&",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** The text of the first `<tag>…</tag>` inside `xml`, trimmed and decoded; empty when absent. */
export function tagText(xml: string, tag: string): string {
  const match = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(xml);
  if (match === null) return "";
  return decodeEntities(stripCdata(match[1]!).trim());
}

/** The inner XML of every `<tag>…</tag>` in `xml`, in document order. */
export function blocks(xml: string, tag: string): string[] {
  return [
    ...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g")),
  ].map((match) => match[1]!);
}

/** An attribute's value on the first element named `tag`; empty when absent. */
export function attribute(xml: string, tag: string, name: string): string {
  const element = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`).exec(xml)?.[1] ?? "";
  return decodeEntities(new RegExp(`\\b${name}="([^"]*)"`).exec(element)?.[1] ?? "");
}
