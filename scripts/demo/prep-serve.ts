// T024 — the ONE-TIME persona key server (Demo Tool, US3 prep).
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ DEMO TOOL — serves the published demo personas' private keys, once each,  │
// │ so the operator's device can wrap them into passkey vaults (the wrap      │
// │ happens in the browser at /demo/prep.html). This is demo-tooling for the  │
// │ Metropolis build: the keys are fixtures published in                      │
// │ contracts/script/DEMO-ACCOUNTS.md and carry no real funds.                │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Security posture (CLAUDE.md, non-negotiable):
//   • keys enter ONLY via env vars: BUDI_KEY / PAKHAJI_KEY (0x + 64 hex);
//   • key VALUES are never printed, logged, or written anywhere — only the
//     DERIVED ADDRESS is printed, so the operator can eyeball it against
//     contracts/script/DEMO-ACCOUNTS.md before wrapping;
//   • each configured key is served exactly once (HTTP 200), then the same
//     route answers 410 Gone for the lifetime of the process;
//   • when every configured key has been fetched, the server stops itself.
//
// Usage: BUDI_KEY=0x… bun scripts/demo/prep-serve.ts   (keys: env only)
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

export type PersonaId = "budi" | "pakhaji";

export const ENV_NAMES: Record<PersonaId, string> = {
  budi: "BUDI_KEY",
  pakhaji: "PAKHAJI_KEY",
};

export const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export type ParsedKeys =
  | { ok: true; keys: Map<PersonaId, string> }
  | { ok: false; problem: string };

/** env → configured keys. Values live only in the returned map, never in a log. */
export function parsePersonaKeys(env: Record<string, string | undefined>): ParsedKeys {
  const keys = new Map<PersonaId, string>();
  for (const persona of Object.keys(ENV_NAMES) as PersonaId[]) {
    const raw = env[ENV_NAMES[persona]];
    if (raw === undefined || raw === "") continue;
    if (!KEY_RE.test(raw)) {
      return {
        ok: false,
        problem: `${ENV_NAMES[persona]} is set but malformed — expected 0x + 64 hex chars`,
      };
    }
    keys.set(persona, raw);
  }
  if (keys.size === 0) {
    return {
      ok: false,
      problem:
        "nothing to serve — provide at least one persona key via env (never a flag, never a file)",
    };
  }
  return { ok: true, keys };
}

/** The address a key derives — the ONLY persona-derived fact that may print. */
export function personaAddresses(keys: Map<PersonaId, string>): Map<PersonaId, string> {
  const addresses = new Map<PersonaId, string>();
  for (const [persona, key] of keys) {
    addresses.set(persona, privateKeyToAccount(key as `0x${string}`).address);
  }
  return addresses;
}

/**
 * The one-time fetch handler: 200-once per configured persona, then 410;
 * unknown routes and unconfigured personas answer 404. CORS stays open (the
 * prep page origin differs); no-store keeps nothing in any intermediary.
 */
export function makePrepHandler(
  keys: Map<PersonaId, string>,
  onAllServed?: () => void,
): (req: Request) => Response {
  const served = new Set<PersonaId>();
  return (req: Request): Response => {
    const url = new URL(req.url);
    const match = /^\/key\/(budi|pakhaji)$/.exec(url.pathname);
    const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
    if (match === null) {
      return new Response("not found\n", { status: 404, headers: cors });
    }
    const persona = match[1] as PersonaId;
    const key = keys.get(persona);
    if (key === undefined) {
      return new Response(`no key configured for ${persona}\n`, { status: 404, headers: cors });
    }
    if (served.has(persona)) {
      return new Response(`gone — the ${persona} key was already fetched once\n`, {
        status: 410,
        headers: cors,
      });
    }
    served.add(persona);
    if (served.size === keys.size) {
      onAllServed?.();
    }
    return new Response(key, { status: 200, headers: cors });
  };
}

/** Test/ops helper — the canonical throwaway key shape (never a real secret). */
export function randomKeyHex(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

async function main(): Promise<void> {
  const parsed = parsePersonaKeys(process.env);
  if (!parsed.ok) {
    console.error(
      `${parsed.problem.charAt(0).toUpperCase()}${parsed.problem.slice(1)}. Exiting.\n` +
        "  BUDI_KEY=0x… bun scripts/demo/prep-serve.ts\n" +
        "  PAKHAJI_KEY=0x… bun scripts/demo/prep-serve.ts",
    );
    process.exit(1);
  }
  const keys = parsed.keys;
  const port = Number(process.env.PREP_PORT ?? 8787);

  console.log(
    [
      "",
      "┌──────────────────────────────────────────────────────────────────┐",
      "│ Demo Tool — one-time persona key server (Kite Metropolis build)  │",
      "└──────────────────────────────────────────────────────────────────┘",
      `Listening on http://localhost:${port} (LAN: http://<laptop-ip>:${port}).`,
      "",
      "Next: open /demo/prep.html on the SAME origin as the app, pick a",
      "persona, and complete the passkey ceremony. Each key answers 200",
      "exactly once, then 410 — the server exits after the last one.",
      "",
      "PREPPING A PHONE (the page there is HTTPS — http:// LAN addresses are",
      "blocked as mixed content; localhost only works from THIS laptop):",
      "  cloudflared tunnel --url http://localhost:8787",
      "→ paste the printed https://…trycloudflare.com URL into the phone's",
      "  'URL server kunci' field, then wrap.",
      "",
      "Keys in play (addresses only — values are never printed):",
    ].join("\n"),
  );
  // The printed line is the ADDRESS — the key itself never crosses stdout.
  for (const [persona, address] of personaAddresses(keys)) {
    console.log(`  ${persona.padEnd(8)} → ${address}`);
  }

  const server = Bun.serve({
    port,
    fetch: makePrepHandler(keys, () => {
      setTimeout(() => {
        console.log("All configured keys fetched once — stopping the key server now.");
        server.stop(true);
        process.exit(0);
      }, 250);
    }),
  });
}

if (import.meta.main) {
  void main();
}
