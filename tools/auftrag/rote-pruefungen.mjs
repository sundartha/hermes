import { zustaendig, zweckIds } from "./zweck.mjs";

export const ROTE_PRUEFUNGEN = "Rote Prüfungen laut Skript:";
const KOPF = "| ";
const BELEGZEILE = "|   ";
const OHNE_SCHRITT = "ohne roten Prüfschritt";
const KOPFZEILE = /^\| (Runde \d+: .+), Zweck-ID (.+)$/;
const AUFTRAGS_TRAILER = /^Auftrag: \S+\/\S+$/m;
const ID_TRENNER = ", ";

export function rotePruefungen(pruefungen) {
  return pruefungen.filter(({ exitCode }) => exitCode !== 0);
}

export function zweckIdsDer({ name, zeilen, zweck }) {
  return zweck ?? zweckIds({ name, zeilen });
}

export function roteRunde({ runde, grund, pruefungen, roteIds = [], agenten = [] }) {
  const letzteRolle = agenten.at(-1)?.rolle;
  const schritte = rotePruefungen(pruefungen)
    .map(({ name, exitCode, zeilen = [], zweck }) => ({ name, exitCode, zeilen, ids: zweckIdsDer({ name, zeilen, zweck }), rolle: zustaendig(name, letzteRolle) }))
    .filter(({ ids }) => ids.length > 0);
  const gezeigt = new Set(schritte.flatMap(({ ids }) => ids));
  const ohneSchritt = [...new Set(roteIds)].filter((id) => !gezeigt.has(id)).map((id) => ({ id, rolle: zustaendig(id, letzteRolle) }));
  return { runde, grund, schritte, ohneSchritt };
}

export function idsDer({ schritte, ohneSchritt }) {
  return [...new Set([...schritte.flatMap(({ ids }) => ids), ...ohneSchritt.map(({ id }) => id)])];
}

export function pflichtDer(runden) {
  return runden.flatMap(({ schritte, ohneSchritt }) => [
    ...schritte.flatMap(({ ids, rolle }) => ids.map((id) => ({ id, rolle }))),
    ...ohneSchritt,
  ]).filter(({ rolle }) => rolle !== null);
}

function rundenZeilen({ runde, grund, schritte, ohneSchritt }) {
  return [
    ...schritte.flatMap(({ name, exitCode, zeilen, ids }) => [`${KOPF}Runde ${runde}: ${name}, Exit ${exitCode}, Zweck-ID ${ids.join(ID_TRENNER)}`, ...zeilen.map((zeile) => `${BELEGZEILE}${zeile}`)]),
    ...ohneSchritt.flatMap(({ id }) => [`${KOPF}Runde ${runde}: ${OHNE_SCHRITT}, Zweck-ID ${id}`, `${BELEGZEILE}${grund}`]),
  ];
}

export function roterAbschnitt(runden) {
  const zeilen = runden.flatMap(rundenZeilen);
  return zeilen.length > 0 ? [ROTE_PRUEFUNGEN, ...zeilen, ""] : [];
}

function abschnittDer(nachricht) {
  const zeilen = nachricht.split("\n");
  const anfang = zeilen.indexOf(ROTE_PRUEFUNGEN);
  if (anfang === -1) return [];
  const rest = zeilen.slice(anfang + 1);
  const ende = rest.findIndex((zeile) => !zeile.startsWith(KOPF.trimEnd()));
  return ende === -1 ? rest : rest.slice(0, ende);
}

export function roteAusNachricht(nachricht) {
  if (!AUFTRAGS_TRAILER.test(nachricht)) return null;
  const eintraege = [];
  for (const zeile of abschnittDer(nachricht)) {
    const kopf = KOPFZEILE.exec(zeile);
    if (kopf !== null) eintraege.push({ kopf: kopf[1], ids: kopf[2].split(ID_TRENNER), belege: [] });
    else if (zeile.startsWith(BELEGZEILE)) eintraege.at(-1)?.belege.push(zeile.slice(BELEGZEILE.length));
  }
  return eintraege;
}
