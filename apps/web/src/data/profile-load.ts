// The public profile's load seam: ONE place decides when "Sebentar ya…"
// ends — a settled fetch becomes a model, ANY failure throws, and a fetch
// that never settles throws at the timeout. The screen maps a rejection to
// its localized error face, so loading is a phase, never a destination
// (device-gate requirement: the page must not hang on "waiting").
import { profileFromDto } from "./assemble.js";
import type { ApiClient } from "./bootstrap.js";
import type { ProfileModel } from "./models.js";

type ProfileDto = Awaited<ReturnType<Pick<ApiClient, "profile">["profile"]>>;
type ProfileSource = { profile(id: string): Promise<unknown> };

/** How long "waiting" may stand before the page owes the user an error face —
 *  long enough for a cold server spin-up, short enough that broken feels
 *  broken NOW instead of never. */
export const PROFILE_LOAD_TIMEOUT_MS = 15_000;

/**
 * Fetches the public profile and assembles the screen model, or THROWS:
 * a rejecting fetch, a non-object body, a float where money must be
 * integral — and a fetch that outlives `timeoutMs`. The caller owns the
 * error rendering; nothing here can leave a screen loading forever.
 */
export async function loadProfileModel(
  api: ProfileSource,
  profileId: string,
  timeoutMs: number = PROFILE_LOAD_TIMEOUT_MS,
  now: () => number = Date.now,
): Promise<ProfileModel> {
  const settle = api.profile(profileId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("profile load timed out")), timeoutMs);
  });
  try {
    const dto = (await Promise.race([settle, timeout])) as ProfileDto | null;
    if (dto === null || typeof dto !== "object") {
      throw new Error("empty profile response");
    }
    return profileFromDto(dto, now());
  } finally {
    clearTimeout(timer);
  }
}
