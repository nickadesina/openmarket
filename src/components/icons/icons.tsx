/** Drawn 1.5px line icons; one stroke weight across the set. Decorative by default. */

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function MovementArrow({
  direction,
  size = 12,
}: {
  readonly direction: "up" | "down" | "flat";
  readonly size?: number;
}) {
  const path =
    direction === "up"
      ? "M6 10 L6 2 M2.5 5.5 L6 2 L9.5 5.5"
      : direction === "down"
        ? "M6 2 L6 10 M2.5 6.5 L6 10 L9.5 6.5"
        : "M2 6 L10 6 M6.5 2.5 L10 6 L6.5 9.5";

  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-0.0625em" }}
    >
      <path d={path} {...strokeProps} />
    </svg>
  );
}

export function UserIcon({ size = 14 }: { readonly size?: number }) {
  return (
    <svg
      viewBox="0 0 14 14"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-0.125em" }}
    >
      <circle cx="7" cy="4.5" r="2.5" {...strokeProps} />
      <path d="M2 12.5 C2 9.75 4.25 8.5 7 8.5 C9.75 8.5 12 9.75 12 12.5" {...strokeProps} />
    </svg>
  );
}
