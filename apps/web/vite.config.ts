import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// T002: three HTML entries, ALL of them production-build inputs. The smoke
// page (T005's verification-first gate) and the demo-prep page (T024's wraps)
// run ceremonies that bind to the production rpId — they MUST deploy to the
// final domain (quickstart §0.2). They stay unlinked from the app shell (no
// nav/route references), and the prep page is inert without the laptop's
// one-time key server. `@vitejs/plugin-basic-ssl` covers laptop-only dev.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
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
