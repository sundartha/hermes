const ANSPRUCH_ANWEISUNG = "UPDATE call SET el_nachlauf_started_at";
const ZURUECK = "ROLLBACK";
const FRISTEN_ABFRAGE = "WITH faellig AS";
const TAKT_KONTEXT = "SELECT set_config('app.current_tenant'";
const ZEITGRENZE_ANWEISUNG = "SELECT set_config('statement_timeout'";
const TAKT_MERKMALE = [FRISTEN_ABFRAGE, TAKT_KONTEXT];
const ANSPRUCH_MERKMALE = [ZEITGRENZE_ANWEISUNG, ANSPRUCH_ANWEISUNG, ZURUECK];

export const anweisungenSeit = (mitschnitt, nr, vorher) => mitschnitt.verbindungen()[nr].slice(vorher[nr]);

export async function warteAufAnspruchsverbindung(mitschnitt, vorher, gehalten) {
  const enthaelt = (nr, merkmale) => anweisungenSeit(mitschnitt, nr, vorher).some((text) => merkmale.some((merkmal) => text.includes(merkmal)));
  const istTakt = (nr) => enthaelt(nr, TAKT_MERKMALE);
  const istAnspruch = (nr) => !istTakt(nr) && enthaelt(nr, ANSPRUCH_MERKMALE);
  await mitschnitt.bisBedingung(() => gehalten.every((nr) => istTakt(nr) || istAnspruch(nr)));
  return gehalten.filter(istAnspruch);
}
