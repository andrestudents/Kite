// FR-012 — the origin-agnostic auth seam. ONE interface, two implementations
// (mera-adapter primary, webauthn-adapter fallback twin); the swap is one
// file, never a rewrite. Screens depend only on this surface — never on
// @category-labs/mera directly (D14 confines those imports to the adapters).

/** WebAuthn relying-party config; `id` is the RP ID (the bare hostname). */
export interface RpConfig {
  id: string;
  name: string;
}

export interface UserIdentity {
  name: string;
  displayName: string;
}

/** Pin for credential re-use (T017): pass back to signIn to skip the picker. */
export interface CredentialRef {
  credentialId: string;
  transports?: string[];
}

/** {v, r, s} over a digest — v ∈ {27, 28}, r/s 0x-prefixed 64 hex (low-S). */
export interface IntentSignature {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

/** Raw signDigest output: compact r‖s (64 bytes) + recovery bit ∈ {0, 1}. */
export interface SigningSessionSignature {
  compact: Uint8Array;
  recovery: number;
}

/** A live, in-memory signing session over one account (D7: prompt-free). */
export interface AccountSession {
  /** EIP-55 checksummed address — the account's only public identity. */
  address: `0x${string}`;
  /** message → hashMessage → signDigest → {v, r, s} (auth-session.md §1.1). */
  signIntent(message: string): Promise<IntentSignature>;
  /** Raw 32-byte digest → compact r‖s + recovery. The EIP-155 tx digest
   *  (T013) and the EIP-712 typed-data digest (the Dukung permit, T016) ride
   *  the SAME prompt-free primitive — no new ceremony anywhere. */
  signDigest(digest: Uint8Array): Promise<SigningSessionSignature>;
  /** Zeroes the session-owned key copy; later signing throws. */
  end(): void;
}

/** The FR-012 interface: account creation, sign-in, intent-signing. */
export interface AuthAdapter {
  /** One ceremony → derived account + its credential pin (T017 persists it). */
  createAccount(
    rp: RpConfig,
    user: UserIdentity,
  ): Promise<{ session: AccountSession; credential: CredentialRef }>;
  /** One assertion ceremony → the same account every time (deterministic). */
  signIn(rpId: string, credential?: CredentialRef): Promise<AccountSession>;
}
