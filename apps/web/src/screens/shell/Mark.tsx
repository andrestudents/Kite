// The product mark — a kite (layang-layang). Leaf for the everyday brand
// face, gold for the celebration faces (a funded season, Garis Finis).
// Pure SVG, no icon dependency; decorative everywhere it appears
// (aria-hidden — the wordmark or a heading always carries the name).
export function Mark(props: { variant?: "leaf" | "gold"; className?: string }) {
  const { variant = "leaf", className } = props;
  const colors =
    variant === "gold"
      ? { body: "#E3A72F", spars: "#16301F", tail: "#16301F", knot: "#2E7D46" }
      : { body: "#2E7D46", spars: "#F7F9F3", tail: "#16301F", knot: "#E3A72F" };
  return (
    <svg viewBox="0 0 64 72" aria-hidden="true" className={className}>
      <path d="M32 4 52 28 32 52 12 28Z" fill={colors.body} />
      <path d="M32 4v48M12 28h40" stroke={colors.spars} strokeWidth="4" fill="none" />
      <path d="M32 52c-1 6-7 7-9 13" stroke={colors.tail} strokeWidth="4" fill="none" />
      <path d="m23 65 2.6 3L23 71l-2.6-3z" fill={colors.knot} />
    </svg>
  );
}
