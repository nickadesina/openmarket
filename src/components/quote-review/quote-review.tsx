import type { ReactNode } from "react";

export interface QuoteRow {
  readonly label: string;
  readonly value: ReactNode;
}

/**
 * The definition list both trade reviews render: one `<div><dt/><dd/></div>` per row.
 * Callers own the row set and the styling (the list's class and, when the labels are
 * not styled through it, the labels' class); contract prices in the rows go
 * through `formatContractPrice` so the two screens cannot drift apart again.
 */
export function QuoteReview({
  className,
  labelClassName,
  rows,
}: {
  readonly className?: string | undefined;
  readonly labelClassName?: string | undefined;
  readonly rows: readonly QuoteRow[];
}) {
  return (
    <dl className={className}>
      {rows.map((row) => (
        <div key={row.label}>
          <dt className={labelClassName}>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
