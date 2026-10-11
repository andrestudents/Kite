// The app shell. The full onboarding state machine lands with T016–T019;
// this entry renders the locale-driven landing so the T002 gate
// (`bun run dev:web` serves on localhost HTTPS) is honest from the start.
import { id } from "./locales/id.js";

export function App() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-3xl font-bold text-teal-700">{id.appName}</h1>
      <p className="text-slate-600">{id.signup.subtitle}</p>
    </main>
  );
}
