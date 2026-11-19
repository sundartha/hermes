const ANSPRUCH_ANWEISUNG = "UPDATE call SET el_nachlauf_started_at";
const ZURUECK = "ROLLBACK";
const FRISTEN_ABFRAGE = "WITH faellig AS";
const TAKT_SCHREIBZIEL = "UPDATE call SET frist_";
const TAKT_KONTEXT = "SELECT set_config('app.current_tenant'";
const ZEITGRENZE_ANWEISUNG = "SELECT set_config('statement_timeout'";
const TAKT_MERKMALE = [FRISTEN_ABFRAGE, TAKT_SCHREIBZIEL];
const ANSPRUCH_MERKMALE = [ANSPRUCH_ANWEISUNG, ZURUECK];

export const anweisungenSeit = (mitschnitt, nr, vorher) => mitschnitt.verbindungen()[nr].slice(vorher[nr]);

export async function warteAufAnspruchsverbindung(mitschnitt, vorher, gehalten) {
  const enthaelt = (nr, merkmale) => anweisungenSeit(mitschnitt, nr, vorher).some((text) => merkmale.some((merkmal) => text.includes(merkmal)));
  const istKontextOhneZeitgrenze = (nr) => enthaelt(nr, [TAKT_KONTEXT]) && !enthaelt(nr, [ZEITGRENZE_ANWEISUNG]);
  const istTakt = (nr) => enthaelt(nr, TAKT_MERKMALE) || istKontextOhneZeitgrenze(nr);
  const istFremd = (nr) => !istTakt(nr) && enthaelt(nr, [ZEITGRENZE_ANWEISUNG]) && !enthaelt(nr, [ANSPRUCH_ANWEISUNG]);
  const istAnspruch = (nr) => !istTakt(nr) && !istFremd(nr) && enthaelt(nr, ANSPRUCH_MERKMALE);
  await mitschnitt.bisBedingung(() => gehalten.every((nr) => istTakt(nr) || istFremd(nr) || istAnspruch(nr)));
  return gehalten.filter(istAnspruch);
}
