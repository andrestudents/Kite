// T023 — in-house confetti (research D13): ~60 lines, ZERO dependencies.
// GPU-friendly: pieces animate only transform (translate3d + rotate) and
// opacity — never layout properties. `prefers-reduced-motion: reduce` skips
// the storm entirely: the celebrating surfaces carry the moment in copy and
// color, so the animation is genuinely optional garnish.

export interface ConfettiPlan {
  count: number;
  colors: string[];
  durationMs: number;
  reduced: boolean;
}

const PALETTE = ["#1B4332", "#2D6A4F", "#40916C", "#52B788", "#B7E4C7", "#E3A72F"];

/** Pure plan — fixture-testable. Reduced motion plans ZERO pieces. */
export function planConfetti(reduced: boolean, count = 60, durationMs = 1800): ConfettiPlan {
  if (reduced) return { count: 0, colors: [], durationMs, reduced: true };
  return { count, colors: PALETTE, durationMs, reduced: false };
}

const STYLE_ID = "kite-confetti-style";
const KEYFRAMES =
  "@keyframes kite-confetti-fall{0%{transform:translate3d(0,-4vh,0) rotate(0deg);opacity:1}" +
  "85%{opacity:1}100%{transform:translate3d(6vw,108vh,0) rotate(660deg);opacity:0}}";

export function fireConfetti(doc: Document, count = 60, durationMs = 1800): void {
  const media = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const plan = planConfetti(media?.matches === true, count, durationMs);
  if (plan.count === 0) return;

  if (doc.getElementById(STYLE_ID) === null) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = KEYFRAMES;
    doc.head.appendChild(style);
  }

  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  const hostStyle = host.style;
  hostStyle.position = "fixed";
  hostStyle.inset = "0";
  hostStyle.overflow = "hidden";
  hostStyle.pointerEvents = "none";
  hostStyle.zIndex = "60";

  for (let i = 0; i < plan.count; i += 1) {
    const piece = doc.createElement("div");
    const s = piece.style;
    s.position = "absolute";
    s.width = "8px";
    s.height = "12px";
    s.backgroundColor = plan.colors[i % plan.colors.length] ?? PALETTE[0] ?? "#2D6A4F";
    s.left = `${(Math.random() * 100).toFixed(1)}%`;
    s.top = "-4vh";
    s.willChange = "transform, opacity";
    s.animation = `kite-confetti-fall ${plan.durationMs}ms linear ${(Math.random() * 400).toFixed(0)}ms forwards`;
    host.appendChild(piece);
  }

  doc.body.appendChild(host);
  setTimeout(() => {
    host.remove();
  }, plan.durationMs + 500);
}
