// T010 — the curl helper quickstart §3 references: sign the frozen message
// (`Sign in to Kite\n<wallet>\nuntil <unix>`) and print a ready-to-paste
// x-kite-session header value.
//
//   Demo Tool — dev tooling. Lives in scripts/gates/, is never imported by
//   app code, never bundled. Key material comes from env or is generated
//   fresh and is NEVER printed — only the derived public address and the
//   header (which is public anyway).
//
//   bun run scripts/gates/mint-session.ts [--key ENV_NAME] [--until <unix>]
//     --key ENV_NAME  sign as the wallet of that env var (e.g. BUDI_KEY);
//                     default: a throwaway account generated for this run
//     --until <unix>  expiry; default now + 7d; --until past → an EXPIRED
//                     session for testing the 401 routing (quickstart §7)
import { KiteError } from "@kite/core";
import { privateKeyToAccount } from "viem/accounts";

const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

function buildSessionMessage(wallet: string, until: number): string {
  return `Sign in to Kite\n${wallet}\nuntil ${until}`;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  console.log("=== mint-session (Demo Tool) — frozen-message session header ===");
  const untilArg = argValue("--until");
  const until = untilArg !== undefined ? Number(untilArg) : Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  if (!Number.isSafeInteger(until) || until <= 0) {
    throw new KiteError("bad_request", "--until must be a positive unix-seconds integer");
  }

  const keyName = argValue("--key");
  let key: `0x${string}`;
  if (keyName !== undefined) {
    const value = process.env[keyName];
    if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
      // Name only — never the value, never the reason it is malformed.
      throw new KiteError("bad_request", `env ${keyName} must hold a 0x-prefixed 32-byte key`);
    }
    key = value as `0x${string}`;
    console.log(`signing as the wallet of env ${keyName}`);
  } else {
    // Throwaway key for this run only — generated, used, dropped, never stored.
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    key = `0x${Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    console.log("signing as a throwaway account (generated for this run)");
  }

  const account = privateKeyToAccount(key);
  const untilFinal = until;
  const message = buildSessionMessage(account.address, untilFinal);
  const hex = await account.signMessage({ message });
  const header = [
    account.address,
    String(untilFinal),
    String(parseInt(hex.slice(130), 16)),
    hex.slice(0, 66),
    `0x${hex.slice(66, 130)}`,
  ].join("|");

  console.log(`message: ${JSON.stringify(message)}`);
  console.log(`x-kite-session: ${header}`);
  console.log("usage: curl -s \"$API/api/me\" -H 'x-kite-session: <value above>'");
}

main().catch((err) => {
  console.error("MINT ERROR", err instanceof Error ? err.message : err);
  process.exit(1);
});
