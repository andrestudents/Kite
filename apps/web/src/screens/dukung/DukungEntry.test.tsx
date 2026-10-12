// The entry-matrix regressions (device-gate Finding B): the Dukung tab with
// no pre-selected person renders a FUNCTIONAL entry face — input + continue —
// for every input cell: empty, a plain address, a pasted receive-code link
// (with ?ajukan=), and garbage. No cell is blank, and continue only opens
// the flow once the input parses. renderToString pins first paints (the
// established pattern: effects never fire under SSR).
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { getAddress } from "viem/utils";
import { id } from "../../locales/id.js";
import { DukungEntry } from "./DukungEntry.js";

// Checksummed from the lowercase form — parseBackerInput enforces EIP-55, so
// the fixture must carry a VALID checksum (a hand-typed mixed-case string
// would fail the very check under test).
const SEEKER = getAddress("0x46b2e9abcd1234567890abcdef1234567890abcd");

function renderEntry(raw?: string): string {
  return renderToString(<DukungEntry locale={id} initialRaw={raw} onDukung={() => {}} />);
}

describe("the Dukung entry face (Finding B — the tab is never a dead end)", () => {
  it("no input: title, hint, input, and a DISABLED continue — never blank", () => {
    const html = renderEntry();
    expect(html).toContain(id.dukung.entryTitle);
    expect(html).toContain(id.dukung.listEmpty);
    expect(html).toContain(id.dukung.entryHint);
    expect(html).toContain('id="dukung-entry-who"');
    expect(html).toContain("disabled");
    expect(html).toContain(id.common.continue);
  });

  it("a plain address parses — continue is enabled", () => {
    const html = renderEntry(SEEKER);
    // the ATTRIBUTE, not the substring — disabled:bg-slate-300 is a class
    expect(html).not.toContain('disabled=""');
    expect(html).toContain(`value="${SEEKER}"`);
  });

  it("a pasted receive-code LINK (the QR's payload) parses — continue is enabled", () => {
    const html = renderEntry(`https://kite-zeta.vercel.app/p/${SEEKER}?ajukan=bibit%20padi`);
    expect(html).not.toContain('disabled=""');
  });

  it("garbage input keeps the face honest — continue stays disabled", () => {
    const html = renderEntry("budi ngawi");
    expect(html).toContain("disabled");
    // the input still shows what was typed — never a wiped field
    expect(html).toContain('value="budi ngawi"');
  });

  it("a resume preseed (share-link seeker) lands in the input on first paint", () => {
    const html = renderEntry(SEEKER);
    expect(html).toContain(`value="${SEEKER}"`);
  });
});
