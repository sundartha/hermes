// @ts-check
import { defineConfig } from "astro/config";

// Reines statisches HTML fuers CDN (Render runtime: static). Kein Server,
// kein BFF — der Gateway bleibt die einzige Auth-/Billing-/Call-Logik.
export default defineConfig({
  output: "static",
});
