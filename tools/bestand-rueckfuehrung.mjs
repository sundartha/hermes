import { pfadAusSchluessel } from "./eslint-rules/bestand.js";
import { umbenennungen } from "./umbenennung.mjs";

const TRENNER = "|";

export function unveraendert(pfad) {
  return pfad;
}

export async function rueckfuehrung(basis) {
  const { nurTypen } = await umbenennungen({ von: basis });
  return (pfad) => nurTypen(pfad) ?? pfad;
}

export function pfadZurueck(schluessel, zurueck) {
  const pfad = pfadAusSchluessel(schluessel);
  return `${zurueck(pfad)}${schluessel.slice(pfad.length)}`;
}

export function teilZurueck(stelle) {
  return (schluessel, zurueck) =>
    schluessel
      .split(TRENNER)
      .map((teil, index) => (index === stelle ? zurueck(teil) : teil))
      .join(TRENNER);
}

export function paarZurueck(anzahl) {
  return (schluessel, zurueck) => {
    const teile = schluessel.split(TRENNER);
    const pfade = teile.slice(0, anzahl).map(zurueck).sort();
    return [...pfade, ...teile.slice(anzahl)].join(TRENNER);
  };
}

export function gezaehlt(eintraege) {
  const anzahl = new Map();
  for (const eintrag of eintraege) anzahl.set(eintrag, (anzahl.get(eintrag) ?? 0) + 1);
  return anzahl;
}

export function aufgeteilt(eintraege, erlaubt, schluesselVon) {
  const uebrig = gezaehlt(erlaubt);
  const innerhalb = [];
  const darueber = [];
  for (const eintrag of eintraege) {
    const schluessel = schluesselVon(eintrag);
    const frei = uebrig.get(schluessel) ?? 0;
    uebrig.set(schluessel, frei - 1);
    if (frei > 0) innerhalb.push(eintrag);
    else darueber.push(eintrag);
  }
  return { innerhalb, darueber };
}

export function gewachsen({ jetzt, vorher, zurueck }) {
  return aufgeteilt(jetzt, vorher, zurueck).darueber.map((schluessel) => ({
    schluessel,
    alt: zurueck(schluessel),
  }));
}
