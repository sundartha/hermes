import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { MELDUNG, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { KOPIEN_LISTE, MELDUNG_OHNE_SEMGREP, ROTER_TEST, VERDOPPELT, funktion, namen, pruefung, rotAn } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";

const SEMGREP = "semgrep";
const JSCPD = "jscpd";
const AUSFUEHRBAR = 0o755;
const VERSION = "1.0.0";
const REGEL = "probe.regexp";
const MUSTER = "new RegExp(";
const WOZU = zweckBlock(SEMGREP)[0];
const ABSATZ = `Zweck ${SEMGREP}: Drehbuchtext des Ersatz-Agenten.`;
const LISTEN = { ...KOPIEN_LISTE, "tools/basis/semgrep.json": `${JSON.stringify({ version: VERSION, befunde: [] })}\n` };
const GROSS = "export function gross(wort) {\n  return wort.toUpperCase();\n}\n";
const ZUR_LAUFZEIT = `export function passt(text, wort) {\n  return new RegExp(wort).test(text);\n}\n\n${GROSS}`;
const TEST_ZUR_LAUFZEIT = `${ROTER_TEST}test("passt", () => assert.ok(new RegExp(String(4)).test(String(verdopple(2)))));\n`;

function ersatzSemgrep(nurEinmal) {
  return `#!/usr/bin/env node
const { existsSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
if (process.argv.includes("--version")) {
  const gefragt = join(__dirname, "gefragt");
  if (${nurEinmal} && existsSync(gefragt)) process.exit(1);
  writeFileSync(gefragt, "");
  console.log(${JSON.stringify(VERSION)});
  process.exit(0);
}
const dateien = ["src", "test"].filter((ordner) => existsSync(ordner)).flatMap((ordner) => readdirSync(ordner, { recursive: true }).map((name) => join(ordner, name)));
const muster = ${JSON.stringify(MUSTER)};
const treffer = (path, text) => {
  const gefunden = [];
  for (let index = text.indexOf(muster); index !== -1; index = text.indexOf(muster, index + 1)) {
    gefunden.push({ check_id: ${JSON.stringify(REGEL)}, path, start: { line: text.slice(0, index).split("\\n").length, offset: index }, end: { offset: index + muster.length } });
  }
  return gefunden;
};
console.log(JSON.stringify({ errors: [], results: dateien.filter((pfad) => pfad.endsWith(".js")).flatMap((pfad) => treffer(pfad, readFileSync(pfad, "utf8"))) }));
`;
}

function mitSemgrep(context, { nurEinmal = false } = {}) {
  const ordner = probeDirectory(context, { semgrep: ersatzSemgrep(nurEinmal), pg_isready: "#!/bin/sh\nexit 0\n" });
  for (const name of ["semgrep", "pg_isready"]) chmodSync(join(ordner, name), AUSFUEHRBAR);
  return `${ordner}${delimiter}${process.env.PATH}`;
}

function lauf(context, { auftrag, drehbuch, dateien = LISTEN, nurEinmal }) {
  return starte(context, { auftrag, drehbuch, dateien, umgebung: { PATH: mitSemgrep(context, { nurEinmal }) } });
}

function laeuftNachDenSchnellen(ergebnis) {
  const liste = namen(ergebnis.beleg);
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.stdout + ergebnis.lauf.stderr);
  assert.ok(liste.indexOf(JSCPD) < liste.indexOf(SEMGREP), liste.join(", "));
  assert.equal(pruefung(ergebnis.beleg, SEMGREP), 0, JSON.stringify(ergebnis.beleg.pruefungen));
  return liste;
}

function zweiteRunde({ werkzeug }, rolle, teile) {
  const prompt = readFileSync(join(werkzeug, `prompt-${rolle}.txt`), "utf8");
  for (const teil of teile) assert.ok(prompt.includes(teil), `${teil}\n${prompt}`);
}

test("semgrep läuft im Bau nach den schnellen Prüfungen und ist grün, wenn der Bau keinen neuen Befund schreibt", (context) => {
  const liste = laeuftNachDenSchnellen(lauf(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": GROSS } } }));
  assert.equal(liste[liste.indexOf("feste-pfade") + 1], JSCPD, liste.join(", "));
  for (const schnell of ["lint", "abnahme"]) assert.ok(liste.indexOf(schnell) < liste.indexOf(SEMGREP), liste.join(", "));
  assert.equal(liste[liste.indexOf(SEMGREP) + 1], "betroffene tests", liste.join(", "));
});

test("baut der Bau-Agent einen regulären Ausdruck zur Laufzeit zusammen, wird die Runde an semgrep rot, und die zweite Runde des Bau-Agenten bekommt Befund und Zweck-Text", (context) => {
  const ergebnis = lauf(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": ZUR_LAUFZEIT }, "bau-antwort": ABSATZ } });
  rotAn(SEMGREP, ergebnis.lauf, ergebnis.beleg);
  zweiteRunde(ergebnis, "bau", [`src/text.js:2 ${REGEL}`, WOZU, `dem Bau-Agenten: ${SEMGREP}`]);
});

test("semgrep läuft nach dem Test-Agenten nach den schnellen Prüfungen, vor dem Rot-Lauf", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const liste = laeuftNachDenSchnellen(lauf(context, { auftrag: funktion("2 !== 4"), drehbuch }));
  assert.ok(liste.indexOf("schutztests") < liste.indexOf(SEMGREP), liste.join(", "));
  assert.equal(liste[liste.indexOf(SEMGREP) + 1], "rot", liste.join(", "));
});

test("baut der Test-Agent einen regulären Ausdruck zur Laufzeit zusammen, hält lauf vor dem Bau an und gibt dem Test-Agenten Befund und Zweck-Text", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": TEST_ZUR_LAUFZEIT }, "test-antwort": ABSATZ, bau: { "src/rechnen.js": VERDOPPELT } };
  const ergebnis = lauf(context, { auftrag: funktion("2 !== 4"), drehbuch });
  rotAn(SEMGREP, ergebnis.lauf, ergebnis.beleg);
  assert.equal(existsSync(join(ergebnis.werkzeug, "prompt-bau.txt")), false);
  zweiteRunde(ergebnis, "test", [`test/rechnen.test.js:5 ${REGEL}`, WOZU, `dem Test-Agenten: ${SEMGREP}`]);
});

test("fehlt tools/basis/semgrep.json schon auf der Basis, entfällt semgrep in beiden Stufen mit genau einem Hinweis", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf: ende, beleg } = lauf(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: KOPIEN_LISTE });
  assert.equal(ende.status, 0, ende.stdout + ende.stderr);
  assert.ok(!namen(beleg).includes(SEMGREP), namen(beleg).join(", "));
  assert.equal(beleg.hinweise.filter((hinweis) => hinweis.includes("tools/basis/semgrep.json")).length, 1, JSON.stringify(beleg.hinweise));
});

test("läuft semgrep im Auftrag nicht mehr, wird die Runde rot mit der Meldung und dem Einrichtungsschritt vom Phasenende statt still grün", (context) => {
  const ergebnis = lauf(context, { auftrag: UMBAU, drehbuch: { bau: { "src/text.js": `export const text = 1;\n${GROSS}` } }, nurEinmal: true });
  assert.equal(ergebnis.lauf.status, EXIT_ROT, ergebnis.lauf.stdout + ergebnis.lauf.stderr);
  assert.equal(pruefung(ergebnis.beleg, SEMGREP), undefined, JSON.stringify(ergebnis.beleg.pruefungen));
  assert.ok(ergebnis.beleg.grund.startsWith(MELDUNG_OHNE_SEMGREP), ergebnis.beleg.grund);
  assert.ok(ergebnis.beleg.roteIds.includes(MELDUNG.SEMGREP_FEHLT), JSON.stringify(ergebnis.beleg.roteIds));
  zweiteRunde(ergebnis, "bau", zweckBlock(MELDUNG.SEMGREP_FEHLT));
});
