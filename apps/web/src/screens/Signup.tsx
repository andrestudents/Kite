// T016 — Signup (FR-001): ONE biometric approval, the account derives
// silently — the user is NEVER shown key material. Screens depend only on the
// AuthAdapter seam (FR-012), never on @category-labs/mera directly.
import { useState } from "react";
import type { Locale } from "../locales/id.js";
import type { AccountSession, AuthAdapter, CredentialRef, RpConfig } from "../auth/types.js";

export function Signup(props: {
  locale: Locale;
  rp: RpConfig;
  adapter: AuthAdapter;
  /** Shown after a failed fast-path / a 401 — plain language, no blame. */
  banner?: string;
  disabled?: boolean;
  onAccount(result: { session: AccountSession; credential: CredentialRef }): void;
}) {
  const { locale, rp, adapter, banner, disabled } = props;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signUp(): Promise<void> {
    setError(null);
    setWorking(true);
    try {
      // No PII in the passkey user identity — an opaque id + the app name.
      const name = `kite-${crypto.randomUUID()}`;
      const result = await adapter.createAccount(rp, { name, displayName: locale.appName });
      props.onAccount(result);
    } catch (err) {
      const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      if (/PRF_UNAVAILABLE/i.test(text)) {
        setError(locale.signup.prfUnavailable);
      } else if (/NotAllowedError/i.test(text)) {
        setError(locale.signup.cancelled);
      } else {
        setError(locale.common.errorGeneric);
      }
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-3xl font-bold text-teal-700">{locale.signup.title}</h1>
        <p className="mt-2 text-slate-600">{locale.signup.subtitle}</p>
      </div>
      {banner ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{banner}</p> : null}
      <button
        type="button"
        onClick={() => void signUp()}
        disabled={working || disabled === true}
        className="rounded-xl bg-teal-600 px-6 py-4 text-lg font-semibold text-white shadow disabled:opacity-50"
      >
        {working ? locale.signup.working : locale.signup.cta}
      </button>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </main>
  );
}
