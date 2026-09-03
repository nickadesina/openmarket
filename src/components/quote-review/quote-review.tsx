import type { ReactNode } from "react";

export interface QuoteRow {
  readonly label: string;
  readonly value: ReactNode;
}

/**
 * The definition list both trade reviews render: one `<div><dt/><dd/></div>` per row.
 * Callers own the row set and the wrapper styling; contract prices in the rows go
 * through `formatContractPrice` so the two screens cannot drift apart again.
 */
export function QuoteReview({
  className,
  rows,
}: {
  readonly className?: string | undefined;
  readonly rows: readonly QuoteRow[];
}) {
  return (
    <dl className={className}>
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
