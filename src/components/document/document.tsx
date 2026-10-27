import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./document.module.css";

/**
 * The repository's prose documents rendered as a page (the rulebook's
 * changelog and reviewers, the feed-trial terms, the policy one-pager), as
 * React elements, never HTML. The subset those files use: `#` headings with
 * anchors, paragraphs, `-` and `1.` lists whose items may wrap, pipe tables,
 * `**bold**`, `*italic*`, `` `code` `` and `[text](https://…)` links. A code
 * span holding a site path (`/rulebook`) becomes a link to it.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\((https:\/\/[^)\s]+)\))/g;
const SITE_PATH = /^\/[a-z0-9][a-z0-9/._-]*$/;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) {
      const code = token.slice(1, -1);
      nodes.push(
        SITE_PATH.test(code) ? (
          <Link key={key} href={code}>
            <code>{code}</code>
          </Link>
        ) : (
          <code key={key}>{code}</code>
        ),
      );
    } else if (token.startsWith("[")) {
      nodes.push(
        <a key={key} href={match[2]} rel="noopener noreferrer">
          {token.slice(1, token.indexOf("]("))}
        </a>,
      );
    } else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = start + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** A heading's anchor: lowercase words joined by hyphens. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type Block =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: "table"; readonly head: readonly string[]; readonly rows: readonly string[][] }
  | { readonly kind: "paragraph"; readonly text: string };

const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^-\s+/;
const NUMBERED = /^\d+\.\s+/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));
}

export function parseDocument(source: string): Block[] {
  const blocks: Block[] = [];
  let group: string[] = [];
  const flush = () => {
    if (group.length > 0) blocks.push(groupBlock(group));
    group = [];
  };
  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
    } else if (line.trim() === "") flush();
    else group.push(line);
  }
  flush();
  return blocks;
}

function groupBlock(lines: readonly string[]): Block {
  const first = lines[0]!;
  if (first.trimStart().startsWith("|")) {
    const [head, , ...rows] = lines;
    return { kind: "table", head: cells(head!), rows: rows.map(cells) };
  }
  const ordered = NUMBERED.test(first);
  if (ordered || BULLET.test(first)) {
    const marker = ordered ? NUMBERED : BULLET;
    const items: string[] = [];
    for (const line of lines) {
      if (marker.test(line)) items.push(line.replace(marker, ""));
      else items[items.length - 1] = `${items.at(-1)} ${line.trim()}`;
    }
    return { kind: "list", ordered, items };
  }
  return { kind: "paragraph", text: lines.map((line) => line.trim()).join(" ") };
}

export function DocumentBody({
  source,
  skipTitle = false,
}: {
  readonly source: string;
  /** Leave out the document's `#` title when the page sets its own h1. */
  readonly skipTitle?: boolean;
}) {
  const blocks = parseDocument(source).filter(
    (block) => !(skipTitle && block.kind === "heading" && block.level === 1),
  );
  return (
    <div className={styles.document}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(block.level + 1, 4)}` as "h2" | "h3" | "h4";
            return (
              <Tag key={key} id={headingId(block.text)}>
                {inline(block.text, key)}
              </Tag>
            );
          }
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={key}>
                {block.items.map((item, position) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static text in source order
                  <li key={position}>{inline(item, `${key}-${position}`)}</li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={key} className={styles.scroller}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {block.head.map((cell) => (
                        <th key={cell} scope="col">
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, position) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: static text in source order
                      <tr key={position}>
                        {row.map((cell, column) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: static text in source order
                          <td key={column}>{inline(cell, `${key}-${position}-${column}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={key}>{inline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}
