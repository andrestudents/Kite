// T037 — the phone frame as a shell primitive: a fine-pointer device never
// renders a surface whose next step is a ceremony. Coarse-pointer devices
// (real phones/tablets) get the app itself; desktops get the honest hand-off
// — the frame + QR of the current page — and the flow continues on the phone
// it belongs to. Read-only companions (Beranda, Riwayat, the public profile)
// and the desktop-first operator console stay OUTSIDE this wrapper on
// purpose: they are usable on desktop and attempt no ceremony.
import type { ReactNode } from "react";
import type { Locale } from "../../locales/id.js";
import { DesktopHandoff, isCoarsePointer } from "../DesktopFrame.js";

/** Coarse pointer = the ceremony's home. No window (SSR smoke) renders the
 *  children — the container tests are the loading-state pattern. */
export function isHandoffDevice(): boolean {
  if (typeof window === "undefined") return false;
  return !isCoarsePointer();
}

export function PhoneFrame(props: { locale: Locale; children: ReactNode }) {
  if (!isHandoffDevice()) {
    return <>{props.children}</>;
  }
  return <DesktopHandoff locale={props.locale} />;
}
