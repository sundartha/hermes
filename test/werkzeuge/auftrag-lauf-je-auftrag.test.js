import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { KOPIEN_LISTE, ROTER_TEST, VERDOPPELT, exitCodes, funktion, rotAn } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, commitAll, echterCiLokalSchritt, runIn, writeFiles } from "./probe-repo.js";

const JSCPD = "jscpd";
const DREHBUCH = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
const GEBUEHR = `  let summe = 0;
  for (const posten of liste) summe += posten.preis * posten.menge + 7;
  const schnitt = summe / liste.length;
  return { summe, schnitt, zeilen: liste.length, leer: liste.length === 0 };
}
`;
const FRUEHERE_KOPIE = { "src/eins.js": `export function eins(liste) {\n${GEBUEHR}`, "src/zwei.js": `export function eins(liste) {\n${GEBUEHR}` };
const EIGENE_KOPIE = `${BASIS["src/text.js"]}\nexport function brutto(liste) {\n${GEBUEHR}\nexport function netto(liste) {\n${GEBUEHR}`;

function fruehererAuftrag(repo) {
  writeFiles(repo, FRUEHERE_KOPIE);
  commitAll(repo, "Früherer Auftrag: zwei gleiche Funktionen");
}

function echteJscpdListe() {
  return { schritte: [{ name: JSCPD, befehl: echterCiLokalSchritt(JSCPD) }], nurCi: {} };
}

function mitEchtemCiLokal() {
  const paket = JSON.parse(BASIS["package.json"]);
  const scripts = { ...paket.scripts, "ci:lokal": `node ${JSON.stringify(join(REPO_ROOT, "tools/ci-lokal.mjs"))}` };
  return { ...KOPIEN_LISTE, "package.json": JSON.stringify({ ...paket, scripts }), "tools/ci-lokal.json": JSON.stringify(echteJscpdListe()) };
}

function betreffeSeit(repo, basis) {
  return runIn(repo, "git", ["log", "--format=%s", `${basis}..HEAD`]).stdout.split("\n").filter(Boolean);
}

test("hinterließ ein früherer Auftrag eine Kopie, die nicht in der Liste steht, wird der spätere Auftrag in beiden Stufen nicht an jscpd rot", (context) => {
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien: KOPIEN_LISTE, vorbereiten: fruehererAuftrag });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, JSCPD), [0, 0]);
});

test("legt der Bau-Agent selbst eine Kopie an, wird die Runde an jscpd rot, auch wenn ein früherer Auftrag schon eine hinterlassen hat", (context) => {
  const drehbuch = { bau: { "src/text.js": EIGENE_KOPIE }, "bau-antwort": `Zweck ${JSCPD}: Drehbuchtext des Ersatz-Agenten.` };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien: KOPIEN_LISTE, vorbereiten: fruehererAuftrag });
  rotAn(JSCPD, lauf, beleg);
});

test("am Phasenende meldet ci-lokal die frühere Kopie gegen master rot, obwohl der Auftrag grün war und committet bleibt", (context) => {
  const { repo, lauf, beleg, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien: mitEchtemCiLokal(), vorbereiten: fruehererAuftrag });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, JSCPD), [0, 0]);
  assert.ok(lauf.stdout.includes("src/eins.js"), lauf.stdout);
  assert.ok(lauf.stderr.includes("endete mit Exit 1"), lauf.stderr);
  assert.deepEqual(betreffeSeit(repo, basis), ["Verdopple Zahlen"]);
});
