// T009 — the bottom tab bar (FR-001): Beranda · Dukung · Kirim · Riwayat —
// one app for both roles, emphasis carried by which tab is active (a seeker
// opens onto Beranda, a backer onto Dukung — the App decides, the bar only
// renders state). Every string from the catalogs (the T005 gate applies).
import type { Locale } from "../../locales/id.js";

export type TabId = "beranda" | "dukung" | "kirim" | "riwayat";

export const TAB_IDS: readonly TabId[] = ["beranda", "dukung", "kirim", "riwayat"];

/** Decorative geometric glyphs — no icons dependency; the title carries the
 *  catalog label so the glyph is never an unnamed graphic. */
function TabGlyph({ tab, active, label }: { tab: TabId; active: boolean; label: string }) {
  const stroke = active ? "currentColor" : "#8CA193";
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tab === "beranda") {
    return (
      <svg {...common}>
        <title>{label}</title>
        <path d="M4 12 12 4l8 8" />
        <path d="M6 10v10h12V10" />
      </svg>
    );
  }
  if (tab === "dukung") {
    return (
      <svg {...common}>
        <title>{label}</title>
        <path d="M12 20s-7-4.6-7-9.5C5 7.5 7 6 9 6c1.4 0 2.4.7 3 1.7C12.6 6.7 13.6 6 15 6c2 0 4 1.5 4 4.5C19 15.4 12 20 12 20Z" />
      </svg>
    );
  }
  if (tab === "kirim") {
    return (
      <svg {...common}>
        <title>{label}</title>
        <path d="M4 12h13" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <title>{label}</title>
      <path d="M5 4h14v16l-7-3-7 3Z" />
    </svg>
  );
}

export function TabBar(props: { locale: Locale; active: TabId; onNavigate(tab: TabId): void }) {
  const { locale, active, onNavigate } = props;
  return (
    <nav
      aria-label={locale.appName}
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md justify-around border-t border-line bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur"
    >
      {TAB_IDS.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onNavigate(tab)}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-1.5 text-xs font-semibold ${
              isActive ? "text-leafdk" : "text-lichen"
            }`}
          >
            <TabGlyph tab={tab} active={isActive} label={locale.tabs[tab]} />
            <span>{locale.tabs[tab]}</span>
          </button>
        );
      })}
    </nav>
  );
}
