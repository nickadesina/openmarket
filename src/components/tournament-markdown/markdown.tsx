import type { ReactNode } from "react";

import styles from "./markdown.module.css";

/**
 * A deliberately small Markdown subset for rulebooks and notes, rendered as
 * React elements (never as HTML): paragraphs, `-` and `1.` lists, `**bold**`,
 * `*italic*`, `` `code` ``, and `[text](https://…)` links.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;

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
    else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]("));
      nodes.push(
        <a key={key} href={match[2]} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    } else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = start + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Line {
  /** Character offset in the source: a stable key for static text. */
  readonly offset: number;
  readonly text: string;
}

interface Block {
  readonly offset: number;
  readonly lines: readonly Line[];
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let lines: Line[] = [];
  let offset = 0;
  for (const text of source.replaceAll("\r\n", "\n").split("\n")) {
    if (text.trim().length === 0) {
      if (lines.length > 0) blocks.push({ offset: lines[0]!.offset, lines });
      lines = [];
    } else {
      lines.push({ offset, text });
    }
    offset += text.length + 1;
  }
  if (lines.length > 0) blocks.push({ offset: lines[0]!.offset, lines });
  return blocks;
}

const BULLET = /^\s*-\s+/;
const NUMBERED = /^\s*\d+\.\s+/;

function listItems(lines: readonly Line[], marker: RegExp) {
  return lines.map((line) => (
    <li key={line.offset}>{inline(line.text.replace(marker, ""), `l${line.offset}`)}</li>
  ));
}

export function Markdown({ source }: { readonly source: string }) {
  return (
    <div className={styles.markdown}>
      {parseBlocks(source).map(({ offset, lines }) => {
        if (lines.every((line) => BULLET.test(line.text))) {
          return <ul key={offset}>{listItems(lines, BULLET)}</ul>;
        }
        if (lines.every((line) => NUMBERED.test(line.text))) {
          return <ol key={offset}>{listItems(lines, NUMBERED)}</ol>;
        }
        return (
          <p key={offset}>
            {lines.map((line, position) => (
              <span key={line.offset}>
                {position > 0 ? <br /> : null}
                {inline(line.text, `l${line.offset}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
