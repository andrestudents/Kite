// The onboarding state machine (T016–T019, FR-016): entering → signup →
// phone → verify → home, with the credential-pinned fast path short-circuiting
// straight to home (T017). The 401 hook (FR-010) lands back on signup with
// plain language — never an opaque error. All copy comes from the catalogs.
// The adapter is resolved per device (T023): a device holding a wrapped demo
// persona signs in through it; everyone else gets the pure Mera adapter.
import { useEffect, useRef, useState } from "react";
import { makeApiClient } from "../api/client.js";
import { makeAdapterForDevice } from "../auth/demo-adapter.js";
import { clearSessionBlob, loadSessionBlob } from "../auth/session.js";
import type { AccountSession, AuthAdapter } from "../auth/types.js";
import { id as locale } from "../locales/id.js";
import { Home } from "../screens/Home.js";
import { Phone } from "../screens/Phone.js";
import { Signup } from "../screens/Signup.js";
import { Verify } from "../screens/Verify.js";
import { enterApp, establishSession, savePinnedCredential } from "./entry.js";

/** The rpId IS the production hostname — ceremonies are permanently bound to
 *  it (T004), so the app derives it from wherever it is actually served. */
const RP_ID = window.location.hostname;
const RP = { id: RP_ID, name: locale.appName };
const API_URL = import.meta.env.VITE_API_URL ?? "";

const nowSec = () => Math.floor(Date.now() / 1000);

type Route = "entering" | "signup" | "phone" | "verify" | "home";

export function App() {
  const [route, setRoute] = useState<Route>("entering");
  const [banner, setBanner] = useState<string | undefined>(undefined);
  const [wallet, setWallet] = useState<string>("");
  const [adapter, setAdapter] = useState<AuthAdapter | null>(null);
  const liveSession = useRef<AccountSession | null>(null);
  const api = useRef(makeApiClient({ baseUrl: API_URL, onUnauthorized }));

  /** FR-010: any 401 routes to sign-in — never an opaque error. */
  function onUnauthorized(): void {
    liveSession.current?.end();
    liveSession.current = null;
    clearSessionBlob(localStorage);
    setWallet("");
    setBanner(locale.session.expired);
    setRoute("signup");
  }

  useEffect(() => {
    void (async () => {
      const deviceAdapter = await makeAdapterForDevice();
      setAdapter(deviceAdapter);
      const result = await enterApp({
        storage: localStorage,
        adapter: deviceAdapter,
        rpId: RP_ID,
        nowSec: nowSec(),
      });
      if (result.route === "home") {
        if (result.session) liveSession.current = result.session;
        if (result.wallet) setWallet(result.wallet);
        setRoute("home");
      } else {
        setBanner(result.reason === "signin-failed" ? locale.session.expired : undefined);
        setRoute("signup");
      }
    })();
  }, []);

  async function onAccount(result: {
    session: AccountSession;
    credential: { credentialId: string; transports?: string[] };
  }): Promise<void> {
    savePinnedCredential(localStorage, result.credential);
    const blob = await establishSession(localStorage, result.session, nowSec());
    liveSession.current = result.session;
    setWallet(blob.wallet);
    setBanner(undefined);
    setRoute("phone");
  }

  function signOut(): void {
    // FR-009: wipe the session proof + end the in-memory key; the DEVICE
    // passkey (and its pin) stays — the next sign-in is one ceremony.
    liveSession.current?.end();
    liveSession.current = null;
    clearSessionBlob(localStorage);
    setWallet("");
    setRoute("signup");
  }

  if (adapter === null || route === "entering") {
    return (
      <main className="flex min-h-dvh items-center justify-center text-slate-500">
        {locale.common.loading}
      </main>
    );
  }
  if (route === "signup") {
    return (
      <Signup
        locale={locale}
        rp={RP}
        adapter={adapter}
        banner={banner}
        onAccount={(r) => void onAccount(r)}
      />
    );
  }
  if (route === "phone") {
    return <Phone locale={locale} onDone={() => setRoute("verify")} />;
  }
  if (route === "verify") {
    // The wallet comes from the just-established blob — the proof is bound to it.
    const walletNow = wallet || loadSessionBlob(localStorage)?.wallet || "";
    return (
      <Verify
        locale={locale}
        api={api.current}
        wallet={walletNow}
        onReady={() => setRoute("home")}
      />
    );
  }
  return (
    <Home
      locale={locale}
      api={api.current}
      onSignOut={signOut}
      onNeedVerification={() => setRoute("verify")}
    />
  );
}
