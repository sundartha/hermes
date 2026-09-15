// @ts-check
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

// Vite haelt seinen Dep-Optimizer-Cache in genau EINEM Ordner je Projekt,
// naemlich node_modules/.vite, und tauscht ihn zum Schluss per rename gegen
// das fertige Unterverzeichnis deps aus. Astros Build startet fuer den
// sync-Schritt intern einen Vite-Dev-Server und loest damit genau dieses
// rename aus. Laufen zwei Builds gleichzeitig, gewinnt einer das rename und
// der andere bricht bei kaltem Cache mit ENOTEMPTY ab.
//
// Genau das passierte in den Tests: csp, pages und links starten je einen
// eigenen astro-Build, und node --test faehrt die Testdateien parallel.
// Gemessen waren 6 von 25 Laeufen aus kaltem Cache rot, aus warmem Cache
// keiner - daher die scheinbar zufaelligen Ausfaelle.
//
// Das CLI-Flag --outDir trennt nur die AUSGABE, nicht diesen Cache. Deshalb
// haengt der Cache hier am outDir: wer ein eigenes Ziel baut, bekommt auch
// einen eigenen Cache-Ordner. Dieser Hook ist der einzige Ort, an dem der
// bereits mit den CLI-Flags verrechnete outDir sichtbar ist.
/** @type {import("astro").AstroIntegration} */
const viteCacheJeOutDir = {
  name: "vite-cache-je-outdir",
  hooks: {
    "astro:config:setup": ({ config, updateConfig }) => {
      const ziel = basename(fileURLToPath(config.outDir));
      const cacheDir = new URL(`./node_modules/.vite-${ziel}/`, config.root);
      updateConfig({ vite: { cacheDir: fileURLToPath(cacheDir) } });
    },
  },
};

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
  integrations: [viteCacheJeOutDir],
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
