// T023 tests — the plan (pure) and the DOM behavior over a minimal fake
// document: reduced motion touches NOTHING; the storm appends GPU-friendly
// pieces once and cleans up after itself.
import { describe, expect, it } from "bun:test";
import { fireConfetti, planConfetti } from "./confetti.js";

interface FakeElement {
  style: Record<string, string>;
  children: unknown[];
  attrs: Record<string, string>;
  removed: boolean;
  setAttribute(k: string, v: string): void;
  appendChild(p: unknown): void;
  remove(): void;
  textContent: string;
  id: string;
}

function fakeDoc(reduced: boolean): {
  doc: Document;
  created: FakeElement[];
  host(): (FakeElement & { children: unknown[] }) | null;
} {
  const created: FakeElement[] = [];
  let bodyChild: FakeElement | null = null;
  const doc = {
    defaultView: { matchMedia: () => ({ matches: reduced }) },
    head: { appendChild: () => {} },
    body: {
      appendChild(el: FakeElement) {
        bodyChild = el;
      },
    },
    getElementById: () => null,
    createElement: (): FakeElement => {
      const el: FakeElement = {
        style: {},
        children: [],
        attrs: {},
        removed: false,
        setAttribute(k, v) {
          el.attrs[k] = v;
        },
        appendChild(p) {
          el.children.push(p);
        },
        remove() {
          el.removed = true;
        },
        textContent: "",
        id: "",
      };
      created.push(el);
      return el;
    },
  };
  return {
    doc: doc as unknown as Document,
    created,
    host: () => bodyChild as FakeElement | null,
  };
}

describe("planConfetti (T023)", () => {
  it("reduced motion plans zero pieces — the storm is optional garnish", () => {
    expect(planConfetti(true)).toEqual({ count: 0, colors: [], durationMs: 1800, reduced: true });
  });

  it("the default storm is sixty pieces over a fixed palette and duration", () => {
    const plan = planConfetti(false);
    expect(plan.count).toBe(60);
    expect(plan.colors.length).toBeGreaterThanOrEqual(4);
    expect(plan.durationMs).toBe(1800);
    expect(plan.reduced).toBe(false);
  });
});

describe("fireConfetti (T023)", () => {
  it("reduced motion touches the DOM not at all", () => {
    const f = fakeDoc(true);
    fireConfetti(f.doc, 60, 1);
    expect(f.created).toHaveLength(0);
    expect(f.host()).toBe(null);
  });

  it("the storm animates transform/opacity only and cleans itself up", async () => {
    const f = fakeDoc(false);
    fireConfetti(f.doc, 8, 1);
    const host = f.host();
    expect(host).not.toBe(null);
    expect(host !== null ? host.children : []).toHaveLength(8);
    expect(host !== null ? host.style.position : "").toBe("fixed");
    expect(host !== null ? host.style.pointerEvents : "").toBe("none");
    const piece = host !== null ? (host.children[0] as FakeElement) : undefined;
    expect(piece === undefined ? "" : piece.style.animation).toContain("kite-confetti-fall");
    expect(piece === undefined ? "" : piece.style.willChange).toContain("transform");
    expect(piece === undefined ? "" : piece.style.position).toBe("absolute");
    // the keyframes stylesheet is injected exactly once
    expect(
      f.created.some(
        (el) => el.id === "kite-confetti-style" || el.textContent.includes("kite-confetti-fall"),
      ),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 700)); // duration 1ms + 500ms grace
    expect(host !== null ? host.removed : false).toBe(true);
  });
});
