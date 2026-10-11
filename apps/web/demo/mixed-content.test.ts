// T024 follow-up — the mixed-content guard for phone prep: the HTTPS page
// cannot fetch http:// URLs (only localhost is exempt, same machine only).
// This is the exact trap that made phone prep fail against a LAN-IP server.
import { describe, expect, it } from "bun:test";
import { mixedContentWarning } from "./main.js";

const PAGE = "https://kite-zeta.vercel.app/demo/prep.html";

describe("mixedContentWarning (phone-prep guard)", () => {
  it("https page + http LAN address → the blocked-mixed-content explanation + cloudflared way out", () => {
    const warning = mixedContentWarning(PAGE, "http://192.168.1.7:8787");
    expect(warning).not.toBeNull();
    expect(warning ?? "").toMatch(/mixed content/i);
    expect(warning ?? "").toMatch(/cloudflared tunnel --url http:\/\/localhost:8787/);
  });

  it("https page + http localhost → reachable ONLY from the laptop itself", () => {
    const warning = mixedContentWarning(PAGE, "http://localhost:8787");
    expect(warning).not.toBeNull();
    expect(warning ?? "").toMatch(/laptop/);
  });

  it("https page + https tunnel URL → no warning (the intended phone setup)", () => {
    expect(mixedContentWarning(PAGE, "https://some-id.trycloudflare.com")).toBeNull();
  });

  it("local dev page (http) → never warns", () => {
    expect(
      mixedContentWarning("http://localhost:5173/demo/prep.html", "http://localhost:8787"),
    ).toBeNull();
    expect(
      mixedContentWarning("http://localhost:5173/demo/prep.html", "http://192.168.1.7:8787"),
    ).toBeNull();
  });
});
