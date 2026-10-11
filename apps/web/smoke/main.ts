// T005 — the FR-011 verification-first smoke gate (research D2). Dev-only
// page: five real ceremonies, PASS/FAIL per step with evidence. Any FAIL on
// the vault primitive ⇒ STOP, return to clarify — the fallback ladder is
// printed on the page and nothing in the feature builds on the vault before
// this gate passes on the demo phone. This page is deliberately OUTSIDE
// src/ and imports @category-labs/mera directly: it must test the raw
// primitive before any adapter exists, and T009's confinement scans src/
// only (D14's adapter confinement applies to the app, not to this gate).
//
// Exact API chains per research/mera-docs-map.md rows 1–3 (0.2.0):
//   createPasskeyWithPrfOutput({rp, user}) → {credentialId, prfOutput(32)}
//   entropyToMnemonic(prf, wordlist) → mnemonicToSeedSync → HDKey
//     .fromMasterSeed(seed).derive("m/44'/60'/0'/0/0").privateKey
//   createSecp256k1SigningSession({privateKey}) → getEvmAddress(session.publicKey)
//   createSecretVaultWithNewPasskey({rp, user, secret}) → vault JSON
//   parseSecretVault(JSON.parse(stored)) → decryptSecretVaultWithPasskey({rpId, vault})
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  createSecretVaultWithNewPasskey,
  decryptSecretVaultWithPasskey,
  getEvmAddress,
  parseSecretVault,
} from "@category-labs/mera";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { getAddress } from "viem";

interface StepResult {
  name: string;
  ok: boolean;
  evidence: string;
}

const $rpid = document.getElementById("rpid");
const $run = document.getElementById("run") as HTMLButtonElement;
const $steps = document.getElementById("steps");
const $verdict = document.getElementById("verdict");
if (!$rpid || !$run || !$steps || !$verdict) {
  throw new Error("smoke page elements missing");
}
// Narrowed locals for the closures below (module-level narrowing doesn't
// reach into function bodies).
const stepsEl: HTMLElement = $steps;
const verdictEl: HTMLElement = $verdict;
const RP_ID = location.hostname;
$rpid.textContent = RP_ID;

function render(result: StepResult): void {
  const li = document.createElement("li");
  const mark = document.createElement("span");
  mark.className = result.ok ? "PASS" : "FAIL";
  mark.textContent = result.ok ? "PASS " : "FAIL ";
  li.appendChild(mark);
  li.appendChild(document.createTextNode(result.name));
  const ev = document.createElement("div");
  ev.className = "evidence";
  ev.textContent = result.evidence;
  li.appendChild(ev);
  stepsEl.appendChild(li);
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

/** The app-side derivation chain (docs-map row 1) — address for a PRF output. */
function deriveAddress(prfOutput: Uint8Array): {
  address: string;
  privateKey: Uint8Array;
  zero: () => void;
} {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist); // inline intermediate
  const seed = mnemonicToSeedSync(mnemonic);
  const derived = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  const privateKey = derived.privateKey;
  if (privateKey?.length !== 32) {
    seed.fill(0);
    throw new Error("derivation produced no 32-byte key");
  }
  const session = createSecp256k1SigningSession({ privateKey });
  const address = getAddress(String(getEvmAddress(session.publicKey)));
  session.end();
  return {
    address,
    privateKey,
    zero: () => {
      seed.fill(0);
      privateKey.fill(0);
    },
  };
}

async function run(): Promise<void> {
  const results: StepResult[] = [];
  const rp = { id: RP_ID, name: "Kite smoke (Demo Tool)" };
  const push = (name: string, ok: boolean, evidence: string): StepResult => {
    const result = { name, ok, evidence };
    results.push(result);
    render(result);
    return result;
  };

  // ── 1. Passkey with PRF output ────────────────────────────────────────────
  let prfOutput: Uint8Array | null = null;
  try {
    const created = await createPasskeyWithPrfOutput({
      rp,
      user: {
        name: `kite-smoke-${Date.now()}`,
        displayName: "Kite smoke gate",
      },
    });
    prfOutput = created.prfOutput;
    const ok = prfOutput instanceof Uint8Array && prfOutput.length === 32;
    push(
      "1. createPasskeyWithPrfOutput — PRF present",
      ok,
      `credentialId=${created.credentialId} prfOutput=${prfOutput.length}B`,
    );
  } catch (err) {
    push("1. createPasskeyWithPrfOutput — PRF present", false, describe(err));
  }
  if (!prfOutput) {
    finish(results);
    return;
  }

  // ── 2. Derivation determinism: same PRF bytes → same EIP-55 address ──────
  try {
    const first = deriveAddress(prfOutput);
    const second = deriveAddress(prfOutput);
    const ok = first.address === second.address;
    push(
      "2. derive twice — deterministic address",
      ok,
      `addr=${first.address} again=${second.address}`,
    );
    first.zero();
    second.zero();
  } catch (err) {
    push("2. derive twice — deterministic address", false, describe(err));
  }

  // ── 3. Wrap a throwaway test key into a vault ────────────────────────────
  let testKey: Uint8Array | null = crypto.getRandomValues(new Uint8Array(32));
  let vaultJson: string | null = null;
  try {
    const wrapSession = createSecp256k1SigningSession({ privateKey: testKey });
    const testAddress = getAddress(String(getEvmAddress(wrapSession.publicKey)));
    wrapSession.end();
    const vault = await createSecretVaultWithNewPasskey({
      rp,
      user: { name: `kite-smoke-vault-${Date.now()}`, displayName: "Kite smoke vault" },
      secret: testKey,
    });
    vaultJson = JSON.stringify(vault); // the app stores exactly this shape
    push(
      "3. createSecretVaultWithNewPasskey — test key wrapped",
      vaultJson.length > 0 && vault.version === 1,
      `testAddr=${testAddress} vault.version=${vault.version} ciphertext=${vault.ciphertext.length} chars`,
    );
  } catch (err) {
    push("3. createSecretVaultWithNewPasskey — test key wrapped", false, describe(err));
  }

  // ── 4. Unwrap through the passkey ceremony (one assertion) ───────────────
  let unwrapped: Uint8Array | null = null;
  if (vaultJson) {
    try {
      const parsed = parseSecretVault(JSON.parse(vaultJson)); // the stored-JSON boundary
      unwrapped = await decryptSecretVaultWithPasskey({ rpId: RP_ID, vault: parsed });
      push(
        "4. parseSecretVault + decryptSecretVaultWithPasskey",
        unwrapped instanceof Uint8Array && unwrapped.length === 32,
        `secret=${unwrapped.length}B via credential ${parsed.credential.credentialId}`,
      );
    } catch (err) {
      push("4. parseSecretVault + decryptSecretVaultWithPasskey", false, describe(err));
    }
  } else {
    push("4. parseSecretVault + decryptSecretVaultWithPasskey", false, "no vault from step 3");
  }

  // ── 5. Unwrapped key's address == the test key's address ─────────────────
  if (unwrapped && testKey) {
    try {
      const beforeSession = createSecp256k1SigningSession({ privateKey: testKey });
      const before = getAddress(String(getEvmAddress(beforeSession.publicKey)));
      beforeSession.end();
      const afterSession = createSecp256k1SigningSession({ privateKey: unwrapped });
      const after = getAddress(String(getEvmAddress(afterSession.publicKey)));
      afterSession.end();
      push("5. unwrapped address == test key address", before === after, `${before} vs ${after}`);
    } catch (err) {
      push("5. unwrapped address == test key address", false, describe(err));
    }
  } else {
    push("5. unwrapped address == test key address", false, "no unwrapped key from step 4");
  }

  // Hygiene: zero every byte intermediate we still hold (recipe pattern).
  unwrapped?.fill(0);
  if (testKey) {
    testKey.fill(0);
    testKey = null;
  }
  prfOutput.fill(0);
  finish(results);
}

function finish(results: StepResult[]): void {
  const failed = results.filter((r) => !r.ok);
  const verdict = failed.length === 0 && results.length === 5;
  verdictEl.textContent =
    failed.length === 0
      ? `=== SMOKE GATE ${verdict ? "PASS" : "INCOMPLETE"} — ${results.length}/5 langkah ===`
      : `=== SMOKE GATE FAIL — ${failed.length} langkah gagal. STOP: kembali ke clarify. ===`;
  verdictEl.className = `verdict ${failed.length === 0 ? "PASS" : "FAIL"}`;
  $run.disabled = false;
  $run.textContent = "Jalankan lagi";
}

$run.addEventListener("click", () => {
  $run.disabled = true;
  $steps.innerHTML = "";
  $verdict.textContent = "";
  run().catch((err) => {
    $verdict.textContent = `=== SMOKE GATE FAIL — ${describe(err)} ===`;
    $verdict.className = "verdict FAIL";
    $run.disabled = false;
  });
});
