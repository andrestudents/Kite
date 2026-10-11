// T016 — Phone (FR-002): the number is typed in LOCAL format as written
// (leading zero kept — no international coercion), validated loosely, and
// stored DEVICE-LOCAL only. No server field exists for it; the users table
// stays dormant.
import { useState } from "react";
import type { Locale } from "../locales/id.js";

const LOCAL_MSISDN = /^0\d{7,13}$/; // e.g. 081234567890 — as typed, leading zero

export const PHONE_KEY = "kite.demo.phone";

export function loadDemoPhone(storage: Storage): string | null {
  try {
    return storage.getItem(PHONE_KEY);
  } catch {
    return null;
  }
}

export function Phone(props: { locale: Locale; onDone(phone: string): void }) {
  const { locale } = props;
  const [value, setValue] = useState(loadDemoPhone(localStorage) ?? "");
  const [touched, setTouched] = useState(false);
  const valid = LOCAL_MSISDN.test(value);

  function save(): void {
    setTouched(true);
    if (!valid) return;
    try {
      localStorage.setItem(PHONE_KEY, value);
    } catch {
      // storage denied — the demo step still proceeds; nothing is sent anyway
    }
    props.onDone(value);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="text-center text-2xl font-bold text-teal-700">{locale.phone.title}</h1>
      <div className="flex flex-col gap-2">
        <input
          type="tel"
          inputMode="numeric"
          value={value}
          placeholder={locale.phone.placeholder}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="rounded-xl border border-slate-300 px-4 py-3 text-lg tracking-wide focus:border-teal-600 focus:outline-none"
        />
        <p className="text-xs text-slate-500">{locale.phone.hint}</p>
        {touched && !valid ? <p className="text-sm text-rose-600">{locale.phone.invalid}</p> : null}
      </div>
      <button
        type="button"
        onClick={save}
        className="rounded-xl bg-teal-600 px-6 py-4 text-lg font-semibold text-white shadow"
      >
        {locale.common.continue}
      </button>
      <p className="text-center text-xs text-slate-400">{locale.phone.note}</p>
    </main>
  );
}
