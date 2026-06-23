// @ts-check
import { defineConfig } from "astro/config";

// Reines statisches HTML fuers CDN (Render runtime: static). Kein Server,
// kein BFF — der Gateway bleibt die einzige Auth-/Billing-/Call-Logik.
//
// inlineStylesheets:"never": die Produktions-CSP des Static-Service ist strikt
// (default-src 'self', KEIN style-src 'unsafe-inline'; siehe render.yaml). Astros
// Default "auto" inlinet kleine CSS (<4kB) als <style> -> unter dieser CSP
// blockiert -> ungestyltes HTML. "never" erzwingt externe, same-origin
// <link>-Stylesheets (unter 'self' erlaubt), unabhaengig von der Dateigroesse.
// So bleibt die strikte CSP unangetastet (Sicherheits-Leitplanke 7).
export default defineConfig({
  output: "static",
  build: {
    inlineStylesheets: "never",
  },
});
