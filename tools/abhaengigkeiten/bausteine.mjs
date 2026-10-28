import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { javascriptPfad } from "../umbenennung.mjs";
import { run } from "./prozess.mjs";

export const KARTE = "tools/bausteine.json";
export const ALLE = "alle";

const QUELLE = /^src\/.*\.[cm]?[jt]s$/;
const TEST = /\.test\.[cm]?[jt]s$|\.d\.ts$/;
const WURZEL = /^src\/[^/]+$/;
const ORDNER_ENDE = "/";
const VORSCHLAEGE = 3;
const LEER = "nichts";

function paar(von, nach) {
  return `${von}\0${nach}`;
}

function bausteinAus(eintrag, schicht) {
  const ordner = eintrag.quellen.filter((quelle) => quelle.endsWith(ORDNER_ENDE));
  const dateien = new Set(eintrag.quellen.filter((quelle) => !quelle.endsWith(ORDNER_ENDE)).map(javascriptPfad));
  const eingaenge = eintrag.eingaenge === ALLE ? ALLE : new Set(eintrag.eingaenge.map(javascriptPfad));
  return { ...eintrag, ordner, dateien, eingaenge, schicht, nutzt: new Set(eintrag.nutzt ?? []) };
}

export function karteAus(roh) {
  const schichtVon = new Map(roh.schichten.flatMap((namen, stufe) => namen.map((name) => [name, stufe])));
  const bausteine = roh.bausteine.map((eintrag) => {
    if (!schichtVon.has(eintrag.baustein)) throw new Error(`${KARTE}: ${eintrag.baustein} steht in keiner Schicht.`);
    return bausteinAus(eintrag, schichtVon.get(eintrag.baustein));
  });
  const altlast = new Set(roh.altlast.map(({ von, nach }) => paar(von, nach)));
  return { bausteine, nachName: new Map(bausteine.map((eintrag) => [eintrag.baustein, eintrag])), altlast };
}

export function zuordnung(karte, pfad) {
  const genannt = karte.bausteine.filter(({ dateien }) => dateien.has(javascriptPfad(pfad)));
  const imOrdner = karte.bausteine.filter(({ ordner }) => ordner.some((anfang) => pfad.startsWith(anfang)));
  const auswahl = genannt.length > 0 ? genannt : imOrdner;
  return auswahl.length === 1 ? { baustein: auswahl[0] } : { kandidaten: auswahl };
}

export function erlaubt(aus, nach) {
  return nach.schicht < aus.schicht || aus.nutzt.has(nach.baustein);
}

function erlaubteNamen(karte, aus) {
  const namen = karte.bausteine.filter((nach) => nach !== aus && erlaubt(aus, nach)).map(({ baustein }) => baustein);
  return namen.length > 0 ? namen.join(", ") : LEER;
}

function vorschlag(karte, pfad, importe) {
  const nutzer = importe.filter(({ nach }) => nach === pfad).map(({ von }) => zuordnung(karte, von).baustein);
  const bekannt = nutzer.filter((eintrag) => eintrag !== undefined && eintrag.importiertJedeDatei !== true);
  if (bekannt.length === 0) return "";
  const { baustein, ordner } = bekannt[0];
  const ort = ordner.length > 0 ? `Ordner ${ordner.join(", ")}` : "ohne eigenen Ordner";
  return ` Sie wird von ${baustein} genutzt (${ort}).`;
}

function zuordnungsBefund(karte, pfad, importe) {
  const { baustein, kandidaten } = zuordnung(karte, pfad);
  if (baustein !== undefined) return [];
  if (kandidaten.length > 1) {
    const namen = kandidaten.map((eintrag) => eintrag.baustein).join(", ");
    return [`Datei ${pfad} trifft in ${KARTE} mehrere Bausteine (${namen}); jede Datei unter src/ gehört zu genau einem.`];
  }
  const ort = WURZEL.test(pfad) ? "Neue Datei direkt in src/" : "Datei ohne Baustein";
  const weg = "Leg sie in den Ordner des Bausteins, zu dessen Zweck sie gehört; hat er keinen passenden Ordner, braucht die Karte vorab einen eigenen, freigegebenen Eintrag.";
  return [`${ort}: ${pfad} gehört zu keinem Baustein in ${KARTE}.${vorschlag(karte, pfad, importe)} ${weg}`];
}

function naheEingaenge(nach, pfad) {
  const alle = [...nach.eingaenge].toSorted();
  const nah = alle.filter((eingang) => dirname(eingang) === dirname(javascriptPfad(pfad)));
  return [...new Set([...nah, ...alle])].slice(0, VORSCHLAEGE).join(", ");
}

function eingangsBefund(karte, { von, nach }, [quelle, ziel]) {
  if (quelle.importiertJedeDatei === true || ziel.eingaenge === ALLE || ziel.eingaenge.has(javascriptPfad(nach))) return [];
  const eingaenge = ziel.eingaenge.size > 0 ? `etwa ${naheEingaenge(ziel, nach)}` : "er hat heute keinen";
  return [
    `${von} → ${nach}: ${nach} ist kein Eingang von ${ziel.baustein}. Importiere über einen Eingang von ${ziel.baustein} (${eingaenge}; alle stehen in ${KARTE}) oder leg die Logik in ${quelle.baustein}.`,
  ];
}

function richtungsBefund(karte, { von, nach }, [quelle, ziel]) {
  if (erlaubt(quelle, ziel) || karte.altlast.has(paar(quelle.baustein, ziel.baustein))) return [];
  return [
    `${von} → ${nach}: ${quelle.baustein} darf ${ziel.baustein} nicht nutzen; Abhängigkeiten gehen nur zu tieferen Bausteinen der Schichtfolge in ${KARTE} (${quelle.baustein} nutzt: ${erlaubteNamen(karte, quelle)}). Leg die Logik in ${quelle.baustein} oder tiefer, oder gib den Wert von ${ziel.baustein} aus hinein.`,
  ];
}

export function bausteinPruefung(karte, { dateien, importe }) {
  const zuordnungen = dateien.flatMap((pfad) => zuordnungsBefund(karte, pfad, importe));
  const eingaenge = [];
  const richtung = [];
  const genutzt = new Set();
  for (const kanteImGraph of importe) {
    const beide = [kanteImGraph.von, kanteImGraph.nach].map((pfad) => zuordnung(karte, pfad).baustein);
    if (beide.includes(undefined) || beide[0] === beide[1]) continue;
    genutzt.add(paar(beide[0].baustein, beide[1].baustein));
    eingaenge.push(...eingangsBefund(karte, kanteImGraph, beide));
    richtung.push(...richtungsBefund(karte, kanteImGraph, beide));
  }
  const behoben = [...karte.altlast].filter((eintrag) => !genutzt.has(eintrag)).length;
  return { zuordnung: zuordnungen, eingaenge: [...new Set(eingaenge)], richtung: [...new Set(richtung)], behoben };
}

export function srcImporte(modules) {
  const alle = modules.flatMap(({ source, dependencies }) =>
    dependencies.map(({ resolved }) => ({ von: source, nach: resolved })),
  );
  const istQuelle = (pfad) => QUELLE.test(pfad) && !TEST.test(pfad);
  return alle.filter(({ von, nach }) => istQuelle(von) && istQuelle(nach));
}

function quelldateien() {
  return run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "src"])
    .stdout.split("\0")
    .filter((pfad) => QUELLE.test(pfad) && !TEST.test(pfad) && existsSync(pfad));
}

function zusammenfassung(roh, { dateien, behoben }) {
  const altlast = `${roh.altlast.length} Bausteinpaare mit Importen gegen die Schichtfolge eingefroren`;
  return `${dateien} Quelldateien in ${roh.bausteine.length} Bausteinen, alle Importe zwischen Bausteinen über Eingänge und in Schichtrichtung; ${altlast} in ${KARTE}, ${behoben} davon ohne Import und können gestrichen werden`;
}

export function bausteinBefunde(modules) {
  const leer = { zuordnung: [], eingaenge: [], richtung: [], zusammenfassung: undefined };
  if (!existsSync(KARTE)) return leer;
  const roh = JSON.parse(readFileSync(KARTE, "utf8"));
  const dateien = quelldateien();
  const ergebnis = bausteinPruefung(karteAus(roh), { dateien, importe: srcImporte(modules) });
  return { ...ergebnis, zusammenfassung: zusammenfassung(roh, { dateien: dateien.length, behoben: ergebnis.behoben }) };
}
