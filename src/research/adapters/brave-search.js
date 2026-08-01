// In-Call-Such-Adapter: Brave Search (Owner-Betriebserfahrung, AL-P10b). ANDERER
// Vertrag als der Vorab-Adapter (ports.js): dieser fuehrt die Suche SELBST aus.
// PREIS DAFUER, bewusst und dokumentiert (README + PLAN-SECURITY): ein neues Secret
// und ein ZWEITER Auftragsverarbeiter - die Randbedingung im Kopf von
// src/precall-briefing.js gilt fuer diesen Pfad nicht mehr.
//
// Wirft NIE (Muster src/tts/synth.js): jeder Fehler ist {ok:false,reason} - eine
// Suchstoerung darf keinen laufenden Anruf toeten. Der API-Key wird NIE geloggt und
// NIE in reason zurueckgegeben (Regel 4).
import { config } from "../../config.js";

const SEARCH_PATH = "/res/v1/web/search";
// G25: so viele Treffer holt EINE Anfrage. Gleichstand mit der Obergrenze, die
// lookupFactsFrom durchlaesst (LOOKUP_MAX_FACTS) - mehr zu holen waere bezahlter Muell.
const RESULT_COUNT = 3;

// Ein Treffer wird zu EINER Zeile "Titel: Beschreibung". Bewusst OHNE URL: der Prompt
// verbietet die Quellennennung (loc.prompt.thinkingSignal / lookUpResult), eine URL im
// HINTERGRUND waere genau die Einladung dazu - und ein Angriffsvektor mehr.
function factLineOf(result) {
  return [result?.title, result?.description].filter(Boolean).join(": ");
}

/** @type {import("../ports.js").InCallSearchProvider} */
export const braveSearch = {
  async searchFacts({ query, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${config.research.braveSearchApiBase}${SEARCH_PATH}?q=${encodeURIComponent(query)}&count=${RESULT_COUNT}`;
      const res = await fetch(url, {
        headers: {
          "X-Subscription-Token": config.research.braveSearchApiKey,
          accept: "application/json",
        },
        signal: controller.signal,
      });
      // Kein Body, kein Key im Grund-Code: der Anbieter spiegelt bei 4xx gern die Anfrage
      // (und damit die Query) zurueck - die hat in keinem Log etwas verloren.
      if (!res.ok) return { ok: false, reason: `http_${res.status}` };
      const body = await res.json();
      return { ok: true, facts: (body?.web?.results ?? []).map(factLineOf).filter(Boolean) };
    } catch (err) {
      return { ok: false, reason: err && err.name === "AbortError" ? "timeout" : "error" };
    } finally {
      clearTimeout(timer);
    }
  },
};
