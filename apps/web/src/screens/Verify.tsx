// T016 — Verify: constitution VIII — this checker is a DEMO TOOL and says so
// on its face. It auto-approves; the ONLY thing that leaves the device is the
// client-computed identity hash (data-model §3) — the photos themselves never
// do. Submit → poll the read-backs at a gentle interval with plain-language
// retry, never a dead end (US1-AC5) — and the poll itself owes an answer:
// past the deadline the waiting face becomes a localized stalled face with a
// retry (loading is a phase, never a destination — the relayer confirms
// out-of-band, so a retried read-back lands the moment it does).
import { useRef, useState } from "react";
import type { ApiClient } from "../data/bootstrap.js";
import { demoIdentityHash } from "../lib/identityHash.js";
import type { Locale } from "../locales/id.js";

const POLL_MS = 2_500;
/** How long "Mengecek…" may stand before the stalled face owes the user a
 *  retry — covers a cold relayer wake (free-tier spin-up ~30 s) with room. */
export const VERIFY_DEADLINE_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readBytes(file: File | null): Promise<Uint8Array> {
  if (!file) return new Uint8Array(0);
  return new Uint8Array(await file.arrayBuffer());
}

export function Verify(props: {
  locale: Locale;
  api: ApiClient;
  /** The session wallet — binds the hash to the account (data-model §3). */
  wallet: string;
  onReady(): void;
}) {
  const { locale, api, wallet } = props;
  const [phase, setPhase] = useState<"idle" | "submitting" | "checking" | "ready" | "stalled">(
    "idle",
  );
  const [captured, setCaptured] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const ktpRef = useRef<File | null>(null);
  const selfieRef = useRef<File | null>(null);

  function grab(input: HTMLInputElement | null, slot: "ktp" | "selfie"): void {
    const file = input?.files?.[0] ?? null;
    if (slot === "ktp") ktpRef.current = file;
    else selfieRef.current = file;
    setCaptured((ktpRef.current ? 1 : 0) + (selfieRef.current ? 1 : 0));
  }

  async function run(): Promise<void> {
    if (!ktpRef.current || !selfieRef.current) return;
    setHint(null);
    setPhase("submitting");
    // The hash is computed here from local bytes; the request carries ONLY it.
    const hash = demoIdentityHash(
      wallet,
      await readBytes(ktpRef.current),
      await readBytes(selfieRef.current),
    );
    setPhase("checking");
    const startedAt = Date.now();
    for (;;) {
      try {
        await api.verificationPost(hash);
      } catch {
        setHint(locale.verify.retryHint); // the trigger naps — the app does not dead-end
      }
      let done = false;
      try {
        const status = await api.verificationGet();
        done = status.identityBound && status.dripped;
      } catch {
        setHint(locale.verify.retryHint);
      }
      if (done) {
        setPhase("ready");
        return;
      }
      if (Date.now() - startedAt > VERIFY_DEADLINE_MS) {
        setPhase("stalled"); // the answer is owed NOW — retry re-reads the truth
        return;
      }
      await sleep(POLL_MS);
    }
  }

  const busy = phase === "submitting" || phase === "checking";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6">
      <div className="text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{locale.verify.title}</h1>
        <span className="mt-2 inline-block rounded-full border border-gold100 bg-goldsoft px-3 py-1 text-xs font-bold text-golddk">
          {locale.verify.demoBadge}
        </span>
      </div>
      <p className="text-center text-sm text-muted">{locale.verify.note}</p>
      {(
        [
          [locale.verify.ktpLabel, "ktp"],
          [locale.verify.selfieLabel, "selfie"],
        ] as const
      ).map(([label, slot]) => (
        <label key={slot} className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink2">{label}</span>
          <input
            type="file"
            accept="image/*"
            capture="user"
            disabled={busy}
            onChange={(e) => grab(e.currentTarget, slot)}
            className="rounded-xl border border-line2 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-leafsoft file:px-3 file:py-1 file:font-semibold file:text-leafdk"
          />
        </label>
      ))}
      {captured > 0 ? (
        <p className="text-center text-xs font-semibold text-leafdk">
          {locale.verify.captured} ({captured}/2)
        </p>
      ) : null}
      {phase === "ready" ? (
        <>
          <p className="text-center text-lg font-bold text-leafdk">{locale.verify.ready}</p>
          <button
            type="button"
            onClick={props.onReady}
            className="rounded-xl bg-leaf px-6 py-4 text-lg font-semibold text-white shadow"
          >
            {locale.common.continue}
          </button>
        </>
      ) : phase === "stalled" ? (
        <>
          <p className="text-center text-sm text-muted">{locale.verify.stalled}</p>
          <button
            type="button"
            onClick={() => void run()}
            className="rounded-xl bg-leaf px-6 py-4 text-lg font-semibold text-white shadow"
          >
            {locale.common.retry}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || captured < 2}
            className="rounded-xl bg-leaf px-6 py-4 text-lg font-semibold text-white shadow disabled:opacity-50"
          >
            {phase === "submitting"
              ? locale.verify.submitting
              : phase === "checking"
                ? locale.verify.checking
                : locale.verify.submit}
          </button>
          {phase === "checking" || hint ? (
            <p className="text-center text-sm text-muted">{hint ?? locale.verify.checking}</p>
          ) : null}
        </>
      )}
    </main>
  );
}
