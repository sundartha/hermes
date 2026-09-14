// Stolperdraht fuer den Trockenlauf von scripts/iel-mess.mjs.
//
// Muss als ERSTER Import von iel-mess.mjs stehen: ESM wertet Importe in Reihenfolge aus,
// also ist der Draht scharf, bevor src/config.js oder irgendein Anbieter-Modul geladen
// wird. Im Trockenlauf wirft jeder fetch-Aufruf und wird gezaehlt - "nichts gesendet"
// ist damit eine gemessene Zahl, keine Behauptung.

export const TROCKENLAUF_SCHALTER = "--dry-run";
export const istTrockenlauf = process.argv.includes(TROCKENLAUF_SCHALTER);

const zaehlstand = { netzaufrufe: 0 };

if (istTrockenlauf) {
  globalThis.fetch = () => {
    zaehlstand.netzaufrufe += 1;
    throw new Error("Trockenlauf: fetch ist gesperrt");
  };
}

export function netzaufrufeImTrockenlauf() {
  return zaehlstand.netzaufrufe;
}
