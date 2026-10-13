// The mark's two faces, pinned as first paints: leaf for the everyday brand,
// gold for celebration. It is decorative by contract (aria-hidden) — the
// wordmark beside it always carries the name.
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { Mark } from "./Mark.js";

describe("Mark (the kite)", () => {
  it("leaf variant: leaf body, paper spars, gold knot", () => {
    const html = renderToString(<Mark className="h-7 w-6" />);
    expect(html).toContain('fill="#2E7D46"');
    expect(html).toContain('stroke="#F7F9F3"');
    expect(html).toContain('fill="#E3A72F"');
    expect(html).toContain('class="h-7 w-6"');
  });

  it("gold variant: gold body, ink spars — the celebration face", () => {
    const html = renderToString(<Mark variant="gold" />);
    expect(html).toContain('fill="#E3A72F"');
    expect(html).toContain('stroke="#16301F"');
  });

  it("decorative everywhere — aria-hidden, sizing via className", () => {
    const html = renderToString(<Mark />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('viewBox="0 0 64 72"');
  });
});
