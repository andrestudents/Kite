// Static API-key auth (research D11): constant-time compare over fixed-length
// digests, so unequal lengths leak nothing either. Both services wrap this in
// their Hono middleware; a missing key on either side is simply false.
import { createHash, timingSafeEqual } from "node:crypto";

export function verifyApiKey(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
