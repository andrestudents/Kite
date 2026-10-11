// T012 — the FR-012 fallback twin: standard WebAuthn passkeys gating a
// device-bound session key, behind the SAME AuthAdapter interface as
// mera-adapter.ts (the swap is one file, never a rewrite).
//
// ACTIVATION-GATED STUB (T012's exact deliverable): the mechanism below is
// the documented design, NOT a built path. Full construction happens ONLY if
// the fallback activates — i.e. the T005 smoke gate fails on the demo phone
// and the recorded decision (FR-012's bounty-impact record, TRUST.md) says
// descend. Do not gold-plate a path the primary may never need.
//
// Mechanism (documented, unbuilt):
//   1. createAccount → navigator.credentials.create() with
//      residentKey+user-verification required; the credential's
//      publicKey is the trust root. Generate a random secp256k1 session key,
//      store it in IndexedDB encrypted to... nothing else — this is the
//      bounty-relevant difference: WITHOUT the PRF extension there is no
//      deterministic re-derivation, so the key is device-bound (lost on
//      device loss; no cross-device recovery) instead of passkey-rooted.
//   2. signIn → navigator.credentials.get() assertion (one prompt); on
//      success, load the device-bound key from IndexedDB.
//   3. signIntent → identical digest path as the primary (hashMessage →
//      signDigest-equivalent via @noble/curves secp256k1.sign).
// Bounty impact if activated (FR-012): the Mera UX claim ("passkey signup,
// signing sessions, no seed phrase, stateless") would cite ONLY the
// deterministic-derivation properties that still hold; the device-bound key
// storage would be disclosed in TRUST.md as a weaker account root than
// passkey-rooted derivation.
import type {
  AccountSession,
  AuthAdapter,
  CredentialRef,
  RpConfig,
  UserIdentity,
} from "./types.js";

export class FallbackNotActiveError extends Error {
  constructor() {
    super(
      "the WebAuthn fallback is an activation-gated stub — see webauthn-adapter.ts and TRUST.md",
    );
    this.name = "FallbackNotActiveError";
  }
}

export function makeWebAuthnAdapter(): AuthAdapter {
  return {
    async createAccount(
      _rp: RpConfig,
      _user: UserIdentity,
    ): Promise<{
      session: AccountSession;
      credential: CredentialRef;
    }> {
      throw new FallbackNotActiveError();
    },
    async signIn(_rpId: string, _credential?: CredentialRef): Promise<AccountSession> {
      throw new FallbackNotActiveError();
    },
  };
}
