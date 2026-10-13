// Presentation frames shared by moment surfaces (T021/T024): the live moment
// fills the screen above everything in ink green; the replay frames the same
// story as a past-season detail. Kept in lib/ so the class lists stay one
// constant each.
export const MOMENT_LIVE_FRAME =
  "fixed inset-0 z-50 flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink px-6 text-center text-[#F2F6EF]";
export const MOMENT_REPLAY_FRAME =
  "mx-auto max-w-md rounded-2xl border border-night bg-ink p-6 text-center text-[#F2F6EF]";
