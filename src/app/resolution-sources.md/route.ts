import { renderResolutionSourcesMarkdown } from "../../lib/tradeables/resolution-sources.js";

export const dynamic = "force-static";

/** The map as Markdown, the same text scripts/export-resolution-sources.ts writes. */
export function GET(): Response {
  return new Response(renderResolutionSourcesMarkdown(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}
