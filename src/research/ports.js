// Recherche-Ports: Vertraege fuer Wissensbeschaffung. AL-P10 hat genau einen Adapter
// (Anthropics serverseitiges web_search im bestehenden src/llm.js-Seam). Reine
// JSDoc-Typdefs, keine Laufzeit-Logik.
//
// AUSDRUECKLICH: der In-Call-Adapter aus AL-P10b (look_up, eigener HTTP-Client mit
// API-Key) hat einen ANDEREN Vertrag - er fuehrt die Suche selbst aus und liefert
// Treffer zurueck, waehrend der Vorab-Adapter dem Modell nur ein Werkzeug beistellt.
// Sein Typedef steht unten (AL-P10b). Geteilt wird die Registry-Tabelle, nicht eine
// erzwungene Einheits-Signatur.

/**
 * @typedef {Object} PrecallResearchProvider
 * @property {() => object[]} researchTools
 *   Werkzeug-Definitionen, die dem briefenden Modell-Aufruf beigestellt werden.
 *   Rein (N7), kein IO - die Suche fuehrt der Anbieter INNERHALB des Modell-Aufrufs aus.
 * @property {(providerTurn: *) => number|null} searchCount
 *   Tatsaechlich ausgefuehrte Suchen aus der OPAKEN Ruecktrage der Modellrunde
 *   (LlmTurn.providerTurn, llm/ports.js) - NICHT aus LlmTokenUsage: die neutrale
 *   Verbrauchsform kennt bewusst nur vier Token-Sorten, ein serverseitiger Such-Zaehler
 *   ist keine davon. Kaeme hier die neutrale Form an, lieferte jeder Adapter dauerhaft
 *   null und der Aufrufer buchte JEDES Briefing mit dem harten Deckel.
 *   null = unbekannt (Anbieter meldet den Zaehler nicht) -> der Aufrufer bucht
 *   pessimistisch.
 */

/**
 * @typedef {Object} InCallSearchProvider
 * @property {(req: {query: string, timeoutMs: number}) =>
 *            Promise<{ok: true, facts: string[]}|{ok: false, reason: string}>} searchFacts
 *   Fuehrt die Suche SELBST aus (eigener HTTP-Client, eigenes Secret). Wirft NIE -
 *   jeder Fehler ist {ok:false,reason}; ein Suchausfall darf keinen Anruf toeten.
 *   facts sind ROHE Anbieter-Strings; die Saeuberung macht lookup-guard.js (der Port
 *   verlaesst sich NICHT auf die Disziplin eines Adapters).
 */
