// T017 — the Dukung tab's ENTRY face (FR-007 step 1: "via receive-code
// link/QR or manual entry"). A tab with no pre-selected person must offer a
// way in — the empty backed list used to render a scan instruction with no
// scan UI anywhere, a dead end in primary navigation. The minimal honest
// form: paste the address OR the receive-code link (the QR encodes the same
// link — pasting is the PWA's receive-code path); parsing and the profile
// load stay in DukungBaru's step 1. No wire imports — data/ only.
import { useState } from "react";
import { parseBackerInput } from "../../data/draft.js";
import type { Locale } from "../../locales/id.js";

export function DukungEntry(props: {
  locale: Locale;
  /** test seam + resume: pre-selected input (a share link's seeker) */
  initialRaw?: string;
  onDukung?(seeker: string): void;
}) {
  const { locale } = props;
  const [raw, setRaw] = useState(props.initialRaw ?? "");
  const parsed = parseBackerInput(raw);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-4">
      <h2 className="text-lg font-semibold text-teal-700">{locale.dukung.entryTitle}</h2>
      <p className="text-sm text-slate-600">{locale.dukung.listEmpty}</p>
      <label className="flex flex-col gap-1 text-sm text-slate-600" htmlFor="dukung-entry-who">
        {locale.kirim.recipientLabel}
        <input
          id="dukung-entry-who"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={locale.kirim.recipientManual}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-800"
        />
        <span className="text-xs text-slate-500">{locale.dukung.entryHint}</span>
      </label>
      <button
        type="button"
        disabled={parsed === null}
        onClick={() => {
          if (parsed !== null) props.onDukung?.(parsed);
        }}
        className="rounded-xl bg-teal-600 px-6 py-3 text-base font-semibold text-white shadow disabled:bg-slate-300"
      >
        {locale.common.continue}
      </button>
    </section>
  );
}
