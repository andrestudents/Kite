// T031 — ReceiveCode: THIS account's receive code, rendered as a QR over the
// PUBLIC profile URL only. No key material ever enters the payload — the
// profile id resolves to the wallet on the reader's side, keylessly. Cached
// device-side (T015's cache), regenerated silently when absent.
import { useEffect, useState } from "react";
import type { StorageLike } from "../../auth/session.js";
import { makeDefaultQrPort, type QRPort, receiveCodeDataUrl } from "../../data/qr.js";
import type { Locale } from "../../locales/id.js";

export function ReceiveCode(props: {
  locale: Locale;
  storage: StorageLike;
  profileId: string;
  origin?: string;
  qr?: QRPort;
}) {
  const { locale, profileId } = props;
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const qr = props.qr ?? (await makeDefaultQrPort());
        const origin =
          props.origin ?? (typeof window === "undefined" ? "" : window.location.origin);
        const url = await receiveCodeDataUrl(props.storage, qr, origin, profileId);
        if (alive) setDataUrl(url);
      } catch {
        if (alive) setDataUrl(null); // no QR image — never a hex fallback in prose
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.storage, props.qr, props.origin, profileId]);
  if (dataUrl === null) return null;
  return (
    <section className="rounded-2xl border border-slate-200 p-5 text-center">
      <p className="text-sm font-semibold text-slate-700">{locale.profile.qrTitle}</p>
      <img src={dataUrl} alt={locale.profile.qrTitle} className="mx-auto mt-3 h-44 w-44" />
      <p className="mt-2 text-xs text-slate-500">{locale.profile.qrHint}</p>
    </section>
  );
}
