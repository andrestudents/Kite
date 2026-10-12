// T023 — the demo-derivation mode (US3) behind the SAME AuthAdapter seam.
//
// Why it exists: judges must be able to sign in as the PUBLISHED persona
// accounts (contracts/script/DEMO-ACCOUNTS.md) on any device. The persona's
// private key exists only as an env var on the machine running the prep tool
// (T024, never committed); the prep tool wraps it into a Mera secret vault
// that the DEVICE's own passkey can unlock. What lands in IndexedDB
// (data-model §2.3) is ciphertext — no key material, plaintext or seed.
//
// Sign-in runs the REAL passkey ceremony: the device passkey's PRF unlocks
// the vault, the vault's secret is asserted to be the published persona
// address, and only then does it become a signing session. If the device
// has no demo persona stored, this adapter is never selected
// (makeAdapterForDevice) — fresh judges stay on the pure Mera path.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ DEMO TOOL — this mode exists for the Metropolis demo build only. It     │
// │ carries no additional claims about the protocol beyond what the         │
// │ contract state already shows; the persona keys are demo fixtures.       │
// └─────────────────────────────────────────────────────────────────────────┘
import { decryptSecretVaultWithPasskey, parseSecretVault } from "@category-labs/mera";
import { type KvStore, makeIdbKv } from "../lib/idb-kv.js";
import { isPersonaId, PERSONAS, type PersonaManifest } from "../lib/persona.js";
import { makeMeraAdapter, sessionFromKeyBytes } from "./mera-adapter.js";
import type {
  AccountSession,
  AuthAdapter,
  CredentialRef,
  RpConfig,
  UserIdentity,
} from "./types.js";

/** Code-level label (FR-011 disclosure, place 3) — rendered by callers that
 *  surface the demo state to the user; never user-facing from this module. */
export const DEMO_MODE_NOTICE = "Demo Tool — persona sign-in";

/** IndexedDB key holding the wrapped persona record (data-model §2.3). */
export const DEMO_VAULT_KEY = "kite.demo.persona";

/** What the prep tool (T024) persists after wrapping a persona key. */
export interface DemoVaultRecord {
  persona: PersonaManifest["persona"];
  displayName: string;
  /** Mera secret vault as produced by createSecretVaultWithNewPasskey. */
  vault: unknown;
}

/**
 * secret → signing session, asserted to be the published persona address.
 * On a mismatch the session is ended FIRST (zeroing its key copy) and the
 * caller's secret is zeroed by signIn's finally — a wrong/foreign vault can
 * never sign anything.
 */
export function sessionForWrappedSecret(
  secret: Uint8Array,
  manifest: PersonaManifest,
): AccountSession {
  if (secret.length !== 32) {
    throw new Error("wrapped secret is not 32 bytes");
  }
  const session = sessionFromKeyBytes(secret);
  const address = session.address.toLowerCase();
  const expected = manifest.address.toLowerCase();
  if (address !== expected) {
    session.end();
    throw new Error(`wrapped secret does not match ${manifest.displayName}`);
  }
  return session;
}

/**
 * The demo adapter: sign-in unwraps the stored persona vault through the
 * device passkey; account creation DELEGATES to the primary Mera adapter —
 * a judge's fresh signup is always a real, self-sovereign account (the demo
 * mode changes sign-in only, never the account model).
 */
export function makeDemoAdapter(primary: AuthAdapter, store: KvStore): AuthAdapter {
  return {
    async createAccount(
      rp: RpConfig,
      user: UserIdentity,
    ): Promise<{ session: AccountSession; credential: CredentialRef }> {
      return primary.createAccount(rp, user);
    },

    async signIn(rpId: string, credential?: CredentialRef): Promise<AccountSession> {
      // A PINNED credential names a concrete account created ON this device —
      // a fresh signup on a demo-prepped phone must stay reachable, so the
      // pin rides the PRIMARY Mera path. The persona vault serves only the
      // UNPINNED Masuk ceremony (signInExisting passes no credential).
      if (credential !== undefined) return primary.signIn(rpId, credential);
      const raw = await store.get(DEMO_VAULT_KEY);
      if (raw === null) {
        throw new Error("no demo persona is stored on this device");
      }
      let record: DemoVaultRecord;
      try {
        record = JSON.parse(raw) as DemoVaultRecord;
      } catch {
        throw new Error("stored demo persona is corrupt");
      }
      if (!isPersonaId(record.persona)) {
        throw new Error("stored demo persona is unknown");
      }
      const manifest = PERSONAS[record.persona];
      // Untrusted-JSON boundary (mera docs): validate BEFORE any crypto.
      const vault = parseSecretVault(record.vault);
      // The REAL ceremony — the device passkey must authorize the unlock.
      const secret = await decryptSecretVaultWithPasskey({ rpId, vault });
      try {
        return sessionForWrappedSecret(secret, manifest);
      } finally {
        secret.fill(0); // the session snapshotted the key; the buffer dies here
      }
    },
  };
}

/**
 * Device adapter resolution: a device with a stored demo persona gets the
 * demo adapter; everyone else gets the pure Mera adapter. The presence of
 * the vault record IS the marker — no second source of truth.
 */
export async function makeAdapterForDevice(): Promise<AuthAdapter> {
  const primary = makeMeraAdapter();
  try {
    const store = makeIdbKv("kite-demo", "kv");
    const stored = await store.get(DEMO_VAULT_KEY);
    return stored === null ? primary : makeDemoAdapter(primary, store);
  } catch {
    // Demo mode is a bonus — a broken IndexedDB must never block sign-in.
    return primary;
  }
}
