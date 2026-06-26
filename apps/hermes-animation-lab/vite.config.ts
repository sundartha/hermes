import { defineConfig } from "vite";

// Isolierte Dev-Umgebung. base relativ, damit der Build auch unter einem
// Unterpfad (z.B. Artefakt-Hosting) ohne Server-Rewrite laeuft.
export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
