// Bahasa Melayu — the second catalog (spec Assumption: for the Pak Haji
// persona). Must satisfy the same Locale shape as the Indonesian catalog; the
// banned-words scan (T008) walks this file too.
import type { Locale } from "./id.js";

export const ms: Locale = {
  appName: "Kite",
  common: {
    retry: "Cuba lagi",
    loading: "Sekejap ya…",
    errorGeneric: "Ada masalah. Cuba lagi ya.",
    continue: "Teruskan",
  },
  signup: {
    title: "Selamat datang di Kite",
    subtitle: "Satu ketukan untuk mula. Tiada apa yang perlu dicatat.",
    cta: "Daftar",
    working: "Menyiapkan akaun anda…",
    cancelled: "Batal. Ketuk Daftar sekali lagi ya.",
    prfUnavailable: "Peranti ini belum menyokong cara masuk ini. Cuba peranti lain.",
  },
  phone: {
    title: "Nombor telefon anda",
    hint: "Contoh: 012xxxxxxx",
    placeholder: "012…",
    note: "Nombor ini disimpan dalam peranti anda sahaja. (Peringkat demo)",
    invalid: "Nombor belum lengkap.",
  },
  verify: {
    title: "Pengesahan identiti",
    ktpLabel: "Gambar MyKad",
    selfieLabel: "Gambar selfie",
    demoBadge: "Demo Tool",
    note: "Pemeriksa contoh ini meluluskan secara automatik. Gambar anda tidak keluar dari peranti anda.",
    submit: "Hantar",
    submitting: "Menghantar…",
    checking: "Menyemak…",
    retryHint: "Masih diproses. Cuba lagi sebentar lagi.",
    ready: "Akaun sedia!",
    captured: "Gambar diambil",
  },
  home: {
    greeting: "Hai!",
    balanceTitle: "Baki",
    scoreTitle: "Reputasi",
    scoreLabel: "Skor",
    maxSupportLabel: "Had sokongan",
    activeDealTitle: "Perjanjian aktif",
    remainingLabel: "Baki",
    emptyDeal: "Belum ada perjanjian aktif.",
    locked: "Selesaikan pengesahan dahulu untuk mula.",
    preparing: "Menyiapkan akaun…",
  },
  session: {
    signIn: "Masuk",
    signOut: "Keluar",
    expired: "Sesi telah tamat. Masuk sekali lagi ya.",
  },
  desktop: {
    title: "Sambung di telefon anda",
    body: "Imbas kod ini dengan telefon anda. Skrin ini hanya pendamping.",
  },
};

export default ms;
