// T011 — the derivation module (FR-014 as amended). The ONLY file in src/
// allowed to touch @scure/bip39|@scure/bip32 (T009's confinement): PRF bytes
// → BIP-39 → BIP-32 m/44'/60'/0'/0/0 → the 32-byte account key. Hygiene is
// structural, not cosmetic:
//   • the mnemonic exists ONLY as an unbound inline intermediate — JS strings
//     are immutable and cannot be zeroed, so its lifetime is minimized
//     instead (never a named binding, never returned, rendered, or stored);
//   • every byte-array intermediate (the PRF copy, the 64-byte seed) is
//     zeroed in `finally` — the same hygiene as session end();
//   • the returned key is the caller's to zero after the signing session
//     hands off (the session copies the key internally; zero then).
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const DERIVATION_PATH = "m/44'/60'/0'/0/0" as const;

/** Zero every byte — the dispose idiom for key-material buffers. */
export function zeroBytes(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const buffer of buffers) {
    buffer?.fill(0);
  }
}

/**
 * PRF output → the account's 32-byte private key (deterministic).
 * The caller MUST zero the returned key once the signing session has been
 * created (the session snapshots the key); {@link zeroBytes} is the idiom.
 */
export function derivePrivateKey(prfOutput: Uint8Array): Uint8Array {
  const prfCopy = Uint8Array.from(prfOutput);
  let seed: Uint8Array | null = null;
  try {
    // Unbound inline intermediate: entropyToMnemonic(prfCopy, wordlist) feeds
    // mnemonicToSeedSync directly — the phrase never becomes a binding.
    seed = mnemonicToSeedSync(entropyToMnemonic(prfCopy, wordlist));
    const derived = HDKey.fromMasterSeed(seed).derive(DERIVATION_PATH);
    const privateKey = derived.privateKey;
    if (privateKey?.length !== 32) {
      throw new Error("derivation produced no 32-byte key");
    }
    return Uint8Array.from(privateKey);
  } finally {
    zeroBytes(seed, prfCopy);
  }
}
