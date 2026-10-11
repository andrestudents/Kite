// execute() picks the executor by the driver's REAL drizzle tag — a static
// symbol (Symbol.for("drizzle:entityKind")), not a string property. The
// string-property read once always came back undefined and pushed neon-http
// (which cannot run interactive transactions) into db.transaction → every
// atomic write threw against the live DB. These fakes mirror drizzle's real
// tag shape so that regression cannot come back silently.
import { describe, expect, it } from "bun:test";
import { type AnyDb, execute } from "./atomic.js";

const DRIZZLE_ENTITY_KIND = Symbol.for("drizzle:entityKind");

function fakeDb(entityKind: string): {
  db: AnyDb;
  txSeen: AnyDb | undefined;
  transactions: number;
} {
  const state: { db: AnyDb; txSeen: AnyDb | undefined; transactions: number } = {
    db: undefined as unknown as AnyDb,
    txSeen: undefined,
    transactions: 0,
  };
  const cls = class {};
  (cls as unknown as Record<symbol, string>)[DRIZZLE_ENTITY_KIND] = entityKind;
  const instance = new cls() as AnyDb;
  (instance as unknown as { transaction: unknown }).transaction = (
    cb: (tx: AnyDb) => Promise<unknown>,
  ) => {
    state.transactions++;
    const tx = { entityKindTag: entityKind } as unknown as AnyDb;
    return cb(tx);
  };
  state.db = instance;
  return state;
}

describe("execute (driver-aware executor, T036 live-DB regression)", () => {
  it("runs statements DIRECTLY on a neon-http database — no interactive transaction", async () => {
    const state = fakeDb("NeonHttpDatabase");
    let executor: unknown;
    const out = await execute(state.db, async (db) => {
      executor = db;
      return "direct";
    });
    expect(out).toBe("direct");
    expect(executor).toBe(state.db); // the db itself, not a tx wrapper
    expect(state.transactions).toBe(0);
  });

  it("runs statements INSIDE a real transaction on transactional drivers", async () => {
    const state = fakeDb("PgDatabase");
    let executor: unknown;
    const out = await execute(state.db, async (db) => {
      executor = db;
      return "in-tx";
    });
    expect(out).toBe("in-tx");
    expect(executor).not.toBe(state.db); // the tx the callback handed over
    expect(state.transactions).toBe(1);
  });
});
