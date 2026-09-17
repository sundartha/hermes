// IEX-A3 (E3/A2): Riegel der Inbound-Eroeffnung. Fail-closed: jede Abweichung ist ein Defekt.
// Kein Vergleich "Text == Builder-Ausgabe" (tautologisch) - geprueft werden die Bausteine, die
// der Anrufer hoeren MUSS. Liefert nur Defekt-Namen, nie Werte (Regel 4).
//
// startsWith/includes statt Regex: Sonderzeichen im Namen loesen keinen Fehlalarm aus. Ein
// Bundle ohne den Sollkopf-Baustein wirft einen TypeError - ebenfalls fail-closed (die Route
// antwortet dann mit 500, ohne Bindung).
//
// Die Defekt-Kennung `namenssatz_fehlt` bleibt - sie benennt weiterhin den fehlenden
// Pflicht-Kopfsatz; eine Umbenennung aenderte nur Log-Text und Testnamen.
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

// IEP-P6: ZWEI SOLLFORMEN, KEINE LOCKERUNG. Es wechselt genau EINE Groesse - welcher
// KOPFSATZ Pflicht ist. Hinweis-Wortlaut, Marker-Praedikat und Platzhalter-Riegel gelten
// fuer beide Varianten unveraendert, und der Riegel laeuft weiterhin zweimal (Route Stufe
// 3b und am fertigen Antwort-Koerper).
export const EROEFFNUNG_VARIANTE = Object.freeze({ FREMD: "fremd", OWNER: "owner" });

// Variante -> Sollkopf. Eingefrorene Tabelle statt Verzweigung; eine UNBEKANNTE Variante
// findet keinen Bauer und ergibt ueber kopfsatzFehlt unten einen Defekt (fail-closed).
const SOLL_KOPFSATZ = Object.freeze({
  [EROEFFNUNG_VARIANTE.FREMD]: ({ bundle, ownerName }) => bundle.inboundGrussSatz(ownerName),
  [EROEFFNUNG_VARIANTE.OWNER]: ({ bundle, firstName }) => bundle.inboundGrussSatzOwner(firstName),
});

// LEERER Sollkopf ist ein DEFEKT, kein Freibrief: "".startsWith("") waere true und liesse
// eine Owner-Eroeffnung ohne Vornamen ("Hallo , hier ist ...") durch.
function kopfsatzFehlt({ text, variante, bundle, ownerName, firstName }) {
  const soll = SOLL_KOPFSATZ[variante]?.({ bundle, ownerName, firstName }) ?? "";
  return soll === "" || !text.startsWith(soll);
}

const PRUEFUNGEN = Object.freeze([
  [EROEFFNUNG_DEFEKT.NAMENSSATZ_FEHLT, kopfsatzFehlt],
  [EROEFFNUNG_DEFEKT.HINWEIS_WORTLAUT_FEHLT, ({ text, bundle }) => !text.includes(bundle.inboundHinweisSatz)],
  [EROEFFNUNG_DEFEKT.HINWEIS_MERKMALE_FEHLEN, ({ text }) => !hasInboundNotice(text)],
  [EROEFFNUNG_DEFEKT.PLATZHALTER, ({ text }) => text.includes(PLACEHOLDER_OPENER)],
]);

/** @returns {string[]} Defekt-Namen in fester Reihenfolge; [] = sicher */
export function inboundEroeffnungDefekte({ text, bundle, ownerName, firstName, variante }) {
  const eingabe = { text: alsText(text), bundle, ownerName, firstName, variante };
  return PRUEFUNGEN.filter(([, defekt]) => defekt(eingabe)).map(([name]) => name);
}
