// IEX-A3 (E3/A2): Riegel der Inbound-Eroeffnung. Fail-closed: jede Abweichung ist ein Defekt.
// Kein Vergleich "Text == Builder-Ausgabe" (tautologisch) - geprueft werden die Bausteine, die
// der Anrufer hoeren MUSS. Liefert nur Defekt-Namen, nie Werte (Regel 4).
//
// startsWith/includes statt Regex: Sonderzeichen im Namen loesen keinen Fehlalarm aus. Ein
// Bundle ohne inboundNameSatz wirft einen TypeError - ebenfalls fail-closed (die Route antwortet
// dann mit 500, ohne Bindung).
import { hasInboundNotice } from "./inbound-notice.js";
// EINE Quelle fuer die Platzhalter-Syntax des Anbieters (G5); reine Konstante.
import { PLACEHOLDER_OPENER } from "../elevenlabs/outbound.js";

export const EROEFFNUNG_DEFEKT = Object.freeze({
  NAMENSSATZ_FEHLT: "namenssatz_fehlt", // (a)
  HINWEIS_WORTLAUT_FEHLT: "hinweis_wortlaut_fehlt", // (b)
  HINWEIS_MERKMALE_FEHLEN: "hinweis_merkmale_fehlen", // (c)
  PLATZHALTER: "platzhalter", // (d)
});

// Nicht-String zaehlt als leerer Text -> (a)(b)(c) schlagen an, kein Wurf.
const alsText = (wert) => (typeof wert === "string" ? wert : "");

const PRUEFUNGEN = Object.freeze([
  [EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT, ({ text, bundle, ownerName }) => !text.startsWith(bundle.inboundNameSatz(ownerName))],
  [EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT, ({ text, bundle }) => !text.includes(bundle.inboundNotice)],
  [EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN, ({ text }) => !hasInboundNotice(text)],
  [EROEFFNUNG_DEFEKT.PLATZHALTER, ({ text }) => text.includes(PLACEHOLDER_OPENER)],
]);

/** @returns {string[]} Defekt-Namen in fester Reihenfolge; [] = sicher */
export function inboundEroeffnungDefekte({ text, bundle, ownerName }) {
  const eingabe = { text: alsText(text), bundle, ownerName };
  return PRUEFUNGEN.filter(([, defekt]) => defekt(eingabe)).map(([name]) => name);
}
