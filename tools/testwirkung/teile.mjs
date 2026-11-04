import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gewichtung, matrix, teilnummer } from "../mutationspruefung/teile.mjs";
import { MESSDATEI, WERKZEUGORDNER, WERKZEUG_MESSDATEI, leseDauern, schneide, teilzahlNachDauern, vergleich } from "../testlaufzeit/teilung.mjs";
import { git } from "./git.mjs";

function gemesseneDauern(dateien) {
  const tabellen = { werkzeug: leseDauern(WERKZEUG_MESSDATEI).dauern, uebrige: leseDauern(MESSDATEI).dauern };
  const tabelleDer = (datei) => (datei.startsWith(WERKZEUGORDNER) ? tabellen.werkzeug : tabellen.uebrige);
  if (dateien.some((datei) => tabelleDer(datei) === null)) return null;
  return Object.fromEntries(dateien.map((datei) => [datei, gewichtung(tabelleDer(datei))(datei)]));
}

export function plane(geaendert, katalogdateien) {
  const dateien = [...new Set(geaendert)].sort(vergleich);
  const dauern = gemesseneDauern(dateien);
  const { teile } = schneide(dateien, teilzahlNachDauern(dateien, dauern), dauern);
  const nurKatalog = [...new Set(katalogdateien)].filter((datei) => !dateien.includes(datei)).sort(vergleich);
  return teile.map((teil, index) => (index === 0 ? [...teil, ...nurKatalog] : teil));
}

export function schreibePlan(datei, plan) {
  writeFileSync(datei, `${JSON.stringify({ anzahl: plan.length, teile: matrix(plan) })}\n`);
  plan.forEach((dateien, index) => console.log(`Testwirkung: Teil ${index + 1} von ${plan.length}: ${dateien.length} Dateien`));
}

export function teilDateien(plan, { teil, teile }) {
  const nummer = teilnummer({ teil, teile }, plan.length);
  return { teil: nummer, teile: plan.length, dateien: plan[nummer - 1] };
}

function kopf() {
  return git(["rev-parse", "HEAD"]).trim();
}

export function schreibeTeil(datei, auswahl, messung) {
  writeFileSync(datei, `${JSON.stringify({ ...auswahl, kopf: kopf(), messung })}\n`);
}

function ergebnisDes(ordner, teil) {
  try {
    return JSON.parse(readFileSync(join(ordner, `wirkung-teil-${teil}.json`), "utf8"));
  } catch {
    return undefined;
  }
}

function passt(ergebnis, erwartet) {
  if (ergebnis === undefined) return false;
  const kopfdaten = ({ teil, teile, dateien, kopf: stand }) => JSON.stringify({ teil, teile, dateien, stand });
  return kopfdaten(ergebnis) === kopfdaten({ ...erwartet, kopf: kopf() });
}

export function lesbareTeile(ordner, plan, teile) {
  teilnummer({ teil: 1, teile }, plan.length);
  return plan.map((dateien, index) => {
    const teil = index + 1;
    const ergebnis = ergebnisDes(ordner, teil);
    return { teil, teile: plan.length, messung: passt(ergebnis, { teil, teile: plan.length, dateien }) ? ergebnis.messung : undefined };
  });
}

export function fehlendeTeile(lesbar) {
  return lesbar.filter(({ messung }) => messung === undefined).map(({ teil, teile }) => `Teilergebnis fehlt: Teil ${teil} von ${teile}`);
}

export function gesammelt(ergebnisse) {
  const alle = (feld) => ergebnisse.flatMap((ergebnis) => ergebnis[feld] ?? []).sort(vergleich);
  return { geprueft: ergebnisse.reduce((summe, { geprueft }) => summe + geprueft, 0), verstoesse: alle("verstoesse"), hinweise: alle("hinweise") };
}
