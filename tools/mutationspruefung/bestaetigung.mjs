const ROTER_TEST = "Killed";
const UEBERLEBT = "Survived";
const ABBRUCH = new Set(["Timeout", "RuntimeError", "CompileError"]);
const OHNE_ERGEBNIS = { status: "ohne Ergebnis", toeter: [] };
const LAUFNAMEN = ["erster Lauf", "Bestätigungslauf", "dritter Lauf"];
const BESTAETIGT = "getoetet";
const HAENGER = "haenger";
const NICHT_BESTAETIGT = "Hinweis: im Bestätigungslauf nicht bestätigt, Mutant zählt als überlebt";
const NUR_HAENGER = "Hinweis: nur durch Zeitablauf oder Absturz erkannt, in beiden Läufen; nicht bestätigt getötet";
const WACKELT = "Hinweis: Testdatei wackelt bei diesem Mutanten, bestätigt getötet durch";

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

function anlauf({ ohne, verlauf }) {
  return ohne.length === 0 ? beschreibung(verlauf) : `ohne ${ohne.join(" ")}: ${beschreibung(verlauf)}`;
}

function laeufe(beobachtungen) {
  return beobachtungen.map(anlauf).join("; ");
}

function erkannt({ verlauf: [erster] }) {
  return roterTest(erster) || abgebrochen(erster);
}

function massgeblich(verlauf) {
  const [erster, zweiter = OHNE_ERGEBNIS, dritter] = verlauf;
  return dritter === undefined ? [erster, zweiter] : [zweiter, dritter];
}

function wackelnd(verlauf) {
  const [rot, wiederholung] = massgeblich(verlauf);
  return roterTest(rot) && !dieselbeDatei(rot, wiederholung) ? rot.toeter[0] : undefined;
}

export function unentschieden(verlauf) {
  const [erster, zweiter, dritter] = verlauf;
  if (zweiter === undefined) return roterTest(erster) || abgebrochen(erster);
  return dritter === undefined && abgebrochen(erster) && roterTest(zweiter);
}

export function entscheide(eintrag, verlauf) {
  const [erster, zweiter = OHNE_ERGEBNIS] = verlauf;
  if (!roterTest(erster) && !abgebrochen(erster)) return eintrag;
  if (abgebrochen(erster) && abgebrochen(zweiter)) {
    return { ...eintrag, bestaetigung: HAENGER, hinweis: `${NUR_HAENGER}: ${eintrag.schluessel}` };
  }
  if (dieselbeDatei(...massgeblich(verlauf))) return { ...eintrag, bestaetigung: BESTAETIGT };
  return { ...eintrag, status: UEBERLEBT, hinweis: `${NICHT_BESTAETIGT} (${beschreibung(verlauf)}): ${eintrag.schluessel}` };
}

export function bestaetigt({ bestaetigung }) {
  return bestaetigung === BESTAETIGT;
}

export function bilanz(ergebnisse) {
  const anzahl = (art) => ergebnisse.filter(({ bestaetigung }) => bestaetigung === art).length;
  return `${anzahl(BESTAETIGT)} bestätigt getötet, ${anzahl(HAENGER)} nur durch Zeitablauf oder Absturz erkannt`;
}

function wackelHinweis({ schluessel }, beobachtungen) {
  const [rot] = massgeblich(beobachtungen.at(-1).verlauf);
  return `${WACKELT} ${rot.toeter[0]} (${laeufe(beobachtungen.slice(0, -1))}): ${schluessel}`;
}

function urteil(eintrag, beobachtungen) {
  const { verlauf } = beobachtungen.at(-1);
  if (beobachtungen.length === 1) return entscheide(eintrag, verlauf);
  const [{ status, toeter }] = verlauf;
  const letztes = entscheide({ ...eintrag, status, toeter }, verlauf);
  if (bestaetigt(letztes)) return { ...letztes, hinweis: wackelHinweis(eintrag, beobachtungen) };
  if (letztes.bestaetigung === HAENGER) return letztes;
  return { ...eintrag, status: UEBERLEBT, hinweis: `${NICHT_BESTAETIGT} (${laeufe(beobachtungen.filter(erkannt))}): ${eintrag.schluessel}` };
}

function bestaetigungslauf(beobachtung) {
  const [datei] = beobachtung.verlauf.at(-1).toeter;
  const tests = datei === undefined ? beobachtung.tests : [datei];
  return { tests, ablegen: (ergebnis) => beobachtung.verlauf.push(ergebnis) };
}

function ohneWackler(beobachtungen) {
  const { tests = [], ohne, verlauf } = beobachtungen.at(-1);
  const datei = wackelnd(verlauf);
  const uebrige = tests.filter((test) => test !== datei);
  if (!tests.includes(datei) || uebrige.length === 0) return [];
  const neu = (ergebnis) => ({ tests: uebrige, ohne: [...ohne, datei], verlauf: [ergebnis] });
  return [{ tests: uebrige, ablegen: (ergebnis) => beobachtungen.push(neu(ergebnis)) }];
}

function naechsterLauf(beobachtungen) {
  const letzte = beobachtungen.at(-1);
  return unentschieden(letzte.verlauf) ? [bestaetigungslauf(letzte)] : ohneWackler(beobachtungen);
}

function nachTests(auftraege) {
  const auswahl = new Map();
  for (const auftrag of auftraege) {
    const schluessel = JSON.stringify(auftrag.tests);
    auswahl.set(schluessel, [...(auswahl.get(schluessel) ?? []), auftrag]);
  }
  return [...auswahl.values()];
}

async function wiederhole(auftraege, nachlauf) {
  for (const gleiche of nachTests(auftraege)) {
    const neu = await nachlauf({ zeilen: gleiche.map(({ eintrag }) => eintrag.zeilen), tests: gleiche[0].tests });
    const nachSchluessel = new Map(neu.map((eintrag) => [eintrag.schluessel, eintrag]));
    for (const { eintrag, ablegen } of gleiche) ablegen(nachSchluessel.get(eintrag.schluessel) ?? OHNE_ERGEBNIS);
  }
}

export async function bestaetige(ergebnisse, nachlauf, tests) {
  const beobachtungen = new Map(ergebnisse.map((eintrag) => [eintrag.schluessel, [{ tests, ohne: [], verlauf: [eintrag] }]]));
  const auftraege = () =>
    ergebnisse.flatMap((eintrag) => naechsterLauf(beobachtungen.get(eintrag.schluessel)).map((lauf) => ({ ...lauf, eintrag })));
  for (let runde = auftraege(); runde.length > 0; runde = auftraege()) await wiederhole(runde, nachlauf);
  return ergebnisse.map((eintrag) => urteil(eintrag, beobachtungen.get(eintrag.schluessel)));
}
