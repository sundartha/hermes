const ROTER_TEST = "Killed";
const UEBERLEBT = "Survived";
const ABBRUCH = new Set(["Timeout", "RuntimeError", "CompileError"]);
const OHNE_ERGEBNIS = { status: "ohne Ergebnis", toeter: [] };
const LAUFNAMEN = ["erster Lauf", "Bestätigungslauf", "dritter Lauf"];
const BESTAETIGT = "getoetet";
const HAENGER = "haenger";
const NICHT_BESTAETIGT = "Hinweis: im Bestätigungslauf nicht bestätigt, Mutant zählt als überlebt";
const NUR_HAENGER = "Hinweis: nur durch Zeitablauf oder Absturz erkannt, in beiden Läufen; nicht bestätigt getötet";

function roterTest({ status }) {
  return status === ROTER_TEST;
}

function abgebrochen({ status }) {
  return ABBRUCH.has(status);
}

function dieselbeDatei(rot, wiederholung) {
  return roterTest(rot) && roterTest(wiederholung) && wiederholung.toeter.includes(rot.toeter[0]);
}

function beschreibung(verlauf) {
  return verlauf.map(({ status, toeter }, lauf) => [LAUFNAMEN[lauf], status, ...toeter].join(" ")).join(", ");
}

function unentschieden(verlauf) {
  const [erster, zweiter, dritter] = verlauf;
  if (zweiter === undefined) return roterTest(erster) || abgebrochen(erster);
  return dritter === undefined && abgebrochen(erster) && roterTest(zweiter);
}

function entscheide(eintrag, verlauf) {
  const [erster, zweiter = OHNE_ERGEBNIS, dritter] = verlauf;
  if (!roterTest(erster) && !abgebrochen(erster)) return eintrag;
  if (abgebrochen(erster) && abgebrochen(zweiter)) {
    return { ...eintrag, bestaetigung: HAENGER, hinweis: `${NUR_HAENGER}: ${eintrag.schluessel}` };
  }
  const [rot, wiederholung] = dritter === undefined ? [erster, zweiter] : [zweiter, dritter];
  if (dieselbeDatei(rot, wiederholung)) return { ...eintrag, bestaetigung: BESTAETIGT };
  return { ...eintrag, status: UEBERLEBT, hinweis: `${NICHT_BESTAETIGT} (${beschreibung(verlauf)}): ${eintrag.schluessel}` };
}

export function bestaetigt({ bestaetigung }) {
  return bestaetigung === BESTAETIGT;
}

export function bilanz(ergebnisse) {
  const anzahl = (art) => ergebnisse.filter(({ bestaetigung }) => bestaetigung === art).length;
  return `${anzahl(BESTAETIGT)} bestätigt getötet, ${anzahl(HAENGER)} nur durch Zeitablauf oder Absturz erkannt`;
}

function nachToeter(offen, verlaeufe) {
  const auswahl = new Map();
  for (const eintrag of offen) {
    const [datei] = verlaeufe.get(eintrag.schluessel).at(-1).toeter;
    auswahl.set(datei, [...(auswahl.get(datei) ?? []), eintrag]);
  }
  return auswahl;
}

async function wiederhole(offen, verlaeufe, nachlauf) {
  for (const [datei, eintraege] of nachToeter(offen, verlaeufe)) {
    const tests = datei === undefined ? undefined : [datei];
    const neu = await nachlauf({ zeilen: eintraege.map(({ zeilen }) => zeilen), tests });
    const nachSchluessel = new Map(neu.map((eintrag) => [eintrag.schluessel, eintrag]));
    for (const { schluessel } of eintraege) verlaeufe.get(schluessel).push(nachSchluessel.get(schluessel) ?? OHNE_ERGEBNIS);
  }
}

export async function bestaetige(ergebnisse, nachlauf) {
  const verlaeufe = new Map(ergebnisse.map((eintrag) => [eintrag.schluessel, [eintrag]]));
  const offen = () => ergebnisse.filter(({ schluessel }) => unentschieden(verlaeufe.get(schluessel)));
  for (let runde = offen(); runde.length > 0; runde = offen()) await wiederhole(runde, verlaeufe, nachlauf);
  return ergebnisse.map((eintrag) => entscheide(eintrag, verlaeufe.get(eintrag.schluessel)));
}
