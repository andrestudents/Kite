// T026 — the pure parts of the desktop hand-off. The QR raster itself needs a
// browser canvas; its correctness is T027's on-device gate (scannable).
import { describe, expect, it } from "bun:test";
import { handoffUrl } from "./DesktopFrame.js";

describe("handoffUrl (T026 — static address only)", () => {
  it("origin + path, bare root", () => {
    expect(handoffUrl({ origin: "https://kite.example", pathname: "/", search: "" })).toBe(
      "https://kite.example/",
    );
  });

  it("keeps path and query — and nothing else is ever added", () => {
    expect(
      handoffUrl({ origin: "https://kite.example", pathname: "/onboarding", search: "?src=qr" }),
    ).toBe("https://kite.example/onboarding?src=qr");
  });
});
