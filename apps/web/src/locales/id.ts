// Bahasa Indonesia — the primary catalog (spec Assumption: Indonesian-first).
// EVERY user-facing string lives here; the banned-words scan (T008) walks both
// catalogs, so no screen may inline copy. Constitution I: the strings never
// reveal what the product is — no wallet/gas/chain/token/seed/pending, no
// "onchain transaction", no crypto vocabulary of any kind.

export const id = {
  appName: "Kite",
  common: {
    retry: "Coba lagi",
    loading: "Sebentar ya…",
    errorGeneric: "Ada kendala. Coba lagi ya.",
    continue: "Lanjut",
  },
  signup: {
    title: "Selamat datang di Kite",
    subtitle: "Satu ketukan untuk mulai. Tidak ada yang perlu dicatat.",
    cta: "Daftar",
    working: "Menyiapkan akunmu…",
    cancelled: "Batal. Ketuk Daftar lagi ya.",
    prfUnavailable: "Perangkat ini belum mendukung cara masuk ini. Coba perangkat lain.",
  },
  phone: {
    title: "Nomor HP kamu",
    hint: "Contoh: 0812xxxxxxx",
    placeholder: "0812…",
    note: "Nomor ini tersimpan di perangkatmu saja. (Tahap demo)",
    invalid: "Nomor belum lengkap.",
  },
  verify: {
    title: "Verifikasi identitas",
    ktpLabel: "Foto KTP",
    selfieLabel: "Foto selfie",
    demoBadge: "Demo Tool",
    note: "Pemeriksa contoh ini menyetujui otomatis. Fotomu tidak pergi dari perangkatmu.",
    submit: "Kirim",
    submitting: "Mengirim…",
    checking: "Memeriksa…",
    retryHint: "Masih diproses. Coba lagi sebentar lagi.",
    ready: "Akun siap!",
    captured: "Foto terambil",
  },
  home: {
    greeting: "Halo!",
    balanceTitle: "Saldo",
    scoreTitle: "Reputasi",
    scoreLabel: "Skor",
    maxSupportLabel: "Batas dukungan",
    activeDealTitle: "Kesepakatan aktif",
    remainingLabel: "Sisa",
    emptyDeal: "Belum ada kesepakatan aktif.",
    locked: "Selesaikan verifikasi dulu untuk mulai.",
    preparing: "Menyiapkan akun…",
    approx: "≈",
    idrPrefix: "Rp",
  },
  session: {
    signIn: "Masuk",
    signOut: "Keluar",
    expired: "Sesi berakhir. Masuk sekali lagi ya.",
  },
  desktop: {
    title: "Lanjut di ponselmu",
    body: "Pindai kode ini dengan ponselmu. Layar ini hanya pendamping.",
  },
} as const;

// One Locale type: keys per screen, values widened to string — the catalogs
// differ in text, never in shape (ms.ts must carry every key). Top-level
// scalars (appName) widen to string; sections map key-for-key to string.
export type Locale = {
  [S in keyof typeof id]: (typeof id)[S] extends string
    ? string
    : { [K in keyof (typeof id)[S]]: string };
};

export default id;
