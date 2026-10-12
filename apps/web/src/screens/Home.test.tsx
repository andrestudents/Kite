// T028 tests — Beranda assembles from homeFromMe; the container's first
// paint (SSR, where effects never run) is the preparing state. The composed
// parts carry their own tests: ReputationWhy (T027), DealCard (T018).
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { ApiClient } from "../data/bootstrap.js";
import { id } from "../locales/id.js";
import { Home } from "./Home.js";

function fakeApi(): ApiClient {
  return {
    me: async () => {
      throw new Error("effects never run in SSR");
    },
    quote: async () => {
      throw new Error("effects never run in SSR");
    },
    verificationGet: async () => {
      throw new Error("effects never run in SSR");
    },
  } as unknown as ApiClient;
}

describe("Home (T028)", () => {
  it("first paint is the preparing state — never a fabricated balance", () => {
    const html = renderToString(
      <Home locale={id} api={fakeApi()} onSignOut={() => {}} onNeedVerification={() => {}} />,
    );
    expect(html).toContain(id.home.preparing);
  });
});
