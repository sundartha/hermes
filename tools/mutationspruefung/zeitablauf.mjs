import { haengerAnzahl } from "./bestaetigung.mjs";

export const ZEITUEBERSCHREITUNG = "Timeout";

export function zeitablaufZeile(datei, ergebnisse, { erste, wiederholung }) {
  const zeitablaeufe = ergebnisse.filter(({ status }) => status === ZEITUEBERSCHREITUNG).length;
  const zahlen = `Zeitabläufe ${zeitablaeufe} von ${ergebnisse.length} Mutanten, Hänger oder Abstürze in der Bestätigung ${haengerAnzahl(ergebnisse)}`;
  return `${datei}: ${zahlen}; Zeitgrenze timeoutMS ${erste} s, Wiederholung und Bestätigung ${wiederholung} s`;
}
