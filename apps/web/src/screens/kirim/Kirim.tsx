// T031 — Kirim (FR-016): gasless phone-to-phone. The recipient comes from a
// receive-code (profile URL) or manual entry; the amount is checked against
// the LIVE balance INLINE — before any signature prompt ("Saldo tidak
// cukup" with the real number, nothing queued). ONE passkey approval signs
// the EIP-3009 authorization; the job goes to the relayer as decimal
// strings; "Lunas" is shown ONLY after the balance read-back confirms the
// delta on-chain. Offline blocks everything with a plain message. The send
// lands in the device's sentRecords. The ORDER lives in data/kirim's
// sendKirim — this screen only projects phases and copy.
import { useEffect, useState } from "react";
import type { StorageLike } from "../../auth/session.js";
import type { AccountSession } from "../../auth/types.js";
import type { ApiClient } from "../../data/bootstrap.js";
import type { ChainReader } from "../../data/draft.js";
import { DEFAULTS as DUKUNG_DEFAULTS, type PermitDomain, permitDomain } from "../../data/dukung.js";
import type { SendOutcome, TransferSigner } from "../../data/kirim.js";
import { freshNonce, kirimReader, makeDefaultTransferSigner, sendKirim } from "../../data/kirim.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { ReceiveCode } from "./ReceiveCode.js";

function failureCopy(outcome: Extract<SendOutcome, { ok: false }>, locale: Locale): string {
  switch (outcome.reason) {
    case "invalid-recipient":
    case "unresolved":
      return locale.kirim.invalidAddress;
    case "invalid-amount":
      return locale.kirim.invalidAddress;
    case "insufficient":
      return locale.kirim.saldoShort;
    case "unconfirmed":
      return locale.kirim.submitted;
    default:
      return locale.common.errorGeneric;
  }
}

export function Kirim(props: {
  locale: Locale;
  lang?: MoneyLocale;
  api: ApiClient;
  session: AccountSession;
  storage: StorageLike;
  /** THIS account's own profile id — the receive code's QR payload. */
  profileId: string;
  /** test seams — the real screen uses the module reader/signer */
  reader?: ChainReader;
  signer?: TransferSigner;
  origin?: string;
  onBack?(): void;
}) {
  const { locale, api, session, storage, profileId } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const reader = props.reader ?? kirimReader;
  const [recipientRaw, setRecipientRaw] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [insufficient, setInsufficient] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<"signing" | "submitting" | "confirming" | null>(null);
  const [doneValue, setDoneValue] = useState<bigint | null>(null);
  const [failed, setFailed] = useState("");
  const [offline, setOffline] = useState(false);
  const domain: PermitDomain = permitDomain(DUKUNG_DEFAULTS.ausd, DUKUNG_DEFAULTS.chainId);

  // Offline blocks the action outright — nothing queues (FR-016).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      setOffline(window.navigator.onLine === false);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function send(): Promise<void> {
    if (offline || busy !== null) return;
    setFailed("");
    setInsufficient(null);
    setBusy("signing");
    const outcome = await sendKirim(
      {
        api,
        reader,
        signer: props.signer ?? makeDefaultTransferSigner(session, DUKUNG_DEFAULTS.chainId),
        storage,
        from: session.address,
        nowSec: () => Math.floor(Date.now() / 1_000),
        nonce: freshNonce,
      },
      domain,
      recipientRaw,
      amountRaw,
    );
    setBusy(null);
    if (outcome.ok) {
      setDoneValue(outcome.valueAusd);
      return;
    }
    if (outcome.reason === "insufficient" && outcome.balanceAusd !== undefined) {
      setInsufficient(outcome.balanceAusd);
    }
    if (outcome.reason === "unconfirmed") setBusy("confirming");
    setFailed(failureCopy(outcome, locale));
  }

  if (doneValue !== null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-4xl font-extrabold tracking-tight text-leafdk">{locale.kirim.lunas}</p>
        <p className="text-sm text-muted">{formatAusdDetail(doneValue, lang)}</p>
        {props.onBack ? (
          <button
            type="button"
            onClick={props.onBack}
            className="rounded-xl bg-leaf px-6 py-3 font-semibold text-white shadow"
          >
            {locale.edge.back}
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
      <h1 className="text-xl font-extrabold tracking-tight text-ink">{locale.kirim.title}</h1>

      {offline ? (
        <section className="rounded-2xl border border-warnline bg-warnsoft p-4 text-sm text-golddk">
          <p className="font-bold text-ink">{locale.edge.offlineTitle}</p>
          <p className="mt-1">{locale.edge.offlineBody}</p>
        </section>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{locale.kirim.recipientLabel}</span>
        <input
          type="text"
          value={recipientRaw}
          onChange={(e) => setRecipientRaw(e.target.value)}
          placeholder={locale.kirim.recipientCode}
          className="rounded-xl border border-line2 bg-white px-4 py-3 text-base text-ink focus:border-leaf focus:outline-none"
        />
        <span className="text-xs text-muted">{locale.kirim.recipientManual}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{locale.kirim.amountLabel}</span>
        <input
          type="text"
          inputMode="decimal"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value)}
          className="rounded-xl border border-line2 bg-white px-4 py-3 text-base text-ink focus:border-leaf focus:outline-none"
        />
      </label>

      {insufficient !== null ? (
        <p className="text-sm font-medium text-clay">
          {locale.kirim.saldoShort} ({formatAusdDetail(insufficient, lang)})
        </p>
      ) : null}
      {failed !== "" ? <p className="text-sm font-medium text-clay">{failed}</p> : null}

      <button
        type="button"
        disabled={offline || busy !== null}
        onClick={() => void send()}
        className="mt-2 w-full rounded-xl bg-leaf px-6 py-4 text-lg font-semibold text-white shadow disabled:opacity-40"
      >
        {busy === null ? locale.kirim.confirmCta : locale.dukung.checking}
      </button>

      {busy === "confirming" ? (
        <p className="text-center text-sm text-muted">{locale.kirim.submitted}</p>
      ) : null}

      <ReceiveCode locale={locale} storage={storage} profileId={profileId} origin={props.origin} />

      {props.onBack ? (
        <button type="button" onClick={props.onBack} className="text-sm text-muted">
          {locale.edge.back}
        </button>
      ) : null}
    </main>
  );
}
