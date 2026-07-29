// Recherche-Ports: Vertraege fuer Wissensbeschaffung. AL-P10 hat genau einen Adapter
// (Anthropics serverseitiges web_search im bestehenden src/llm.js-Seam). Reine
// JSDoc-Typdefs, keine Laufzeit-Logik.
//
// AUSDRUECKLICH: der In-Call-Adapter aus AL-P10b (look_up, eigener HTTP-Client mit
// API-Key) hat einen ANDEREN Vertrag - er fuehrt die Suche selbst aus und liefert
// Treffer zurueck, waehrend der Vorab-Adapter dem Modell nur ein Werkzeug beistellt.
// Sein Typedef entsteht mit seiner Phase; ein hier auf Vorrat deklarierter Typ waere
// toter Code. Geteilt wird die Registry-Tabelle, nicht eine erzwungene Einheits-Signatur.

/**
 * @typedef {Object} PrecallResearchProvider
 * @property {() => object[]} researchTools
 *   Werkzeug-Definitionen, die dem briefenden Modell-Aufruf beigestellt werden.
 *   Rein (N7), kein IO - die Suche fuehrt der Anbieter INNERHALB des Modell-Aufrufs aus.
 * @property {(usage: object|undefined) => number|null} searchCount
 *   Tatsaechlich ausgefuehrte Suchen aus der Antwort-usage. null = unbekannt
 *   (Anbieter meldet den Zaehler nicht) -> der Aufrufer bucht pessimistisch.
 */
