// OUTBOUND-E4 Review-Blocker Runde 2 (Blocker 3, zweite Haelfte): die deklarierten
// Ausnahmen (outbound-drift-ausnahmen.json) wurden AUSSCHLIESSLICH vom externen CLI-Weg
// (scripts/check-outbound-drift.mjs) geladen - der In-Prozess-Waechter
// (outbound-drift-watch.js) rief beurteileDrift() ohne ausnahmen auf, wodurch
// befund.ausgenommen dort strukturell IMMER false blieb, obwohl der Kern (outbound-
// config-drift.js) das Feld schon immer auswertet ("if (befund.ausgenommen) continue;").
// EINE Quelle fuer BEIDE Wege (G5) - dasselbe Prinzip, das outbound-config-soll.js fuer
// die Soll-Projektion bereits umsetzt.
//
// EIGENE Datei statt in outbound-config-soll.js: jenes Modul ist ausdruecklich als "kein
// Netz, kein store, kein Date.now" dokumentiert - ein Dateisystemzugriff HIER wuerde
// diesen Vertrag verletzen.
import { readFileSync } from "node:fs";

const AUSNAHMEN_PFAD = new URL("../../outbound-drift-ausnahmen.json", import.meta.url);

// Fehlende Datei -> keine Ausnahmen (kein Fehler): ein frischer Checkout ohne die Datei
// soll nicht scheitern, er hat dann nur mehr blockierende/gemeldete Befunde. Der Kern
// selbst (ausnahmeFehler) prueft jeden Eintrag trotzdem auf Pflichtfelder (grund/seit).
export function ladeAusnahmen() {
  try {
    const roh = readFileSync(AUSNAHMEN_PFAD, "utf8");
    return JSON.parse(roh);
  } catch {
    return [];
  }
}
