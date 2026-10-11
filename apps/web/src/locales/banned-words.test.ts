// T008 (constitution I): EVERY string in both locale catalogs is free of the
// banned words — the catalogs hold the complete set of user-visible strings,
// so this walk is exhaustive at source level (research D9). The scan grows
// with every screen task: new copy lands in the catalogs or the test fails.
import { describe, expect, it } from "bun:test";
import { id } from "./id.js";
import { ms } from "./ms.js";

const BANNED_WORDS = /\b(wallet|gas|chain|token|seed|pending)\b|onchain transaction/i;

/** Every string leaf with its path — keys are structure, not copy. */
function* stringLeaves(node: unknown, path: string): Generator<[string, string]> {
  if (typeof node === "string") {
    yield [path, node];
  } else if (Array.isArray(node)) {
    let i = 0;
    for (const item of node) {
      yield* stringLeaves(item, `${path}[${i}]`);
      i += 1;
    }
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      yield* stringLeaves(value, `${path}.${key}`);
    }
  }
}

function violations(catalog: object, name: string): string[] {
  return [...stringLeaves(catalog, name)]
    .filter(([_, value]) => BANNED_WORDS.test(value))
    .map(([path, value]) => `${path} = "${value}"`);
}

describe("banned words in locale catalogs (constitution I)", () => {
  it("the Indonesian catalog carries none", () => {
    expect(violations(id, "id")).toEqual([]);
  });

  it("the Malay catalog carries none", () => {
    expect(violations(ms, "ms")).toEqual([]);
  });

  it("both catalogs keep the same shape (no locale drops a string)", () => {
    const pathsOf = (catalog: object, name: string) =>
      [...stringLeaves(catalog, name)].map(([path]) => path.replace(/^[a-z]+\./, ""));
    expect(pathsOf(ms, "ms")).toEqual(pathsOf(id, "id"));
  });

  it("the scanner itself catches banned copy (a guard against a vacuous test)", () => {
    expect(violations({ note: "your tokens are in the wallet, gas covered" }, "x").length).toBe(1);
    expect(violations({ note: "menunggu" }, "x")).toEqual([]); // Malay word ≠ "pending"
  });
});
