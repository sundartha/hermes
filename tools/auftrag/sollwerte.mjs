import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { laufe } from "./faelle.mjs";
import { dateiAm, vormerken } from "./git.mjs";
import { umzugZuruecknehmen } from "./listenumzug.mjs";

export const SOLLWERTE = "sollwerte";
const HASH = /^[0-9a-f]{64}$/;
const GLEICHHEIT = new Set(["strictEqual", "deepStrictEqual", "equal", "deepEqual", "=="]);
const VON_LAUF = "von lauf gesetzt";
const ANFUEHRUNGEN = ['"', "'", "`"];

function literale(hash) {
  return ANFUEHRUNGEN.map((zeichen) => `${zeichen}${hash}${zeichen}`);
}

export function hashPaar({ vergleich }) {
  if (vergleich === undefined || !GLEICHHEIT.has(vergleich.operator)) return null;
  const { ist, soll } = vergleich;
  return HASH.test(ist) && HASH.test(soll) && ist !== soll ? { alt: soll, neu: ist } : null;
}

function roteFaelle(root, pfad) {
  const { faelle, dateiRot } = laufe(root, pfad);
  return { rote: faelle.filter(({ rot, still }) => rot && !still), dateiRot };
}

function ersetzungen(pfad, rote) {
  const ersatz = new Map();
  for (const fall of rote) {
    const paar = hashPaar(fall);
    if (paar === null) return { befund: `${pfad}: Der Fall „${fall.name}“ ist nicht nur an einem 64-stelligen Hex-Sollwert rot; lauf setzt in der Datei nichts.` };
    if ((ersatz.get(paar.alt) ?? paar.neu) !== paar.neu) return { befund: `${pfad}: Der Sollwert ${paar.alt} hat in zwei Fällen verschiedene Ist-Werte; lauf setzt in der Datei nichts.` };
    ersatz.set(paar.alt, paar.neu);
  }
  return { ersatz };
}

function zeilenMit(text, hash) {
  return text.split("\n").flatMap((zeile, index) => (literale(hash).some((wert) => zeile.includes(wert)) ? [index + 1] : []));
}

function ersetzt(pfad, { text, basistext, ersatz }) {
  let neu = text;
  const gesetzt = [];
  for (const [alt, ist] of ersatz) {
    const zeilen = zeilenMit(text, alt);
    if (zeilen.length === 0 || basistext === null || zeilenMit(basistext, alt).length === 0) {
      return { befund: `${pfad}: Der Sollwert ${alt} steht nicht schon am Anfang des Auftrags als Literal in der Datei; lauf setzt in der Datei nichts.` };
    }
    for (const zeichen of ANFUEHRUNGEN) neu = neu.replaceAll(`${zeichen}${alt}${zeichen}`, `${zeichen}${ist}${zeichen}`);
    gesetzt.push(...zeilen.map((zeile) => ({ datei: pfad, zeile, alt, neu: ist })));
  }
  return { neu, gesetzt };
}

function setzeInDatei({ root, basis }, pfad) {
  const ort = join(root, pfad);
  if (!existsSync(ort)) return null;
  const { rote } = roteFaelle(root, pfad);
  if (rote.length === 0) return null;
  const { ersatz, befund } = ersetzungen(pfad, rote);
  if (befund !== undefined) return { befund };
  const text = readFileSync(ort, "utf8");
  const ergebnis = ersetzt(pfad, { text, basistext: dateiAm(basis, pfad, root), ersatz });
  if (ergebnis.befund !== undefined) return ergebnis;
  writeFileSync(ort, ergebnis.neu);
  const danach = roteFaelle(root, pfad);
  if (danach.rote.length > 0 || danach.dateiRot) {
    writeFileSync(ort, text);
    return { befund: `${pfad}: Mit den gesetzten Sollwerten bleibt die Datei rot (${danach.rote.map(({ name }) => `„${name}“`).join(", ") || "außerhalb eines Falls"}); lauf nimmt sie zurück und setzt nichts.` };
  }
  return { eintrag: { pfad, vorher: text, nachher: ergebnis.neu }, gesetzt: ergebnis.gesetzt };
}

export function sollwertZeile({ datei, zeile, alt, neu }) {
  return `${datei}:${zeile} ${alt} → ${neu}, ${VON_LAUF}`;
}

export function setzeSollwerte({ root, basis, dateien }) {
  const ergebnisse = dateien.map((pfad) => setzeInDatei({ root, basis }, pfad)).filter((ergebnis) => ergebnis !== null);
  const eintraege = ergebnisse.flatMap(({ eintrag }) => (eintrag === undefined ? [] : [eintrag]));
  vormerken(eintraege.map(({ pfad }) => pfad), root);
  return {
    eintraege,
    gesetzt: ergebnisse.flatMap(({ gesetzt = [] }) => gesetzt),
    befunde: ergebnisse.flatMap(({ befund }) => (befund === undefined ? [] : [befund])),
  };
}

export function sollwerteZuruecknehmen({ root, basis }, eintraege) {
  umzugZuruecknehmen(root, eintraege.filter(({ pfad, nachher }) => dateiAm(basis, pfad, root) !== nachher));
}

export function sollwertHinweis(dateien) {
  if (dateien.length === 0) return [];
  return [
    "## Freigegebene Sollwert-Hashes",
    "",
    `Das Issue gibt diese Testdateien frei: ${dateien.join(", ")}. Hält eine davon einen festen Sollwert-Hash (SHA-256, 64 Hex) eines gebauten Artefakts fest und weicht nach deinem Bau nur dieser Wert ab, meldest du keinen alten Test und änderst die Datei nicht. Das Skript setzt den Wert nach dem Bau selbst auf den gebauten Stand und prüft die Datei erneut.`,
    "",
  ];
}
