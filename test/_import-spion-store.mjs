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
