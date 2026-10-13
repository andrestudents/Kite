// T016 — Dukung Baru (FR-007/FR-008): exactly three steps + one confirmation.
// (1) who — receive-code link/QR or manual entry → the public profile loads
// and the open request must exist; (2) the amount (the request's own
// principal — the permit never exceeds what the deal needs) + the purpose;
// (3) the one-paragraph agreement in plain Bahasa; then ONE passkey
// confirmation signs the ERC-2612 permit over the AUSD domain and submits
// `activate_with_permit` — gaslessly, the backer is never asked for a fee
// balance and never sees crypto vocabulary. FR-008's live check runs at
// step-2 entry, step-3 entry, AND immediately before the signature — over
// limit is inline Bahasa with the current limit stated, never a
// submitted-then-failed state. The confirm button latches after the first
// tap; the deterministic clientRef makes a retry safe. No wire imports —
// data/ only.
import { useCallback, useEffect, useState } from "react";
import type { StorageLike } from "../../auth/session.js";
import type { AccountSession } from "../../auth/types.js";
import { profileFromDto } from "../../data/assemble.js";
import { derivedLabel, saveBackedRecord } from "../../data/backed.js";
import type { ApiClient } from "../../data/bootstrap.js";
import { type ChainReader, chainReader, parseBackerInput } from "../../data/draft.js";
import type { ActivationWire, CheckResult, PermitSigner } from "../../data/dukung.js";
import {
  buildActivationWire,
  DEFAULTS,
  makeDefaultPermitSigner,
  PERMIT_TTL_SEC,
  permitDomain,
  pollActive,
  runLiveCheck,
} from "../../data/dukung.js";
import { formatAusdDetail, type MoneyLocale } from "../../lib/money.js";
import type { Locale } from "../../locales/id.js";
import { pctLabel } from "../beranda/Ajukan.js";
import { Mark } from "../shell/Mark.js";

type Step = "who" | "amount" | "agree" | "signing" | "activating" | "done";

export function DukungBaru(props: {
  locale: Locale;
  lang?: MoneyLocale;
  session: AccountSession;
  api: ApiClient;
  storage: StorageLike;
  /** test seams — the real screen uses the module reader/signer/client */
  reader?: ChainReader;
  signer?: PermitSigner;
  postActivation?: (body: ActivationWire) => Promise<{ jobId: string; clientRef: string }>;
  /** the share link's context — the seeker + their purpose, when present */
  initialSeeker?: string;
  initialPurpose?: string;
  onDone(): void;
  onCancel(): void;
}) {
  const { locale, session, api, storage } = props;
  const lang: MoneyLocale = props.lang ?? "id";
  const reader = props.reader ?? chainReader;
  const [step, setStep] = useState<Step>("who");
  const [seekerRaw, setSeekerRaw] = useState(props.initialSeeker ?? "");
  const [isaId, setIsaId] = useState<number | null>(null);
  const [principal, setPrincipal] = useState<bigint | null>(null);
  const [capAusd, setCapAusd] = useState<bigint | null>(null);
  const [shareBps, setShareBps] = useState(0);
  const [seeker, setSeeker] = useState("");
  const [purpose, setPurpose] = useState(props.initialPurpose ?? "");
  const [nickname, setNickname] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [whoError, setWhoError] = useState(false);
  const [latched, setLatched] = useState(false);
  const [actFailed, setActFailed] = useState(false);

  /** The live check RESOLVES on every path within CHECK_TIMEOUT_MS — ok,
   *  over-limit, not-draftable, or the honest `error` verdict with a retry.
   *  A check that never resolves (or never dispatches) is the bug class this
   *  was rebuilt against: "Memeriksa…" must always be a moment, never a
   *  destination. */
  const liveCheck = useCallback(async (): Promise<CheckResult | null> => {
    if (isaId === null || principal === null) return null;
    setCheck(null);
    const result = await runLiveCheck(reader, isaId, principal);
    setCheck(result);
    return result;
  }, [reader, isaId, principal]);

  // FR-008, checkpoint 1 — step-2 ENTRY dispatches the check. The dispatch
  // is unconditional: the step's continue button reads `check` to decide
  // whether it may advance, so a check that only that button could start is
  // a deadlock (button disabled ⇒ no read ⇒ "Memeriksa…" forever). Re-entering
  // the step (a bounce from the confirmation) re-checks live — never cached.
  useEffect(() => {
    if (step !== "amount") return;
    void liveCheck();
  }, [step, liveCheck]);

  /** Step 1 → 2: the profile must carry an open (Drafted) request. */
  async function openSeeker(): Promise<void> {
    const who = parseBackerInput(seekerRaw);
    if (who === null) return;
    setWhoError(false);
    try {
      const dto = await api.profile(who);
      const model = profileFromDto(dto, Date.now());
      const request = model.openRequest;
      if (request === null) {
        setWhoError(true);
        return;
      }
      setSeeker(request.seeker);
      setIsaId(request.isaId);
      setPrincipal(request.principalAusd);
      setCapAusd(request.capAusd);
      setShareBps(request.shareBps);
      if (purpose.trim() === "") setPurpose(props.initialPurpose ?? "");
      setNickname(derivedLabel(request.seeker, props.initialPurpose));
      setStep("amount");
    } catch {
      setWhoError(true);
    }
  }

  async function confirm(): Promise<void> {
    if (latched || isaId === null || principal === null) return;
    setLatched(true); // the button never fires twice — retry rides the clientRef
    try {
      // FR-008, checkpoint 3: immediately before any signature. A real chain
      // verdict (over-limit / not-draftable) bounces with its inline reason;
      // a FAILED READ never blocks the submission — the client check is UX
      // sugar and the contract + the relayer's 409s are the enforcement.
      const final = await liveCheck();
      if (final !== null && (final.state === "over-limit" || final.state === "not-draftable")) {
        setLatched(false);
        setStep("amount");
        return;
      }
      setStep("signing");
      const signer = props.signer ?? makeDefaultPermitSigner(session, DEFAULTS.chainId);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_TTL_SEC);
      const nonce = await reader.ausdNonces(session.address);
      const sig = await signer.sign(permitDomain(DEFAULTS.ausd, DEFAULTS.chainId), {
        owner: session.address,
        spender: DEFAULTS.core,
        value: principal,
        nonce,
        deadline,
      });
      const wire = buildActivationWire(isaId, deadline, sig);
      setStep("activating");
      const post = props.postActivation ?? ((body: ActivationWire) => api.postJob(body));
      await post(wire);
      // The receipt proves the QUEUE took the job; the CHAIN proves the deal.
      const active = await pollActive(reader, isaId, 30_000);
      if (!active) {
        setLatched(false);
        setActFailed(true);
        setStep("agree");
        return;
      }
      saveBackedRecord(storage, {
        seeker,
        isaId,
        nickname: nickname.trim().slice(0, 40) || undefined,
        purpose: purpose.trim() || undefined,
        activatedAt: Date.now(),
      });
      setStep("done");
    } catch {
      setLatched(false);
      setActFailed(true);
      setStep("agree");
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <Mark variant="gold" className="h-14 w-12" />
        <p className="text-2xl font-extrabold tracking-tight text-ink">{locale.dukung.doneTitle}</p>
        <p className="text-muted">{locale.dukung.doneBody}</p>
        <button
          type="button"
          onClick={props.onDone}
          className="rounded-xl bg-leaf px-6 py-3 font-semibold text-white shadow"
        >
          {locale.common.continue}
        </button>
      </main>
    );
  }

  if (step === "who") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          {locale.dukung.step1Title}
        </h1>
        <label className="flex flex-col gap-1 text-sm text-muted" htmlFor="dukung-who">
          {locale.kirim.recipientLabel}
          <input
            id="dukung-who"
            value={seekerRaw}
            onChange={(e) => setSeekerRaw(e.target.value)}
            className="w-full rounded-xl border border-line2 bg-white px-3 py-2 text-base text-ink focus:border-leaf focus:outline-none"
          />
          <span className="text-xs text-muted">{locale.kirim.recipientCode}</span>
          {whoError ? (
            <span className="text-xs font-medium text-clay">{locale.dukung.notDraftable}</span>
          ) : null}
        </label>
        <button
          type="button"
          disabled={parseBackerInput(seekerRaw) === null}
          onClick={() => void openSeeker()}
          className="rounded-xl bg-leaf px-6 py-4 text-lg font-semibold text-white shadow disabled:bg-[#C6D2C3]"
        >
          {locale.common.continue}
        </button>
        <button type="button" onClick={props.onCancel} className="text-sm text-muted">
          {locale.edge.back}
        </button>
      </main>
    );
  }

  if (step === "amount") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          {locale.dukung.step2Title}
        </h1>
        <p className="text-sm text-muted">{derivedLabel(seeker, purpose)}</p>
        <section className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">{locale.dukung.amountLabel}</span>
            <span className="text-2xl font-extrabold tracking-tight text-ink">
              {principal !== null ? formatAusdDetail(principal, lang) : ""}
            </span>
          </div>
          {purpose.trim() !== "" ? (
            <p className="mt-2 text-sm text-muted">
              {locale.dealCard.purposeLabel}: {purpose}
            </p>
          ) : null}
        </section>
        {check !== null && check.state === "over-limit" ? (
          <p className="text-sm font-medium text-clay">
            {locale.dukung.overLimitPrefix}: {formatAusdDetail(check.offerAusd, lang)}
          </p>
        ) : null}
        {check !== null && check.state === "not-draftable" ? (
          <p className="text-sm font-medium text-clay">{locale.dukung.notDraftable}</p>
        ) : null}
        {check !== null && check.state === "error" ? (
          <>
            <p className="text-sm font-medium text-clay">{locale.dukung.checkError}</p>
            <button
              type="button"
              onClick={() => void liveCheck()}
              className="rounded-xl border border-line2 bg-white px-4 py-2 text-sm font-semibold text-ink"
            >
              {locale.common.retry}
            </button>
          </>
        ) : null}
        {check === null ? <p className="text-sm text-muted">{locale.dukung.checking}</p> : null}
        <button
          type="button"
          disabled={check?.state !== "ok"}
          onClick={() => {
            void (async () => {
              // FR-008, checkpoint 2: entering the agreement step re-checks.
              const result = await liveCheck();
              if (result?.state === "ok") setStep("agree");
            })();
          }}
          className="rounded-xl bg-leaf px-6 py-4 text-lg font-semibold text-white shadow disabled:bg-[#C6D2C3]"
        >
          {locale.common.continue}
        </button>
        <button type="button" onClick={props.onCancel} className="text-sm text-muted">
          {locale.edge.back}
        </button>
      </main>
    );
  }

  // step === "agree" | "signing" | "activating"
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">
        {locale.dukung.step3Title}
      </h1>
      <section className="rounded-2xl border border-line bg-white p-4 text-sm text-muted">
        <div className="flex items-baseline justify-between">
          <span>{locale.dealCard.shareLabel}</span>
          <span className="font-semibold text-ink">{pctLabel(shareBps, lang)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span>{locale.dealCard.capLabel}</span>
          <span className="font-semibold text-ink">
            {capAusd !== null ? formatAusdDetail(capAusd, lang) : ""}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span>{locale.dukung.amountLabel}</span>
          <span className="font-semibold text-ink">
            {principal !== null ? formatAusdDetail(principal, lang) : ""}
          </span>
        </div>
        <p className="mt-2">
          {locale.dealCard.endLabel} {locale.dealCard.endByCap}
        </p>
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-leafsoft px-3 py-2.5 text-xs font-bold text-leafdk">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-leaf" />
          {locale.dealCard.failedHarvest}
        </p>
        {actFailed ? (
          <p className="mt-2 text-sm font-semibold text-clay">{locale.dukung.activationFailed}</p>
        ) : null}
        {purpose.trim() !== "" ? (
          <p className="mt-2">
            {locale.dealCard.purposeLabel}: {purpose}
          </p>
        ) : null}
      </section>
      <label className="flex flex-col gap-1 text-sm text-muted" htmlFor="dukung-nickname">
        {locale.dukung.nicknameLabel}
        <input
          id="dukung-nickname"
          value={nickname}
          maxLength={40}
          onChange={(e) => setNickname(e.target.value)}
          className="w-full rounded-xl border border-line2 bg-white px-3 py-2 text-base text-ink focus:border-leaf focus:outline-none"
        />
      </label>
      <button
        type="button"
        disabled={latched}
        onClick={() => void confirm()}
        className="rounded-xl bg-leaf px-6 py-4 text-lg font-semibold text-white shadow disabled:bg-[#C6D2C3]"
      >
        {step === "signing"
          ? locale.dukung.signCta
          : step === "activating"
            ? locale.dukung.activating
            : locale.dukung.confirmCta}
      </button>
      <button type="button" onClick={props.onCancel} className="text-sm text-muted">
        {locale.edge.back}
      </button>
    </main>
  );
}
