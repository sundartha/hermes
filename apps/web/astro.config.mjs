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
  // Kanonische Marken-URL (Strategie: sundartha.com ist die Brand-URL; der Infra-/
  // Domain-Cutover ist Track B). Ermoeglicht absolute canonical-/og:url-Links und
  // die statische sitemap.xml. Repo/Render-Service heissen weiter vodafone-agent.
  site: "https://sundartha.com",
  output: "static",
  build: {
    inlineStylesheets: "never",
  },
  // assetsInlineLimit: 0 erzwingt, dass Astro/Vite NICHTS inlinet:
  //  - hoisted <script> werden IMMER als externe, same-origin Module ausgegeben
  //    (Astro inlinet sonst kleine, import-lose Single-Consumer-Skripte als
  //    <script type="module">…</script> -> unter der strikten CSP
  //    default-src 'self' (kein script-src 'unsafe-inline') blockiert).
  //  - Assets werden nie als data:-URL eingebettet -> die CSP erlaubt KEIN
  //    data: (Sicherheits-Leitplanke 3). Beides bleibt damit CSP-konform.
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
