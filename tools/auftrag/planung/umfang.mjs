import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { istTestdatei, pfadIstSauber } from "../format.mjs";
import { abschnitte } from "./abschnitte.mjs";
import { altfunktionenAusPitch, genannteFunktionen, genannteStellen, pruefbareDateien } from "./altfunktionen-vorab.mjs";
import { Kostendeckel, rollenText } from "./deckel.mjs";
import { dateiKarte } from "./funktionsliste.mjs";
import { teilVon } from "./kopfzeile.mjs";
import { loeschEinstiege, loeschmenge } from "./loeschmenge.mjs";
import { PITCH, SICHERHEIT, nummernImOrdner } from "./nummern.mjs";
import { DOKUMENTE, istAltfunktion } from "./schnitt.mjs";

const EXIT_GRUEN = 0;
const EXIT_AUFRUF = 2;
const BYTE_JE_KB = 1024;
const ZEHNTEL = 10;
const JSON_EINRUECKUNG = 2;
const QUELLE = "umfang";
const ZEILENUMBRUCH = /\r?\n/u;
const LISTENZEILE = /^-\s+`([^`\s]+)`$/u;
export const ORDNER_ENDE = "/";
const UMBAU = "Umbau";
export const GEAENDERTE_DATEIEN = "## Geänderte Dateien";
export const GRENZE_SZENARIEN = 8;
export const GRENZE_CODE_DATEIEN = 10;
export const GRENZE_GRUPPEN = 2;
export const GRENZE_BELEG_DATEIEN = 25;

export function gruppenUeberGrenze(anzahl) {
  return anzahl > GRENZE_GRUPPEN;
}

export function dokumenteIm(ordner) {
  return Object.fromEntries(DOKUMENTE.filter((name) => existsSync(join(ordner, name))).map((name) => [name, readFileSync(join(ordner, name), "utf8")]));
}

async function testsAn(root, dateien) {
  if (dateien.length === 0) return [];
  const bericht = { nummern: { [QUELLE]: { aenderungen: dateien.map((datei) => ({ datei })) } } };
  const karte = await dateiKarte(root, [bericht]);
  return [...new Set(karte.flatMap(({ tests }) => tests))].toSorted();
}

function kilobyte(dokumente) {
  const bytes = Object.values(dokumente).reduce((summe, text) => summe + Buffer.byteLength(text), 0);
  return Math.round((bytes / BYTE_JE_KB) * ZEHNTEL) / ZEHNTEL;
}

function stelleIn(dateien) {
  return (stelle) => dateien.includes(stelle.slice(0, stelle.lastIndexOf(":")));
}

async function loeschmengeIn(root, einstiege, dateien) {
  const menge = await loeschmenge(root, einstiege);
  if (dateien === undefined) return menge;
  return { ...menge, dateien: menge.dateien.filter((datei) => dateien.includes(datei)), exporte: menge.exporte.filter(stelleIn(dateien)), reste: menge.reste.filter(stelleIn(dateien)) };
}

export function istOrdner(root, datei) {
  return datei.endsWith(ORDNER_ENDE) || (existsSync(join(root, datei)) && statSync(join(root, datei)).isDirectory());
}

function istListenDatei(root, datei) {
  return pfadIstSauber(datei) && !istOrdner(root, datei);
}

function geaenderteImPitch(root, pitch) {
  const ausschnitt = abschnitte(pitch, [GEAENDERTE_DATEIEN]).abschnitte.get(GEAENDERTE_DATEIEN);
  if (ausschnitt === undefined) return undefined;
  const [, ...zeilen] = ausschnitt.split(ZEILENUMBRUCH);
  const dateien = zeilen.filter((zeile) => zeile.trim() !== "").map((zeile) => LISTENZEILE.exec(zeile.trim())?.[1]);
  return dateien.length > 0 && dateien.every((datei) => datei !== undefined && istListenDatei(root, datei)) ? dateien : undefined;
}

function nachAenderung(pitch, { liste, codeDateien, dateien, loeschen }) {
  const umbau = altfunktionenAusPitch(pitch).eintraege.filter(({ art }) => art === UMBAU).map(({ datei }) => datei);
  const geaenderteDateien = [...new Set([...liste, ...umbau])].filter((datei) => dateien === undefined || dateien.includes(datei)).toSorted();
  return { geaenderteDateien, belegDateien: codeDateien.filter((datei) => !geaenderteDateien.includes(datei) && !loeschen.includes(datei)) };
}

export async function umfang(root, ordner, { dateien } = {}) {
  const dokumente = dokumenteIm(ordner);
  const genannt = genannteStellen(dokumente);
  const stellen = dateien === undefined ? genannt : genannt.filter(({ datei }) => dateien.includes(datei));
  const belegt = pruefbareDateien(root, dateien ?? stellen.map(({ datei }) => datei));
  const codeDateien = belegt.filter((datei) => !istTestdatei(datei));
  const funktionen = genannteFunktionen(root, stellen);
  const pitch = dokumente[PITCH] ?? "";
  const einstiege = loeschEinstiege(pitch);
  const geloescht = einstiege && (await loeschmengeIn(root, einstiege, dateien));
  const liste = geaenderteImPitch(root, pitch);
  return {
    nummern: nummernImOrdner(ordner).soll.size,
    codeDateien,
    testDateien: belegt.filter(istTestdatei),
    funktionen: funktionen.length,
    altfunktionen: funktionen.filter(istAltfunktion).length,
    testsAnDateien: await testsAn(root, codeDateien),
    dokumentKB: kilobyte(dokumente),
    ...(einstiege && { loeschmenge: geloescht }),
    ...(liste && nachAenderung(pitch, { liste, codeDateien, dateien, loeschen: geloescht?.dateien ?? [] })),
  };
}

function mindestdeckelIm(root, ordner) {
  const { soll, nurUmbau } = nummernImOrdner(ordner);
  const teil = teilVon(readFileSync(join(ordner, PITCH), "utf8")) !== undefined;
  return new Kostendeckel(root, basename(ordner)).mindestvorschau({ soll, nurUmbau, teil, gruppenUeberGrenze });
}

export async function umfangBefehl(ordnerAngabe, root) {
  const ordner = resolve(root, ordnerAngabe);
  const fehlend = [PITCH, SICHERHEIT].filter((name) => !existsSync(join(ordner, name)));
  if (fehlend.length > 0) {
    console.error(`${ordner} enthält kein ${fehlend.join(" und kein ")}`);
    return EXIT_AUFRUF;
  }
  const mindestdeckel = mindestdeckelIm(root, ordner);
  console.log(JSON.stringify({ ...(await umfang(root, ordner)), mindestdeckel }, null, JSON_EINRUECKUNG));
  console.error(`Mindestdeckel für plane: ${mindestdeckel.token} Token (${rollenText(mindestdeckel.rollen)})`);
  return EXIT_GRUEN;
}
