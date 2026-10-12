// T026 — the desktop companion (US4, FR-013). A fine-pointer device never
// attempts the biometric ceremony: the onboarding routes render this honest
// hand-off instead — a 390×844 phone frame holding a QR of the CURRENT page
// URL (client-side, static address only — no session proof or key material is
// ever encoded) so the flow continues on the phone it belongs to.

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { Locale } from "../locales/id.js";

export type OnboardingStep = "signup" | "phone" | "verify";

/** Phones/tablets are coarse pointers; the ceremony lives there (FR-013). */
export function isCoarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

/** The static hand-off address — origin + path + query, nothing else. */
export function handoffUrl(loc: { origin: string; pathname: string; search: string }): string {
  return `${loc.origin}${loc.pathname}${loc.search}`;
}

function stepLabel(locale: Locale, step: OnboardingStep): string {
  if (step === "signup") return locale.desktop.stepSignup;
  if (step === "phone") return locale.desktop.stepPhone;
  return locale.desktop.stepVerify;
}

export function DesktopHandoff({ locale, step }: { locale: Locale; step?: OnboardingStep }) {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    const target = handoffUrl(window.location);
    setUrl(target);
    let alive = true;
    QRCode.toDataURL(target, { width: 220, margin: 1 })
      .then((data) => {
        if (alive) setQr(data);
      })
      .catch(() => {
        if (alive) setQr(null); // no QR → the typed address below still works
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-6">
      <section className="flex h-[844px] w-[390px] flex-col items-center justify-center gap-3 rounded-[2rem] border-8 border-slate-800 bg-white p-6 text-center shadow-xl">
        <p className="text-lg font-semibold text-slate-800">{locale.desktop.title}</p>
        <p className="text-sm text-slate-500">{locale.desktop.body}</p>
        {step !== undefined ? (
          <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {stepLabel(locale, step)}
          </p>
        ) : null}
        {qr !== null ? (
          <img
            src={qr}
            alt={locale.desktop.title}
            className="mt-2 rounded-lg border border-slate-200"
          />
        ) : (
          <div className="mt-2 h-[220px] w-[220px] animate-pulse rounded-lg bg-slate-200" />
        )}
        <p className="mt-2 text-xs text-slate-500">{locale.desktop.addressNote}</p>
        <p className="break-all font-mono text-xs text-slate-600">{url}</p>
      </section>
    </main>
  );
}
