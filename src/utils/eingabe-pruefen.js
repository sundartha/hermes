import { lehneEingabeAb } from "./http.ts";

const UNGUELTIGE_EINGABE = "invalid_body";

export function pruefeKoerper(res, { schema, meldung = UNGUELTIGE_EINGABE }, koerper) {
  const ergebnis = schema.safeParse(koerper);
  if (lehneEingabeAb(res, !ergebnis.success, meldung)) return undefined;
  return ergebnis.data;
}

export function pruefeAbfrage(res, regel, werte) {
  return pruefeKoerper(res, regel, werte);
}
