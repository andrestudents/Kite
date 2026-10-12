// T009 — the shell renders from the catalogs only (server-side smoke): the
// tab bar exposes all four tabs with the active one emphasized, and the edge
// states carry their catalog strings — offline labels its data time, error
// offers retry. renderToString keeps this headless (no DOM).
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { id } from "../../locales/id.js";
import {
  EmptyState,
  ErrorState,
  formatClock,
  LoadingSkeleton,
  OfflineState,
} from "./EdgeStates.js";
import { TabBar } from "./TabBar.js";

describe("TabBar (T009, FR-001)", () => {
  it("renders all four tabs from the catalog, active one emphasized", () => {
    const html = renderToString(
      <TabBar locale={id} active="dukung" onNavigate={() => undefined} />,
    );
    expect(html).toContain("Beranda");
    expect(html).toContain("Dukung");
    expect(html).toContain("Kirim");
    expect(html).toContain("Riwayat");
    expect(html).toContain('aria-current="page"');
  });
});

describe("EdgeStates (T009, FR-020)", () => {
  it("formatClock renders the Indonesian HH.MM label", () => {
    const at = new Date(2026, 9, 12, 14, 5);
    expect(formatClock(at)).toBe("14.05");
    expect(formatClock(1_795_000_000_000)).toMatch(/^\d{2}\.\d{2}$/);
  });

  it("offline state labels the data time and disables its children", () => {
    const html = renderToString(
      <OfflineState locale={id} fetchedAt={new Date(2026, 9, 12, 9, 30)}>
        <p>snapshot</p>
      </OfflineState>,
    );
    expect(html).toContain("Sedang tanpa sambungan");
    // JSX comments split adjacent text nodes — assert the pieces.
    expect(html).toContain("Data per");
    expect(html).toContain("09.30");
    expect(html).toContain("aria-disabled");
  });

  it("empty and error states render their catalog copy and the retry affordance", () => {
    const empty = renderToString(
      <EmptyState
        locale={id}
        message="Belum ada apa pun di sini."
        ctaLabel="Coba lagi"
        onCta={() => undefined}
      />,
    );
    expect(empty).toContain("Belum ada apa pun di sini.");
    const error = renderToString(<ErrorState locale={id} onRetry={() => undefined} />);
    expect(error).toContain("Ada kendala");
    expect(error).toContain("Coba lagi");
    expect(renderToString(<LoadingSkeleton />)).toContain("animate-pulse");
  });
});
