// In-Call-Such-Adapter: Exa (Owner-Entscheidung 2026-08-01, AL-P10c). Loest den nie live
// gelaufenen Vorgaenger-Adapter ERSATZLOS ab - zwei Adapter fuer denselben Platz waeren
// toter Code (CLAUDE.md); die Vorgeschichte steht in PLAN-SECURITY.md und
// tasks/assistant-leap-chain.md. ANDERER Vertrag als der Vorab-Adapter (ports.js): dieser
// fuehrt die Suche SELBST aus.
// PREIS DAFUER, bewusst und dokumentiert (README + PLAN-SECURITY): ein neues Secret und ein
// ZWEITER Auftragsverarbeiter - die Randbedingung im Kopf von src/precall-briefing.js gilt
// fuer diesen Pfad nicht mehr.
//
// API-FORM NACHGESCHLAGEN, NICHT GERATEN (Anbieter-Doku exa.ai/docs/reference/search,
// abgerufen 2026-08-01): POST <base>/search, Auth-Header x-api-key, JSON-Body
// {query,type,numResults,contents}, Antwort {results:[{title,url,highlights[]}]}. Geratene
// Feldnamen haben in diesem Repo schon einmal 297 von 297 Belegen wertlos gemacht.
//
// Wirft NIE (Muster src/tts/synth.js): jeder Fehler ist {ok:false,reason} - eine Suchstoerung
// darf keinen laufenden Anruf toeten. Der API-Key wird NIE geloggt und NIE in reason
// zurueckgegeben (Regel 4).
import { config } from "../../config.js";
import { LOOKUP_MAX_FACTS } from "../lookup-guard.js";

const SEARCH_PATH = "/search";

// Dokumentierter Default-Suchtyp, explizit gesetzt statt auf einen Anbieter-Default
// vertraut. BEWUSST nicht "fast"/"instant" (Doku: ~450 bzw. ~250 ms statt ~1 s): deren
// Zusammenspiel mit contents ist NICHT dokumentiert, und diese Phase raet keine API-Form.
// ~1 s liegt sicher unter LOOKUP_TIMEOUT_MS; eine Umstellung ist eine gemessene Entscheidung.
const SEARCH_TYPE = "auto";

// Ein Treffer wird zu EINER Zeile "Titel: Auszug". Bewusst OHNE URL: der Prompt verbietet die
// Quellennennung (loc.prompt.thinkingSignal / lookUpResult), eine URL im HINTERGRUND waere
// genau die Einladung dazu - und ein Angriffsvektor mehr.
function factLineOf(result) {
  return [result?.title, result?.highlights?.[0]].filter(Boolean).join(": ");
}

/** @type {import("../ports.js").InCallSearchProvider} */
export const exaSearch = {
  async searchFacts({ query, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${config.research.exaApiBase}${SEARCH_PATH}`, {
        method: "POST",
        headers: {
          "x-api-key": config.research.exaApiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        // numResults NICHT als eigene Zahl (G5/G25): so viele Treffer holen, wie
        // lookupFactsFrom durchlaesst - mehr waere bezahlter Muell, weniger waere Verlust.
        // Die Suchgebuehr ist gegen genau diese Zahl hergeleitet (AL-P10c-3 verriegelt das).
        // contents.highlights = query-relevante Auszuege; contents.text waere die ganze Seite
        // bei gleichem Seitenpreis (mehr Egress, mehr Injektionsflaeche, mehr Latenz).
        body: JSON.stringify({
          query,
          type: SEARCH_TYPE,
          numResults: LOOKUP_MAX_FACTS,
          contents: { highlights: true },
        }),
        signal: controller.signal,
      });
      // Kein Body, kein Key im Grund-Code: der Anbieter spiegelt bei 4xx gern die Anfrage
      // (und damit die Query) zurueck - die hat in keinem Log etwas verloren.
      if (!res.ok) return { ok: false, reason: `http_${res.status}` };
      const body = await res.json();
      return { ok: true, facts: (body?.results ?? []).map(factLineOf).filter(Boolean) };
    } catch (err) {
      return { ok: false, reason: err && err.name === "AbortError" ? "timeout" : "error" };
    } finally {
      clearTimeout(timer);
    }
  },
};
