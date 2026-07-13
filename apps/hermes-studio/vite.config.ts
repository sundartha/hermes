import { defineConfig } from "vite";

// Das Studio verwendet den echten Hermes-Fluegel aus dem Nachbarpaket
// (apps/hermes-animation-lab) wieder. Damit Vites Dev-Server diese Dateien
// ausserhalb des eigenen Roots lesen darf, erlauben wir den apps-Ordner.
// /api wird an den lokalen Bridge-Server (server.mjs) weitergereicht, der mit
// deinem Higgsfield-Account generiert.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5180,
    fs: {
      allow: [".."],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5181",
        changeOrigin: true,
      },
      // Fertige MP4s liegen beim Bridge-Server (server.mjs) unter /out.
      "/out": {
        target: "http://127.0.0.1:5181",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
  },
});
