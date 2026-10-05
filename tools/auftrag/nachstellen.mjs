import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env, execPath } from "node:process";

import { entferne, neuerOrdner } from "./pruefer-arbeitsordner.mjs";
import { starteMitFrist } from "./pruefer-lauf.mjs";
import {
  ERGEBNIS_DATEI,
  FORMAT,
  KATEGORIEN,
  NACHSTELLUNG_DATEI,
  ergebnisAus,
  reproduzierbareBlocker,
} from "./pruefer-schema.mjs";

export const REPRODUKTION = "test/pruefer-reproduktion.test.js";
export const ZEITGRENZE_MS = 120_000;
const [ERWARTUNG, LADEN, UMGEBUNG, ZEIT, GRUEN] = KATEGORIEN;
const ERGEBNIS_ZEILE = /^\s*(not ok|ok) \d+ - /;
const YAML_ENDE = /^\s*\.\.\.$/;
const ASSERTION = /^\s*code: '?ERR_ASSERTION'?$/;
const DATEI_EBENE = /^\s*exitCode: /;
const NICHT_OK = "not ok";
const ZWISCHENDATEI = ".nachstellung.json.neu";

export function ergebnisBloecke(zeilen) {
  const bloecke = [];
  let block = null;
  for (const zeile of zeilen) {
    const treffer = ERGEBNIS_ZEILE.exec(zeile);
    if (treffer) {
      block = { ok: treffer[1] !== NICHT_OK, assertion: false, dateiEbene: false };
      bloecke.push(block);
    } else if (block && YAML_ENDE.test(zeile)) {
      block = null;
    } else if (block) {
      block.assertion ||= ASSERTION.test(zeile);
      block.dateiEbene ||= DATEI_EBENE.test(zeile);
    }
  }
  return bloecke;
}

export function kategorieDes({ zeilen, exitCode, zeitAbgelaufen }) {
  if (zeitAbgelaufen) return ZEIT;
  if (exitCode === 0) return GRUEN;
  const tests = ergebnisBloecke(zeilen).filter((block) => !block.dateiEbene);
  if (tests.length === 0) return LADEN;
  return tests.some((block) => !block.ok && block.assertion) ? ERWARTUNG : UMGEBUNG;
}

export async function fuehreReproduktionAus(ordner, inhalt, zeitgrenzeMs = ZEITGRENZE_MS) {
  const datei = join(ordner, REPRODUKTION);
  const home = neuerOrdner("nachstellen-home-");
  try {
    mkdirSync(dirname(datei), { recursive: true });
    writeFileSync(datei, inhalt);
    const umgebung = { PATH: env.PATH, HOME: home, CI: "true" };
    const lauf = await starteMitFrist([execPath, "--test", "--test-reporter=tap", REPRODUKTION], {
      cwd: ordner,
      umgebung,
      zeitgrenzeMs,
    });
    return { kategorie: kategorieDes(lauf), ausgabe: lauf.zeilen.join("\n") };
  } finally {
    rmSync(datei, { force: true });
    entferne(home);
  }
}

function zaehle(ergebnisse, seite) {
  return KATEGORIEN.map(
    (kategorie) =>
      `${kategorie} ${ergebnisse.filter((eintrag) => eintrag[seite] === kategorie).length}`,
  ).join(", ");
}

function schreibeNachstellung(aus, head, ergebnisse) {
  const zwischen = join(aus, ZWISCHENDATEI);
  writeFileSync(zwischen, `${JSON.stringify({ format: FORMAT, head, ergebnisse })}\n`);
  renameSync(zwischen, join(aus, NACHSTELLUNG_DATEI));
}

export async function stelleNach(
  { ergebnis: ergebnisOrdner, pr, basis, aus },
  zeitgrenzeMs = ZEITGRENZE_MS,
) {
  const ergebnis = ergebnisAus(readFileSync(join(ergebnisOrdner, ERGEBNIS_DATEI), "utf8"));
  if (ergebnis === null) throw new Error(`${ERGEBNIS_DATEI} ist ungültig.`);
  const ergebnisse = [];
  mkdirSync(aus, { recursive: true });
  schreibeNachstellung(aus, ergebnis.head, ergebnisse);
  for (const befund of reproduzierbareBlocker(ergebnis)) {
    const aufPr = await fuehreReproduktionAus(pr, befund.reproduktion, zeitgrenzeMs);
    const aufBasis = await fuehreReproduktionAus(basis, befund.reproduktion, zeitgrenzeMs);
    ergebnisse.push({
      schluessel: befund.schluessel,
      pr: aufPr.kategorie,
      basis: aufBasis.kategorie,
    });
    schreibeNachstellung(aus, ergebnis.head, ergebnisse);
  }
  console.log(`Nachstellung: ${ergebnisse.length} BLOCKER mit Reproduktion.`);
  console.log(`  PR: ${zaehle(ergebnisse, "pr")}`);
  console.log(`  Basis: ${zaehle(ergebnisse, "basis")}`);
  return 0;
}
