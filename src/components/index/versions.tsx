import type { RefEnvelope } from "../../lib/services/index/ref-envelope.js";
import styles from "./index.module.css";

/** The versions every figure on a page was computed under, as the payload names them. */
export function Versions({
  versions,
  extra = [],
}: {
  readonly versions: Pick<RefEnvelope, "methodology_version" | "ce_version" | "rulebook_version">;
  readonly extra?: readonly (readonly [string, string])[];
}) {
  const rows: (readonly [string, string])[] = [
    ["Methodology", versions.methodology_version],
    ["CE", versions.ce_version],
    ["Rulebook", versions.rulebook_version],
    ...extra,
  ];
  return (
    <dl className={styles.versions} aria-label="Versions">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
