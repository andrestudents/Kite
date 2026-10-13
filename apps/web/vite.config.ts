import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// T002: three HTML entries, ALL of them production-build inputs. The smoke
// page (T005's verification-first gate) and the demo-prep page (T024's wraps)
// run ceremonies that bind to the production rpId — they MUST deploy to the
// final domain (quickstart §0.2). They stay unlinked from the app shell (no
// nav/route references), and the prep page is inert without the laptop's
// one-time key server. `@vitejs/plugin-basic-ssl` covers laptop-only dev.
//
// T028 — PWA posture (research D11): installable, but the service worker is
// APP-SHELL-ONLY. No runtime caching at all and /api excluded from the SPA
// navigation fallback (constitution IV): money state is read fresh every
// time — the chain stays the authority, never the cache.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
      manifest: {
        name: "Kite",
        short_name: "Kite",
        description: "Buat akun, mulai usaha, terima pendapatan — tanpa ribet.",
        lang: "id",
        theme_color: "#1B4332",
        background_color: "#F7F9F3",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/smoke\//, /^\/demo\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      input: {
        index: "index.html",
        smoke: "smoke/index.html",
        prep: "demo/prep.html",
      },
    },
  },
});
