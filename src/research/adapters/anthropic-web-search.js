// Vorab-Recherche-Adapter: Anthropics SERVERSEITIGES web_search. Die Suche laeuft
// INNERHALB des Modell-Aufrufs (src/llm.js-Seam) - kein eigener HTTP-Client, kein
// neues Secret, kein zweiter Auftragsverarbeiter (Plan-Randbedingung, Kopf von
// src/precall-briefing.js).
//
// Tool-Version bewusst die BASIS-Variante: die neuere Variante mit dynamischer
// Filterung zieht serverseitige Code-Ausfuehrung nach sich (Zusatzlatenz in einem
// 6-s-Fenster, s. config.llm.briefingTimeoutMs) und ist modellgebunden, waehrend
// PRECALL_BRIEFING_MODEL frei setzbar ist. Ein Wechsel ist eine Zeile hier.
import { config } from "../../config.js";

const WEB_SEARCH_TOOL_TYPE = "web_search_20250305"; // G25
const WEB_SEARCH_TOOL_NAME = "web_search";

/** @type {import("../ports.js").PrecallResearchProvider} */
export const anthropicWebSearch = {
  researchTools: () => [
    {
      type: WEB_SEARCH_TOOL_TYPE,
      name: WEB_SEARCH_TOOL_NAME,
      max_uses: config.research.researchMaxUses,
    },
  ],
  // Gegenprobe fuer die Gebuehrenbuchung. Fehlt das Feld, ist der Zaehler UNBEKANNT
  // (null) - NICHT 0. Der Aufrufer bucht dann pessimistisch (Regel 1).
  searchCount: (usage) => usage?.server_tool_use?.web_search_requests ?? null,
};
