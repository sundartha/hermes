import { haengerAnzahl } from "./bestaetigung.mjs";

export const ZEITUEBERSCHREITUNG = "Timeout";

export function zeitablaufZeile(datei, ergebnisse, { erste, laenger }) {
  const zeitablaeufe = ergebnisse.filter(({ status }) => status === ZEITUEBERSCHREITUNG).length;
  const zahlen = `Zeitabläufe ${zeitablaeufe} von ${ergebnisse.length} Mutanten, Hänger oder Abstürze in der Bestätigung ${haengerAnzahl(ergebnisse)}`;
  return `${datei}: ${zahlen}; Zeitgrenze timeoutMS ${erste} s, Bestätigung ${laenger} s`;
}
