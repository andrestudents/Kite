// T024 — the demo-prep page (Demo Tool, US3 prep; served at /demo/prep.html).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ DEMO TOOL — operator page for wrapping a published persona key into a   │
// │ passkey vault on THIS device, via scripts/demo/prep-serve.ts. After a   │
// │ successful wrap the device's own passkey unlocks the persona (demo-     │
// │ adapter.ts); the raw key never touches storage, DOM, or the network in  │
// │ plaintext form twice — it is fetched ONCE, wrapped, and zeroed.         │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Flow per persona: fetch key (200-once/410) → hex-validate →
// createSecretVaultWithNewPasskey (REAL ceremony, rpId = this origin) →
// store {persona, displayName, vault} in IndexedDB (data-model §2.3) →
// immediately re-decrypt + address-assert (sessionForWrappedSecret) so the
// operator sees VERIFIED before leaving the page → zero the raw bytes.
import {
  createSecretVaultWithNewPasskey,
  decryptSecretVaultWithPasskey,
  parseSecretVault,
} from "@category-labs/mera";
import { hexToBytes } from "viem/utils";
import {
  DEMO_VAULT_KEY,
  type DemoVaultRecord,
  sessionForWrappedSecret,
} from "../src/auth/demo-adapter.js";
import { makeIdbKv } from "../src/lib/idb-kv.js";
import { isPersonaId, PERSONAS, type PersonaId } from "../src/lib/persona.js";

const RP_ID = window.location.hostname;
const KEY_HEX_RE = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_SERVER = "http://localhost:8787";

const kv = makeIdbKv("kite-demo", "kv");

const $root = document.getElementById("root");

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>>,
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

function setStatus(text: string, isError = false): void {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = text;
    status.style.color = isError ? "#b91c1c" : "#0f766e";
  }
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The wrap + verify sequence for one persona (the buttons' onClick). */
async function wrapPersona(persona: PersonaId, baseUrl: string): Promise<void> {
  const manifest = PERSONAS[persona];
  setStatus(`Mengambil kunci ${manifest.displayName} dari server sekali-pakai…`);
  let keyHex: string;
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/key/${persona}`);
    if (res.status === 410) {
      setStatus(
        "Kunci ini sudah pernah dipakai (410). Nyalakan ulang scripts/demo/prep-serve.ts bila ingin membungkus ulang.",
        true,
      );
      return;
    }
    if (!res.ok) {
      setStatus(
        `Server kunci menjawab ${res.status}. Pastikan prep-serve.ts berjalan di laptop.`,
        true,
      );
      return;
    }
    keyHex = (await res.text()).trim();
  } catch {
    setStatus(
      `Tidak bisa menjangkau ${baseUrl}. Periksa server kunci dan URL-nya (perangkat demo ↔ laptop harus satu jaringan).`,
      true,
    );
    return;
  }
  if (!KEY_HEX_RE.test(keyHex)) {
    setStatus(
      "Isi yang diterima bukan kunci 32-byte yang valid — hentikan server dan periksa env-nya.",
      true,
    );
    return;
  }
  const secret = hexToBytes(keyHex as `0x${string}`);
  try {
    setStatus("Gerakan passkey 1/2: membungkus kunci ke passkey perangkat ini…");
    const vault = await createSecretVaultWithNewPasskey({
      rp: { id: RP_ID, name: "Kite" },
      user: { name: `kite-demo-${persona}`, displayName: manifest.displayName },
      secret,
    });
    const record: DemoVaultRecord = {
      persona,
      displayName: manifest.displayName,
      vault,
    };
    await kv.set(DEMO_VAULT_KEY, JSON.stringify(record));
    setStatus("Tersimpan. Gerakan passkey 2/2: memverifikasi bungkusannya…");
    // Verify NOW, on this page: re-decrypt through the same passkey and
    // assert the derived address equals the published persona address.
    const roundTrip = await decryptSecretVaultWithPasskey({
      rpId: RP_ID,
      vault: parseSecretVault(vault),
    });
    try {
      const session = sessionForWrappedSecret(roundTrip, manifest);
      session.end();
    } finally {
      roundTrip.fill(0);
    }
    setStatus(
      `TERVERIFIKASI — ${manifest.displayName} (${short(manifest.address)}) kini terbuka oleh passkey perangkat ini. ` +
        "Matikan server kunci (ia berhenti sendiri setelah kunci terakhir diambil), lalu buka aplikasi dan tekan Masuk.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Gagal: ${message}`, true);
  } finally {
    secret.fill(0);
  }
}

async function render(): Promise<void> {
  if (!$root) return;
  $root.replaceChildren();

  // Current device state, if a persona already lives here.
  let carried: string | null = null;
  try {
    const raw = await kv.get(DEMO_VAULT_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as DemoVaultRecord;
      if (isPersonaId(parsed.persona)) carried = PERSONAS[parsed.persona].displayName;
    }
  } catch {
    carried = null; // unreadable store — the wrap below simply overwrites it
  }

  const serverLabel = el("label", { for: "key-server" }, "URL server kunci (sekali-pakai)");
  const serverInput = el("input", {
    id: "key-server",
    type: "url",
    value: DEFAULT_SERVER,
    style: "width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;margin:4px 0 16px",
  });
  $root.append(serverLabel, serverInput);

  if (carried !== null) {
    $root.append(
      el(
        "p",
        { style: "color:#92400e;margin:0 0 12px" },
        `Perangkat ini sudah membawa persona: ${carried}. Membungkus ulang akan menggantinya.`,
      ),
    );
  }

  for (const persona of Object.keys(PERSONAS) as PersonaId[]) {
    const manifest = PERSONAS[persona];
    const button = el(
      "button",
      {
        type: "button",
        style:
          "display:block;width:100%;text-align:left;padding:12px 14px;margin:0 0 10px;border:1px solid #94a3b8;border-radius:10px;background:#fff;cursor:pointer;font-size:1rem",
      },
      el("strong", {}, manifest.displayName),
      el(
        "div",
        { style: "color:#64748b;font-size:0.8rem;margin-top:2px" },
        short(manifest.address),
      ),
    );
    button.addEventListener("click", () => {
      void wrapPersona(persona, serverInput.value || DEFAULT_SERVER);
    });
    $root.append(button);
  }

  $root.append(el("p", { id: "status", style: "font-weight:600;min-height:1.5em" }, ""));
  $root.append(
    el(
      "p",
      { style: "color:#64748b;font-size:0.8rem;margin-top:16px" },
      "Kunci persona hanya lewat env var di laptop (BUDI_KEY / PAKHAJI_KEY), diambil sekali, dibungkus ke passkey perangkat ini, lalu di-nol-kan. Isi tersimpan adalah ciphertext (vault Mera) di IndexedDB perangkat.",
    ),
  );
}

void render();
