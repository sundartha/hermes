// IEL-B9 (E13): Import-Spion fuer Kindprozesse (node --import test/_import-spion-store.mjs).
// Schreibt SPION_MARKE nach stderr, sobald irgendein Modul src/store.js aufloest. Belegt so,
// dass ein Skriptmodus den Store nie laedt - nur zusammen mit der Positiv-Kontrolle (ein Modus,
// der ihn laedt, zeigt die Marke), sonst saehe "sucht nichts" aus wie "nichts gefunden".
import { registerHooks } from "node:module";

export const SPION_MARKE = "IMPORT-SPION src/store.js geladen";
const STORE_MODUL_ENDUNG = "/src/store.js";

registerHooks({
  resolve(spezifizierer, kontext, weiter) {
    const ergebnis = weiter(spezifizierer, kontext);
    if (ergebnis.url.endsWith(STORE_MODUL_ENDUNG)) process.stderr.write(`${SPION_MARKE}\n`);
    return ergebnis;
  },
});
