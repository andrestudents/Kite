// T016 — Signup (FR-001): ONE biometric approval, the account derives
// silently — the user is NEVER shown key material. Screens depend only on the
// AuthAdapter seam (FR-012), never on @category-labs/mera directly.
// The secondary Masuk action runs the manual sign-in path (signInExisting):
// for demo-prepped devices (a persona vault, no pinned credential) and
// wiped-pin devices the fast path cannot serve — never a new account.
import { useState } from "react";
import type { AccountSession, AuthAdapter, CredentialRef, RpConfig } from "../auth/types.js";
import type { Locale } from "../locales/id.js";

export function Signup(props: {
  locale: Locale;
  rp: RpConfig;
  adapter: AuthAdapter;
  /** Shown after a failed fast-path / a 401 — plain language, no blame. */
  banner?: string;
  disabled?: boolean;
  onAccount(result: { session: AccountSession; credential: CredentialRef }): void;
  /** Manual sign-in (Masuk): adapter.signIn → establishSession → Home. */
  onSignIn?: () => Promise<void>;
}) {
  const { locale, rp, adapter, banner, disabled } = props;
  const [working, setWorking] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** One mapper for every ceremony failure — plain language, no blame. */
  function ceremonyError(err: unknown): string {
    const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    if (/PRF_UNAVAILABLE/i.test(text)) return locale.signup.prfUnavailable;
    if (/NotAllowedError/i.test(text)) return locale.signup.cancelled;
    return locale.common.errorGeneric;
  }

  async function signUp(): Promise<void> {
    setError(null);
    setWorking(true);
    try {
      // No PII in the passkey user identity — an opaque id + the app name.
      const name = `kite-${crypto.randomUUID()}`;
      const result = await adapter.createAccount(rp, { name, displayName: locale.appName });
      props.onAccount(result);
    } catch (err) {
      setError(ceremonyError(err));
    } finally {
      setWorking(false);
    }
  }

  async function signIn(): Promise<void> {
    if (!props.onSignIn) return;
    setError(null);
    setSigningIn(true);
    try {
      await props.onSignIn();
    } catch (err) {
      setError(ceremonyError(err));
    } finally {
      setSigningIn(false);
    }
  }

  const busy = working || signingIn || disabled === true;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-3xl font-bold text-teal-700">{locale.signup.title}</h1>
        <p className="mt-2 text-slate-600">{locale.signup.subtitle}</p>
      </div>
      {banner ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{banner}</p>
      ) : null}
      <button
        type="button"
        onClick={() => void signUp()}
        disabled={busy}
        className="rounded-xl bg-teal-600 px-6 py-4 text-lg font-semibold text-white shadow disabled:opacity-50"
      >
        {working ? locale.signup.working : locale.signup.cta}
      </button>
      {props.onSignIn ? (
        <button
          type="button"
          onClick={() => void signIn()}
          disabled={busy}
          className="-mt-3 rounded-xl border border-teal-600 px-6 py-3 text-base font-semibold text-teal-700 disabled:opacity-50"
        >
          {signingIn ? locale.signup.signingIn : locale.session.signIn}
        </button>
      ) : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </main>
  );
}
