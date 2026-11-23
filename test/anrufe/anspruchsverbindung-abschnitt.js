const ANSPRUCH_ANWEISUNG = "UPDATE call SET el_nachlauf_started_at";
const ZURUECK = "ROLLBACK";
const FRISTEN_ABFRAGE = "WITH faellig AS";
const TAKT_SCHREIBZIEL = "UPDATE call SET frist_";
const TAKT_KONTEXT = "SELECT set_config('app.current_tenant'";
const ZEITGRENZE_ANWEISUNG = "SELECT set_config('statement_timeout'";
const TAKT_MERKMALE = [FRISTEN_ABFRAGE, TAKT_SCHREIBZIEL];
const ANSPRUCH_MERKMALE = [ANSPRUCH_ANWEISUNG, ZURUECK];
const NICHT_GEFUNDEN = -1;
const EINS = 1;

export function anweisungenBisZurueck(mitschnitt, nr, vorher) {
  const seit = mitschnitt.verbindungen()[nr].slice(vorher[nr]);
  const ende = seit.findIndex((text) => text.includes(ZURUECK));
  return ende === NICHT_GEFUNDEN ? seit : seit.slice(0, ende + EINS);
}

export async function warteAufAnspruchsabschnitt(mitschnitt, vorher, gehalten) {
  const enthaelt = (nr, merkmale) => anweisungenBisZurueck(mitschnitt, nr, vorher).some((text) => merkmale.some((merkmal) => text.includes(merkmal)));
  const istKontextOhneZeitgrenze = (nr) => enthaelt(nr, [TAKT_KONTEXT]) && !enthaelt(nr, [ZEITGRENZE_ANWEISUNG]);
  const istTakt = (nr) => enthaelt(nr, TAKT_MERKMALE) || istKontextOhneZeitgrenze(nr);
  const istFremd = (nr) => !istTakt(nr) && enthaelt(nr, [ZEITGRENZE_ANWEISUNG]) && !enthaelt(nr, [ANSPRUCH_ANWEISUNG]);
  const istAnspruch = (nr) => !istTakt(nr) && !istFremd(nr) && enthaelt(nr, ANSPRUCH_MERKMALE);
  await mitschnitt.bisBedingung(() => gehalten.every((nr) => istTakt(nr) || istFremd(nr) || istAnspruch(nr)));
  return gehalten.filter(istAnspruch);
}
