import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { echterRepoPfad, funktionenIn, istQuelltext } from "../../ziele/funktionen.mjs";
import { pfadIstSauber } from "../format.mjs";
import { pruefbareDateien } from "./altfunktionen-vorab.mjs";
import { istObjekt, istText, liste } from "./erkundung.mjs";
import { gemeinteFunktion } from "./kette.mjs";

export const AUSZUG_GRENZE = 30_000;
export const CODE_AUSZUG = "Code der gemeldeten Stellen";
const KEIN_CODE = "keine Stelle mit Code";
const ZEILEN = "Zeilen";
const BACKTICKS = /`+/g;
const MIN_ZAUN = 3;

function codeDateien(root, stellen) {
  const wurzel = realpathSync(root);
  const quelltexte = stellen.map(({ datei }) => datei).filter((datei) => istText(datei) && istQuelltext(datei));
  return new Set(pruefbareDateien(root, quelltexte).filter((datei) => pfadIstSauber(echterRepoPfad(wurzel, join(root, datei)))));
}

function istCodeStelle(stelle) {
  return istObjekt(stelle) && stelle.ausweg === undefined && stelle.neu === undefined && istText(stelle.datei);
}

function stellenDer(berichte) {
  const nummern = berichte.flatMap((bericht) => Object.entries(istObjekt(bericht?.nummern) ? bericht.nummern : {}));
  return nummern.flatMap(([nummer, angaben]) => [...liste(angaben?.weg), ...liste(angaben?.aenderungen)].filter(istCodeStelle).map((stelle) => ({ ...stelle, nummer, quelle: istText(stelle.funktion) ? "funktion" : "zeilen" })));
}

function dateiInhalt(kontext, datei) {
  if (!kontext.dateien.has(datei)) {
    const quelltext = readFileSync(join(kontext.root, datei), "utf8");
    kontext.dateien.set(datei, { zeilen: quelltext.split("\n"), funktionen: funktionenIn(datei, quelltext) });
  }
  return kontext.dateien.get(datei);
}

function alsEinheit(datei, { name, von, bis }) {
  return { datei, name, von, bis };
}

function zeilenEinheit(kontext, { datei, von, bis }) {
  if (!Number.isInteger(von) || !Number.isInteger(bis) || von < 1 || bis < von) return [];
  return [{ datei, name: ZEILEN, von, bis: Math.min(bis, dateiInhalt(kontext, datei).zeilen.length) }];
}

function funktionsEinheit(kontext, stelle) {
  const { datei } = stelle;
  const gewaehlt = gemeinteFunktion(dateiInhalt(kontext, datei).funktionen, stelle);
  return gewaehlt === undefined ? [] : [alsEinheit(datei, gewaehlt)];
}

const EINHEITEN = { zeilen: zeilenEinheit, funktion: funktionsEinheit };

function zeilenVon(kontext, { datei, von, bis }) {
  return dateiInhalt(kontext, datei).zeilen.slice(von - 1, bis);
}

function umschliessendeIn(alle, einheit) {
  return alle.find((aussen) => aussen !== einheit && aussen.datei === einheit.datei && aussen.von <= einheit.von && einheit.bis <= aussen.bis);
}

function aeussersteIn(alle, einheit) {
  let aussen;
  for (let naechste = umschliessendeIn(alle, einheit); naechste !== undefined; naechste = umschliessendeIn(alle, naechste)) aussen = naechste;
  return aussen;
}

function zusammengefasst(eintraege) {
  const jeOrt = new Map();
  for (const { einheit, nummer } of eintraege) {
    const ort = `${einheit.datei}:${einheit.von}-${einheit.bis}`;
    if (!jeOrt.has(ort)) jeOrt.set(ort, { ...einheit, nummern: new Set() });
    jeOrt.get(ort).nummern.add(nummer);
  }
  const alle = [...jeOrt.values()];
  for (const einheit of alle) for (const nummer of einheit.nummern) aeussersteIn(alle, einheit)?.nummern.add(nummer);
  return alle.filter((einheit) => umschliessendeIn(alle, einheit) === undefined);
}

function block(kontext, einheit) {
  const { datei, name, von, bis, nummern } = einheit;
  const code = zeilenVon(kontext, einheit).map((text, stelle) => `${von + stelle} ${text}`).join("\n");
  const zaun = "`".repeat(Math.max(MIN_ZAUN, ...[...code.matchAll(BACKTICKS)].map(([lauf]) => lauf.length + 1)));
  return `#### ${datei}:${von}-${bis} ${name} (${[...nummern].join(", ")})\n${zaun}js\n${code}\n${zaun}`;
}

export function codeAuszug(root, berichte, { grenze = AUSZUG_GRENZE } = {}) {
  const alle = stellenDer(berichte);
  const dateien = codeDateien(root, alle);
  const kontext = { root, dateien: new Map() };
  const eintraege = alle.filter(({ datei }) => dateien.has(datei)).flatMap((stelle) => EINHEITEN[stelle.quelle](kontext, stelle).map((einheit) => ({ einheit, nummer: stelle.nummer })));
  const drin = [];
  const draussen = [];
  let laenge = 0;
  for (const einheit of zusammengefasst(eintraege)) {
    const text = block(kontext, einheit);
    if (laenge + text.length > grenze) draussen.push(`${einheit.datei}:${einheit.von}-${einheit.bis} ${einheit.name}`);
    else {
      drin.push(text);
      laenge += text.length;
    }
  }
  const fehlend = draussen.length > 0 ? [`Nicht im Auszug (Grenze ${grenze} Zeichen), lies selbst: ${draussen.join(", ")}`] : [];
  return drin.length + fehlend.length > 0 ? [...drin, ...fehlend].join("\n\n") : KEIN_CODE;
}
