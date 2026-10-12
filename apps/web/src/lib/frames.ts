// Presentation frames shared by moment surfaces (T021/T024): the live moment
// fills the screen above everything; the replay frames the same story as a
// past-season detail. Kept in lib/ so the class lists stay one constant each.
export const MOMENT_LIVE_FRAME =
  "fixed inset-0 z-50 flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-900/95 px-6 text-center";
export const MOMENT_REPLAY_FRAME =
  "mx-auto max-w-md rounded-2xl border border-slate-200 bg-slate-900/95 p-6 text-center";
