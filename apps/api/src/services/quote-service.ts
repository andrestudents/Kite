// T028 — the locked quote (FR-002, §7.4): one fx_quotes row per lock, TTL 60 s.
// Inside the TTL the SAME locked row is returned; past it, a new lock is
// written (append — the table keeps the quote history). Rates are integers
// with a per-pair scale (D13); display conversion happens in the UI and money
// is never derived from a quote (constitution VI/VIII).
import { FX_PAIRS, FX_SOURCE, isFxPair, KiteError, QUOTE_TTL_MS } from "@kite/core";
import { type AnyDb, fxQuotes } from "@kite/core/db";
import { desc, eq } from "drizzle-orm";

export interface QuoteDto {
  pair: string;
  rate: number;
  scale: number;
  expiresAt: string;
  source: string;
}

export async function getQuote(db: AnyDb, pairInput: string): Promise<QuoteDto> {
  if (!isFxPair(pairInput)) {
    throw new KiteError("unknown_pair", `unknown FX pair: ${pairInput}`);
  }
  const fx = FX_PAIRS[pairInput];

  const rows = await db
    .select()
    .from(fxQuotes)
    .where(eq(fxQuotes.pair, pairInput))
    .orderBy(desc(fxQuotes.id))
    .limit(1);
  const locked = rows[0];
  if (locked && locked.expiresAt.getTime() > Date.now()) {
    return {
      pair: pairInput,
      rate: locked.rate,
      scale: fx.scale,
      expiresAt: locked.expiresAt.toISOString(),
      source: FX_SOURCE,
    };
  }

  // No lock, or the last one expired — write a fresh one.
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
  await db.insert(fxQuotes).values({ pair: pairInput, rate: fx.rate, expiresAt });
  return {
    pair: pairInput,
    rate: fx.rate,
    scale: fx.scale,
    expiresAt: expiresAt.toISOString(),
    source: FX_SOURCE,
  };
}
