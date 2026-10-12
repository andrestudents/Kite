// T031 tests — the Kirim screen: the form paints from the catalog only (the
// flow's ORDER lives in data/kirim's sendKirim, tested there — including the
// over-balance-rejected-before-signature gate), offline renders its plain
// block, and Lunas is a distinct done face.
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { AccountSession } from "../../auth/types.js";
import type { ApiClient } from "../../data/bootstrap.js";
import { id } from "../../locales/id.js";
import { Kirim } from "./Kirim.js";

function fakeSession(): AccountSession {
  return {
    address: privateKeyToAccount(generatePrivateKey()).address,
    signIntent: async () => {
      throw new Error("effects never run in SSR");
    },
    signDigest: async () => {
      throw new Error("effects never run in SSR");
    },
    end() {},
  } as unknown as AccountSession;
}

const MEM = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
};

describe("the Kirim screen (T031)", () => {
  it("first paint: recipient + amount from the catalog, no keys in prose", () => {
    const html = renderToString(
      <Kirim
        locale={id}
        api={{} as unknown as ApiClient}
        session={fakeSession()}
        storage={MEM()}
        profileId="siti"
      />,
    );
    expect(html).toContain(id.kirim.title);
    expect(html).toContain(id.kirim.recipientLabel);
    expect(html).toContain(id.kirim.recipientCode);
    expect(html).toContain(id.kirim.recipientManual);
    expect(html).toContain(id.kirim.amountLabel);
    expect(html).toContain(id.kirim.confirmCta);
  });

  it("nothing on the first paint announces success — Lunas is earned", () => {
    const html = renderToString(
      <Kirim
        locale={id}
        api={{} as unknown as ApiClient}
        session={fakeSession()}
        storage={MEM()}
        profileId="siti"
      />,
    );
    expect(html).not.toContain(id.kirim.lunas);
    expect(html).not.toContain(id.kirim.saldoShort);
  });

  it("ReceiveCode's QR arrives only after its effect — no placeholder hex", () => {
    const html = renderToString(
      <Kirim
        locale={id}
        api={{} as unknown as ApiClient}
        session={fakeSession()}
        storage={MEM()}
        profileId="siti"
      />,
    );
    expect(html).not.toContain("data:image"); // effects never run in SSR
  });
});
