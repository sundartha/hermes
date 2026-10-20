import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { nummernImOrdner } from "../../tools/auftrag/planung/nummern.mjs";
import { Planung } from "../../tools/auftrag/planung/plane.mjs";
import { probeMitEslint } from "./eslint-probe.js";
import { REPO_ROOT, runIn } from "./probe-repo.js";

const AUFTRAG_TOOL = join(REPO_ROOT, "tools/auftrag.mjs");
const ORDNER = "plaene/P-004-umbau";
const RECHNEN = "src/rechnen.js";
const RECHNEN_TS = "src/rechnen.ts";
const ZAEHLEN = "src/zaehlen.js";
const RECHNEN_TEST = "test/rechnen/rechnen.test.js";
const ZAEHLEN_TEST = "test/rechnen/zaehlen.test.js";
const UMBAU_TEST = /^Regel Umbau-Test:/m;
const SCHLUSS = /^(?:rot: \d+ Befunde|grün: die Schnittliste) /m;
const SICHERHEIT = ["# P-004 Umbau: Sicherheitsprüfung", "", "## 2. Angriffswege", "", "keine Angriffswege gefunden", "", "## 3. Lückenprüfung", ""].join("\n");
const ANFORDERUNGEN = "keine neuen, weil sich nach außen nichts zeigt; das Prüfbare steht unter „Bleibt unverändert“";
const BLEIBT = "keins, weil die bestehenden Tests das Verhalten unverändert prüfen";
const SZENARIO = "### Szenario S1: Probe\nGegeben ein Kunde\nWenn er über `POST /api/probe` sendet\nDann kommt eine Antwort";
const EINGANG = ["export function registriere(router) {", '  router.post("/api/probe", function nimmAn(anfrage) {', "    const kopie = anfrage;", "    return kopie;", "  });", "}", ""].join("\n");
const LOGIK = ["export function rechne(wert) {", "  const doppelt = wert * 2;", "  return doppelt + 1;", "}", ""].join("\n");

function pitch(bleibt) {
  return ["# P-004 Umbau", "", "## Anforderungen", "", ANFORDERUNGEN, "", "## Bleibt unverändert", "", bleibt, "", "## Nicht-Ziele", "", "keine", ""].join("\n");
}

function umbau(id, { dateien, abnahme }) {
  return { id, art: "umbau", ziel: "Zieh die Rechnung heraus", bereich: "src/", erwarteteDateien: dateien, vorbild: dateien[0], abnahme, erwarteterFehler: "keiner", prueft: UMBAU_AUSWEG, abhaengigVon: [], altfunktionen: [] };
}

function schnittListe(auftraege) {
  return { annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege };
}

function probe(context, auftraege, { pitchtext = pitch(BLEIBT), berichte = [] } = {}) {
  const wurzel = probeMitEslint(context, {
    "tools/bereiche.json": readFileSync(join(REPO_ROOT, "tools/bereiche.json"), "utf8"),
    "src/eingang.js": EINGANG,
    "src/logik.js": LOGIK,
    "test/vorhanden.test.js": "",
    [RECHNEN]: "export const verdopple = (zahl) => zahl * 2;\n",
    [ZAEHLEN]: "export const zaehle = (zahl) => zahl + 1;\n",
    [RECHNEN_TEST]: 'import "../../src/rechnen.js";\n',
    [ZAEHLEN_TEST]: 'import "../../src/zaehlen.js";\n',
    [`${ORDNER}/pitch.md`]: pitchtext,
    [`${ORDNER}/sicherheit.md`]: SICHERHEIT,
  });
  mkdirSync(join(wurzel, ORDNER, "planung"));
  writeFileSync(join(wurzel, ORDNER, "planung/schnitt.json"), JSON.stringify(schnittListe(auftraege)));
  berichte.forEach((bericht, index) => writeFileSync(join(wurzel, ORDNER, `planung/erkundung-${index + 1}.json`), JSON.stringify(bericht)));
  return wurzel;
}

function schnitt(context, auftraege, optionen) {
  return runIn(probe(context, auftraege, optionen), process.execPath, [AUFTRAG_TOOL, "schnitt", ORDNER]);
}

async function dateikarteDerPruefer(context, auftraege, optionen) {
  const wurzel = probe(context, auftraege, optionen);
  const ordner = join(wurzel, ORDNER);
  const planung = new Planung(wurzel, ordner);
  planung.beginne(nummernImOrdner(ordner));
  planung.schnitt = schnittListe(auftraege);
  const nachricht = await planung.prueferNachricht([], { gruppe: null });
  const [, abschnitt] = nachricht.split("### Dateikarte\n\n```json\n");
  return JSON.parse(abschnitt.slice(0, abschnitt.indexOf("\n```")));
}

function umbauTestZeilen(lauf) {
  assert.match(lauf.stdout, SCHLUSS, lauf.stdout + lauf.stderr);
  return lauf.stderr.split("\n").filter((zeile) => UMBAU_TEST.test(zeile));
}

test("umbau-dateikarte: bei einem reinen Umbau-Pitch erreicht die abnahme jedes Umbaus seine Datei laut Dateikarte", (context) => {
  const lauf = schnitt(context, [umbau("a1", { dateien: [RECHNEN], abnahme: RECHNEN_TEST }), umbau("a2", { dateien: [ZAEHLEN], abnahme: ZAEHLEN_TEST })]);
  assert.equal(lauf.stderr.includes("Regel Form:"), false, lauf.stderr);
  assert.deepEqual(umbauTestZeilen(lauf), [], lauf.stderr);
});

test("umbau-dateikarte: bei einem reinen Umbau-Pitch bleibt eine abnahme, die nur eine fremde Datei erreicht, ein Befund", (context) => {
  const lauf = schnitt(context, [umbau("a1", { dateien: [RECHNEN], abnahme: ZAEHLEN_TEST })]);
  assert.deepEqual(umbauTestZeilen(lauf), [`Regel Umbau-Test: a1: abnahme ${ZAEHLEN_TEST} gehört laut Dateikarte zu keiner Datei des Umbaus (${RECHNEN})`], lauf.stderr);
});

test("umbau-dateikarte: eine noch nicht vorhandene Datei kommt nicht in die Dateikarte", (context) => {
  const nurNeu = schnitt(context, [umbau("a1", { dateien: [RECHNEN_TS], abnahme: RECHNEN_TEST })]);
  assert.deepEqual(umbauTestZeilen(nurNeu), [`Regel Umbau-Test: a1: abnahme ${RECHNEN_TEST} gehört laut Dateikarte zu keiner Datei des Umbaus (${RECHNEN_TS})`], nurNeu.stderr);
  const altUndNeu = schnitt(context, [umbau("a1", { dateien: [RECHNEN, RECHNEN_TS], abnahme: RECHNEN_TEST })]);
  assert.deepEqual(umbauTestZeilen(altUndNeu), [], altUndNeu.stderr);
});

test("umbau-dateikarte: ein Ordner unter erwarteteDateien kommt nicht in die Dateikarte und bricht den Schnitt nicht ab", (context) => {
  const lauf = schnitt(context, [umbau("a1", { dateien: ["src"], abnahme: RECHNEN_TEST })]);
  assert.deepEqual(umbauTestZeilen(lauf), [`Regel Umbau-Test: a1: abnahme ${RECHNEN_TEST} gehört laut Dateikarte zu keiner Datei des Umbaus (src)`], lauf.stderr);
});

test("umbau-dateikarte: bei einem Pitch mit Szenario bekommt ein Umbau ohne Datei im Erkundungsbericht keine Ersatzkarte", (context) => {
  const angaben = {
    weg: [{ rolle: "eingang", datei: "src/eingang.js", funktion: "nimmAn", von: 2, bis: 4 }, { rolle: "wirkung", datei: "src/logik.js", funktion: "rechne", von: 2, bis: 3 }],
    aenderungen: [{ datei: "src/logik.js", funktion: "rechne", von: 2, bis: 3, neueZeilen: 3 }],
    tests: ["test/vorhanden.test.js"],
    vorbild: "src/vorbild.js",
    schema: { aenderung: false, fundstelle: "src/logik.js Zeile 1" },
    codeowners: [],
    ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
    eingangImTest: "erreichbar",
    widersprueche: [],
  };
  const bericht = { gruppe: ["S1"], nummern: { S1: angaben } };
  const lauf = schnitt(context, [umbau("a1", { dateien: [RECHNEN], abnahme: RECHNEN_TEST })], { pitchtext: pitch(`${BLEIBT}\n\n${SZENARIO}`), berichte: [bericht] });
  assert.deepEqual(umbauTestZeilen(lauf), [`Regel Umbau-Test: a1: abnahme ${RECHNEN_TEST} gehört laut Dateikarte zu keiner Datei des Umbaus (${RECHNEN})`], lauf.stderr);
});

test("umbau-dateikarte: bei einem reinen Umbau-Pitch sehen die Planungsprüfer die Dateikarte der Umbauten, sonst die der Berichte", async (context) => {
  const auftraege = [umbau("a1", { dateien: [RECHNEN, RECHNEN_TS], abnahme: RECHNEN_TEST })];
  const nurUmbau = await dateikarteDerPruefer(context, auftraege);
  assert.deepEqual(nurUmbau.map(({ datei, tests }) => ({ datei, tests })), [{ datei: RECHNEN, tests: [RECHNEN_TEST] }]);
  assert.deepEqual(await dateikarteDerPruefer(context, auftraege, { pitchtext: pitch(`${BLEIBT}\n\n${SZENARIO}`) }), []);
});
