// The app shell (T036–T038): the onboarding state machine (T016–T019,
// FR-016) flows into a four-tab shell — Beranda · Dukung · Kirim · Riwayat
// (FR-001) — and the shell answers two public paths directly: /mitra (the
// operator console, desktop-first, the MITA demo key read by NAME — never
// the INTERNAL key) and /p/:id deep links (no session). The watcher (T020)
// rides the session: a seeker split fills the full-screen moment (T021),
// quiet moments land as toasts (T022). Offline wraps the shell in T009's
// read-only stale-labeled state; the toggle cycles id ⇄ ms ⇄ en in place —
// in-flow state survives (FR-002).
import { useCallback, useEffect, useRef, useState } from "react";
import { makeAdapterForDevice } from "../auth/demo-adapter.js";
import { clearSessionBlob, loadSessionBlob } from "../auth/session.js";
import type { AccountSession, AuthAdapter } from "../auth/types.js";
import { momentFromProfile } from "../data/assemble.js";
import { makeApiClient, resolveApiBase } from "../data/bootstrap.js";
import { chainReader, type HexAddress } from "../data/draft.js";
import { type MitraPurchaseRow, makeMitraClient } from "../data/mitra.js";
import type { MomentModel } from "../data/models.js";
import type { MoneyLocale } from "../lib/money.js";
import { en } from "../locales/en.js";
import { id as idLocale, type Locale } from "../locales/id.js";
import { ms } from "../locales/ms.js";
import { Ajukan } from "../screens/beranda/Ajukan.js";
import { DesktopHandoff, isCoarsePointer, type OnboardingStep } from "../screens/DesktopFrame.js";
import { BagiHasilDetail } from "../screens/detail/BagiHasilDetail.js";
import { BackedList } from "../screens/dukung/BackedList.js";
import { DukungBaru } from "../screens/dukung/DukungBaru.js";
import { Home } from "../screens/Home.js";
import { Kirim } from "../screens/kirim/Kirim.js";
import { Bayar } from "../screens/mitra/Bayar.js";
import { Console } from "../screens/mitra/Console.js";
import { type Quote, SplitMoment } from "../screens/moments/SplitMoment.js";
import { type Toast, ToastStack, watchEventToasts } from "../screens/moments/toasts.js";
import { Phone } from "../screens/Phone.js";
import { PublicProfile } from "../screens/profile/PublicProfile.js";
import { Riwayat } from "../screens/riwayat/Riwayat.js";
import { Signup } from "../screens/Signup.js";
import { OfflineState } from "../screens/shell/EdgeStates.js";
import { PhoneFrame } from "../screens/shell/PhoneFrame.js";
import { TabBar, type TabId } from "../screens/shell/TabBar.js";
import { Verify } from "../screens/Verify.js";
import { startWatcher, type WatchEvent } from "../watcher/watcher.js";
import { enterApp, establishSession, savePinnedCredential, signInExisting } from "./entry.js";
import { LANG_KEY, loadLang, nextLang, parseAppPath } from "./shell.js";

/** The rpId IS the production hostname — ceremonies are permanently bound to
 *  it (T004), so the app derives it from wherever it is actually served. */
const RP_ID = window.location.hostname;
const RP = { id: RP_ID, name: idLocale.appName };
/** Relative /api/* in production (same-origin rewrite); an absolute base —
 *  a local .env, a stale dashboard var — is honored in dev builds ONLY. */
const API_URL = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.DEV);
const ORIGIN = window.location.origin;
/** The MITA DEMO key by NAME (research D8): operator env only, never the
 *  INTERNAL key, never logged, never echoed. Empty = honest registry 401s. */
const MITA_KEY = import.meta.env.VITE_MITA_KEY ?? "";

const CATALOGS: Record<MoneyLocale, Locale> = { id: idLocale, ms, en };

const nowSec = () => Math.floor(Date.now() / 1000);

type Route = "entering" | "signup" | "phone" | "verify" | "home";
type Overlay =
  | { kind: "ajukan" }
  | { kind: "dukung-new"; seeker?: string; purpose?: string }
  | { kind: "detail"; isaId: number }
  | null;
interface PublicView {
  id: string;
  purpose?: string;
}

/** The share link's purpose rides ?ajukan= — read once at boot. */
function bootPublicView(): PublicView | null {
  const parsed = parseAppPath(window.location.pathname);
  if (parsed.kind !== "profile") return null;
  const purpose = new URLSearchParams(window.location.search).get("ajukan") ?? undefined;
  return { id: parsed.id, purpose };
}

/** The operator console: desktop-first, sessionless, its own error faces. */
function MitraShell(props: {
  row: MitraPurchaseRow | null;
  onRow(row: MitraPurchaseRow | null): void;
}) {
  const client = useRef<ReturnType<typeof makeMitraClient> | null>(null);
  if (client.current === null) client.current = makeMitraClient(API_URL, MITA_KEY);
  if (props.row === null) {
    return <Console locale={idLocale} client={client.current} onBayar={props.onRow} />;
  }
  return (
    <Bayar
      locale={idLocale}
      row={props.row}
      client={client.current}
      onDone={(updated) => props.onRow(updated)}
      onBack={() => props.onRow(null)}
    />
  );
}

export function App() {
  const [route, setRoute] = useState<Route>("entering");
  const [banner, setBanner] = useState<string | undefined>(undefined);
  const [wallet, setWallet] = useState<string>("");
  const [adapter, setAdapter] = useState<AuthAdapter | null>(null);
  // T026: coarse pointer (phone) runs the ceremonies; a desktop renders the
  // honest hand-off for every ceremony surface instead (FR-013, T037).
  const [handoff] = useState<boolean>(() => !isCoarsePointer());
  const [session, setSession] = useState<AccountSession | null>(null);
  const [tab, setTab] = useState<TabId>("beranda");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [lang, setLang] = useState<MoneyLocale>(() => loadLang(localStorage.getItem(LANG_KEY)));
  const [offline, setOffline] = useState<boolean>(() => !navigator.onLine);
  const [lastFetchAt, setLastFetchAt] = useState<number>(() => Date.now());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [moment, setMoment] = useState<MomentModel | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [publicView, setPublicView] = useState<PublicView | null>(bootPublicView);
  const [path] = useState(() => parseAppPath(window.location.pathname));
  const [mitraRow, setMitraRow] = useState<MitraPurchaseRow | null>(null);
  const liveSession = useRef<AccountSession | null>(null);
  const pendingDukung = useRef<PublicView | null>(null);
  const api = useRef(makeApiClient({ baseUrl: API_URL, onUnauthorized }));

  /** FR-010: any 401 routes to sign-in — never an opaque error. */
  function onUnauthorized(): void {
    liveSession.current?.end();
    liveSession.current = null;
    clearSessionBlob(localStorage);
    setSession(null);
    setWallet("");
    setBanner(idLocale.session.expired);
    setRoute("signup");
  }

  /** A completed dukung intent stashed before sign-in opens right after. */
  function applyPendingDukung(): void {
    const p = pendingDukung.current;
    if (p !== null) {
      pendingDukung.current = null;
      setOverlay({ kind: "dukung-new", seeker: p.id, purpose: p.purpose });
    }
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
        if (result.session) {
          liveSession.current = result.session;
          setSession(result.session);
        }
        if (result.wallet) setWallet(result.wallet);
        setRoute("home");
        const p = pendingDukung.current;
        if (p !== null) {
          pendingDukung.current = null;
          setOverlay({ kind: "dukung-new", seeker: p.id, purpose: p.purpose });
        }
      } else {
        setBanner(result.reason === "signin-failed" ? idLocale.session.expired : undefined);
        setRoute("signup");
      }
    })();
  }, []);

  // The quote (FR-003) follows the catalog: rupiah at home, ringgit for ms.
  useEffect(() => {
    if (route !== "home") return;
    const pair = lang === "ms" ? "USD_MYR" : "USD_IDR";
    let alive = true;
    api.current
      .quote(pair)
      .then((q) => {
        if (alive) setQuote({ pair: q.pair, rate: q.rate, scale: q.scale });
      })
      .catch(() => {
        // no quote → the AUSD detail row still speaks for itself
      });
    return () => {
      alive = false;
    };
  }, [route, lang]);

  // FR-020: the shell sees connectivity directly; T009's offline state takes
  // the whole surface read-only with the stale label.
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  /** One watcher event → its moment (FR-009): seeker splits fetch the
   *  settlement's own figures through the seam; backer moments are toasts. */
  const onWatchEvent = useCallback(
    (event: WatchEvent) => {
      setLastFetchAt(Date.now());
      if (event.side === "backer") {
        const toast = watchEventToasts([event])[0];
        if (toast !== undefined) setToasts((prev) => [...prev, toast]);
        return;
      }
      if (event.kind === "split") {
        void (async () => {
          try {
            const dto = await api.current.profile(wallet);
            const m = momentFromProfile(
              dto,
              event.isaId,
              event.progressBeforeBps,
              event.progressAfterBps,
              Date.now(),
            );
            if (m !== null) setMoment(m);
          } catch {
            // the next settlement still brings its moment
          }
        })();
        return;
      }
      setToasts((prev) => [
        ...prev,
        { id: `done-${String(event.isaId)}-${event.variant}`, kind: event.variant },
      ]);
    },
    [wallet],
  );

  useEffect(() => {
    if (route !== "home" || wallet === "") return;
    const handle = startWatcher({
      api: api.current,
      reader: chainReader,
      storage: localStorage,
      backerAddress: wallet as HexAddress,
      onEvent: onWatchEvent,
    });
    return () => handle.stop();
  }, [route, wallet, onWatchEvent]);

  async function onAccount(result: {
    session: AccountSession;
    credential: { credentialId: string; transports?: string[] };
  }): Promise<void> {
    savePinnedCredential(localStorage, result.credential);
    const blob = await establishSession(localStorage, result.session, nowSec());
    liveSession.current = result.session;
    setSession(result.session);
    setWallet(blob.wallet);
    setBanner(undefined);
    setRoute("phone");
  }

  /** The Masuk button: manual sign-in (demo-prepped / wiped-pin devices). */
  async function onSignIn(): Promise<void> {
    if (adapter === null) return;
    const result = await signInExisting({
      storage: localStorage,
      adapter,
      rpId: RP_ID,
      nowSec: nowSec(),
    });
    liveSession.current = result.session;
    setSession(result.session);
    setWallet(result.wallet);
    setBanner(undefined);
    setRoute("home");
    applyPendingDukung();
  }

  function signOut(): void {
    // FR-009: wipe the session proof + end the in-memory key; the DEVICE
    // passkey (and its pin) stays — the next sign-in is one ceremony.
    liveSession.current?.end();
    liveSession.current = null;
    clearSessionBlob(localStorage);
    setSession(null);
    setWallet("");
    setRoute("signup");
  }

  function toggleLang(): void {
    const next = nextLang(lang);
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // storage refused — the toggle still works for this visit
    }
  }

  const locale = CATALOGS[lang];

  if (path.kind === "mitra") {
    return <MitraShell row={mitraRow} onRow={setMitraRow} />;
  }

  if (adapter === null || route === "entering") {
    return (
      <main className="flex min-h-dvh items-center justify-center text-slate-500">
        {locale.common.loading}
      </main>
    );
  }
  // T026/FR-013: on a desktop, every ceremony route is the phone hand-off —
  // no biometric ceremony is ever attempted here.
  if (handoff && route !== "home") {
    return <DesktopHandoff locale={locale} step={route as OnboardingStep} />;
  }
  if (route === "signup") {
    return (
      <Signup
        locale={locale}
        rp={RP}
        adapter={adapter}
        banner={banner}
        onAccount={(r) => void onAccount(r)}
        onSignIn={onSignIn}
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

  // ── the tabbed shell (route "home") ─────────────────────────────────────

  if (session === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-slate-500">
        {locale.common.loading}
      </main>
    );
  }

  const overlayView = (() => {
    if (overlay === null) return null;
    if (overlay.kind === "ajukan") {
      return (
        <PhoneFrame locale={locale}>
          <Ajukan
            locale={locale}
            lang={lang}
            session={session}
            api={api.current}
            storage={localStorage}
            origin={ORIGIN}
            onBack={() => setOverlay(null)}
          />
        </PhoneFrame>
      );
    }
    if (overlay.kind === "dukung-new") {
      return (
        <PhoneFrame locale={locale}>
          <DukungBaru
            locale={locale}
            lang={lang}
            session={session}
            api={api.current}
            storage={localStorage}
            initialSeeker={overlay.seeker}
            initialPurpose={overlay.purpose}
            onDone={() => {
              setOverlay(null);
              setTab("dukung");
            }}
            onCancel={() => setOverlay(null)}
          />
        </PhoneFrame>
      );
    }
    return (
      <BagiHasilDetail
        locale={locale}
        lang={lang}
        api={api.current}
        profileId={wallet}
        isaId={overlay.isaId}
        quote={quote}
        onClose={() => setOverlay(null)}
      />
    );
  })();

  const tabView = (() => {
    if (tab === "beranda") {
      return (
        <Home
          locale={locale}
          lang={lang}
          api={api.current}
          onSignOut={signOut}
          onNeedVerification={() => setRoute("verify")}
          onAjukan={() => setOverlay({ kind: "ajukan" })}
        />
      );
    }
    if (tab === "dukung") {
      return (
        <BackedList
          locale={locale}
          lang={lang}
          storage={localStorage}
          onDukung={(seeker) => setOverlay({ kind: "dukung-new", seeker })}
        />
      );
    }
    if (tab === "kirim") {
      return (
        <PhoneFrame locale={locale}>
          <Kirim
            locale={locale}
            lang={lang}
            api={api.current}
            session={session}
            storage={localStorage}
            profileId={wallet}
            origin={ORIGIN}
            onBack={() => setTab("beranda")}
          />
        </PhoneFrame>
      );
    }
    return (
      <Riwayat
        locale={locale}
        lang={lang}
        api={api.current}
        storage={localStorage}
        wallet={wallet}
        onOpen={(isaId) => setOverlay({ kind: "detail", isaId })}
      />
    );
  })();

  const body =
    publicView !== null && overlay === null ? (
      <PublicProfile
        locale={locale}
        lang={lang}
        api={api.current}
        storage={localStorage}
        profileId={publicView.id}
        ajukan={publicView.purpose}
        origin={ORIGIN}
        onDukung={(seeker) => {
          if (session !== null) {
            setOverlay({ kind: "dukung-new", seeker, purpose: publicView.purpose });
            return;
          }
          pendingDukung.current = { id: seeker, purpose: publicView.purpose };
          setPublicView(null);
          setRoute("signup");
        }}
        onBack={() => setPublicView(null)}
      />
    ) : (
      <>
        <div className="pb-24">{overlayView !== null ? overlayView : tabView}</div>
        <TabBar
          locale={locale}
          active={tab}
          onNavigate={(t) => {
            setOverlay(null);
            setTab(t);
          }}
        />
      </>
    );

  const shell = (
    <>
      {body}
      {moment !== null ? (
        <SplitMoment
          moment={moment}
          locale={locale}
          lang={lang}
          quote={quote}
          onDismiss={() => setMoment(null)}
        />
      ) : null}
      <ToastStack
        toasts={toasts}
        locale={locale}
        lang={lang}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
      <button
        type="button"
        onClick={toggleLang}
        className="fixed top-3 right-3 z-30 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600 shadow"
      >
        {nextLang(lang).toUpperCase()}
      </button>
    </>
  );

  return offline ? (
    <OfflineState locale={locale} fetchedAt={lastFetchAt}>
      {shell}
    </OfflineState>
  ) : (
    shell
  );
}
