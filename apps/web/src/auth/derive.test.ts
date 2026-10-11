// T011 — the derivation module's STRUCTURAL hygiene test (FR-014 as amended,
// SC-004). Three prongs, exactly as spec'd:
//   (i)   the return value contains ONLY the 32-byte key — no wordlist word
//         appears anywhere in what comes back;
//   (ii)  spies prove derivation touches no console/clipboard/localStorage/
//         indexedDB/network;
//   (iii) source assertions — derive.ts binds no mnemonic variable and its
//         `finally` zeroes each byte intermediate.
// This test references the bip39 identifiers to POLICE them (T009's exemption):
// assertions only — it never computes a mnemonic for display or storage.
import { describe, expect, it } from "bun:test";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { DERIVATION_PATH, derivePrivateKey, zeroBytes } from "./derive.js";

const PRF = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 0xff);

describe("derivePrivateKey — structural hygiene (FR-014 amended)", () => {
  it("(i) returns ONLY the 32-byte key — no wordlist word in the return value", () => {
    const key = derivePrivateKey(PRF);
    expect(key.length).toBe(32);
    // The mnemonic for THIS input, word by word, must not leak into the bytes.
    const mnemonic = entropyToMnemonic(PRF, wordlist); // policing only — never rendered
    const asLatin1 = Array.from(key, (b) => String.fromCharCode(b)).join("");
    for (const word of mnemonic.split(" ")) {
      expect(asLatin1.includes(word)).toBe(false);
    }
    // Deterministic: same PRF bytes → same key (US1-AC1).
    const again = derivePrivateKey(PRF);
    expect(Array.from(again)).toEqual(Array.from(key));
    zeroBytes(key, again);
  });

  it("(ii) touches no console, clipboard, storage, or network during derivation", () => {
    const calls: string[] = [];
    const spy =
      (name: string) =>
      (..._args: unknown[]) => {
        calls.push(name);
        throw new Error(`derivation must not ${name}`);
      };
    const savedConsole = { ...console };
    const savedFetch = globalThis.fetch;
    const savedStorage = (globalThis as Record<string, unknown>).localStorage;
    const savedIdb = (globalThis as Record<string, unknown>).indexedDB;
    const savedNavigator = (globalThis as Record<string, unknown>).navigator;
    try {
      for (const level of ["log", "info", "warn", "error", "debug"] as const) {
        (console as unknown as Record<string, unknown>)[level] = spy(`console.${level}`);
      }
      globalThis.fetch = spy("fetch") as unknown as typeof fetch;
      const g = globalThis as Record<string, unknown>;
      g.localStorage = {
        getItem: spy("localStorage"),
        setItem: spy("localStorage"),
        removeItem: spy("localStorage"),
        clear: spy("localStorage"),
      };
      g.indexedDB = { open: spy("indexedDB") };
      g.navigator = { clipboard: { writeText: spy("clipboard") } };

      const key = derivePrivateKey(PRF);
      expect(key.length).toBe(32);
      expect(calls).toEqual([]); // reached nothing — every spy would have thrown
      zeroBytes(key);
    } finally {
      console.log = savedConsole.log;
      console.info = savedConsole.info;
      console.warn = savedConsole.warn;
      console.error = savedConsole.error;
      console.debug = savedConsole.debug;
      globalThis.fetch = savedFetch;
      const g = globalThis as Record<string, unknown>;
      if (savedStorage === undefined) delete g.localStorage;
      else g.localStorage = savedStorage;
      if (savedIdb === undefined) delete g.indexedDB;
      else g.indexedDB = savedIdb;
      if (savedNavigator === undefined) delete g.navigator;
      else g.navigator = savedNavigator;
    }
  });

  it("(iii) source: no mnemonic binding; finally zeroes each byte intermediate", async () => {
    const source = await Bun.file(new URL("./derive.ts", import.meta.url)).text();
    // The phrase is never a named binding (unbound inline intermediate only).
    expect(/\b(?:const|let|var)\s+mnemonic\b/.test(source)).toBe(false);
    // It is consumed inline, directly as mnemonicToSeedSync's argument.
    expect(source).toContain("mnemonicToSeedSync(entropyToMnemonic(prfCopy, wordlist))");
    // The finally block zeroes every byte intermediate.
    expect(source).toContain("} finally {");
    expect(source).toContain("zeroBytes(seed, prfCopy)");
    // And the path is the fixed BIP-44 EVM path.
    expect(source).toContain(DERIVATION_PATH);
  });
});
