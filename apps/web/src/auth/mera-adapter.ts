// T011 — the PRIMARY auth adapter (FR-012). ALL @category-labs/mera imports
// of the app live here (+ demo-adapter.ts; the smoke gate page is the
// sanctioned pre-adapter exception outside src/). The WebAuthn fallback twin
// (webauthn-adapter.ts) sits behind the SAME interface — a swap is this one
// file, never a rewrite (research D14).
//
// Chains per research/mera-docs-map.md rows 1–2 (@category-labs/mera 0.2.0):
//   createAccount: createPasskeyWithPrfOutput({rp, user}) → derivePrivateKey
//     → createSecp256k1SigningSession({privateKey}) → getEvmAddress — the
//     address is EIP-55 and available immediately, no extra prompt.
//   signIn: getPasskeyPrfOutput({rpId, credential}) — the library's DEFAULT
//     salt is sha256("mera.prf.salt.v1") and stable across versions, so the
//     same passkey yields the same PRF bytes → the same account. Credential
//     pinning (T017): pass {credentialId, transports} back to skip the picker.
//   signIntent: message → viem hashMessage (EIP-191 digest, pinned by
//     contracts/auth-session.md §1.1) → session.signDigest → splitCompact.
//     One low-S signature, no biometric re-prompt (D7).
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
} from "@category-labs/mera";
import { hashMessage } from "viem";
import { getAddress, toBytes } from "viem/utils";
import { derivePrivateKey, zeroBytes } from "./derive.js";
import { splitCompactSignature } from "./session.js";
import type {
  AccountSession,
  AuthAdapter,
  CredentialRef,
  IntentSignature,
  RpConfig,
  UserIdentity,
} from "./types.js";

type MeraSession = ReturnType<typeof createSecp256k1SigningSession>;

/**
 * A live Mera session → the origin-agnostic AccountSession (address + intent
 * signing + end). Shared by the PRF path below and the demo mode's
 * wrapped-key path (demo-adapter.ts) — both are sanctioned mera importers.
 */
export function wrapMeraSession(meraSession: MeraSession, address: `0x${string}`): AccountSession {
  return {
    address,
    async signIntent(message: string): Promise<IntentSignature> {
      const digest = toBytes(hashMessage(message)); // the pinned §1.1 digest
      const sig = await sessionSignDigest(meraSession, digest);
      return splitCompactSignature(sig.compact, sig.recovery);
    },
    end() {
      meraSession.end(); // zeroes the session-owned key copy; later signing throws
    },
  };
}

/** Raw 32-byte key → a live session over it (address asserted by the caller). */
export function sessionFromKeyBytes(privateKey: Uint8Array): AccountSession {
  const meraSession = createSecp256k1SigningSession({ privateKey });
  const address = getAddress(String(getEvmAddress(meraSession.publicKey))) as `0x${string}`;
  return wrapMeraSession(meraSession, address);
}

async function sessionSignDigest(
  session: MeraSession,
  digest: Uint8Array,
): Promise<{ compact: Uint8Array; recovery: number }> {
  return session.signDigest(digest);
}

/** PRF bytes → a live signing session; every intermediate zeroed on the way. */
function openSession(prfOutput: Uint8Array): AccountSession {
  const prfCopy = Uint8Array.from(prfOutput);
  let key: Uint8Array | null = null;
  let session: AccountSession | null = null;
  try {
    key = derivePrivateKey(prfCopy);
    session = sessionFromKeyBytes(key);
    return session;
  } finally {
    // Hand-off done (the session snapshots the key) or failed — zero anyway.
    zeroBytes(key, prfCopy);
  }
}

/** The Mera passkey adapter — the primary implementation of FR-012. */
export function makeMeraAdapter(): AuthAdapter {
  return {
    async createAccount(
      rp: RpConfig,
      user: UserIdentity,
    ): Promise<{ session: AccountSession; credential: CredentialRef }> {
      const created = await createPasskeyWithPrfOutput({ rp, user });
      // Omit prfSalt: the library's default is sha256("mera.prf.salt.v1"),
      // stable across versions — create and sign-in see the same bytes.
      const session = openSession(created.prfOutput);
      return {
        session,
        credential: {
          credentialId: created.credentialId,
          transports: created.transports as string[] | undefined,
        },
      };
    },

    async signIn(rpId: string, credential?: CredentialRef): Promise<AccountSession> {
      const out = await getPasskeyPrfOutput({
        rpId,
        credential: credential as Parameters<typeof getPasskeyPrfOutput>[0]["credential"],
      });
      return openSession(out.prfOutput);
    },
  };
}
