import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEPENDENCY_TOOL, REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const KONFIGURATION = ".dependency-cruiser.cjs";
const ALTVERSTOESSE = ".dependency-cruiser-known-violations.json";
const LISTENUMZUG = join(REPO_ROOT, "tools/auftrag/listenumzug.mjs");
const FASSADE = "speicher-nur-ueber-fassade";
const ALT = "src/rechner.js";
const NEU = "src/konfiguration/rechnen.js";
const ZIEL = "src/store/defaults.js";
const ANDERES_ZIEL = "src/store/begriffe.js";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

const SPEICHER = {
  [ZIEL]: 'export const TAKT = 1;\nexport const STUFE = "aus";\n',
  [ANDERES_ZIEL]: 'export const NAME = "rechner";\n',
};
const TAKT = "export function takt() {\n  return TAKT;\n}";
const STUFE = "export function stufe() {\n  return STUFE;\n}";
const NAME = "export function name() {\n  return NAME;\n}";

function datei(...teile) {
  return `${teile.join("\n\n")}\n`;
}

function verstoss(von, nach, regel = FASSADE) {
  const aufgeloest = von === NEU ? `../${nach.slice("src/".length)}` : `./${nach.slice("src/".length)}`;
  return { type: "dependency", from: von, to: nach, unresolvedTo: aufgeloest, dependencyTypes: ["local", "import"], rule: { severity: "error", name: regel } };
}

function liste(...eintraege) {
  return `${JSON.stringify(eintraege, null, 2)}\n`;
}

function repoMitAltverstoss(context, { vorher, eintraege = [verstoss(ALT, ZIEL)], basisDazu = {} }) {
  return probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
    ...SPEICHER,
    [ALT]: vorher,
    [ALTVERSTOESSE]: liste(...eintraege),
    ...basisDazu,
  });
}

function ausgelagert(context, { vorher, nachher, neu, eintraege, basisDazu, dazu = {} }) {
  const repo = repoMitAltverstoss(context, { vorher, eintraege, basisDazu });
  writeFiles(repo, { [ALT]: nachher, [NEU]: neu, ...dazu });
  commitAll(repo, "Auslagerung");
  return repo;
}

function umziehen(repo) {
  const lauf = runIn(repo, process.execPath, [LISTENUMZUG, "--basis", "HEAD~1"]);
  assert.equal(lauf.status, EXIT_GRUEN, `${lauf.stdout}${lauf.stderr}`);
  return JSON.parse(readFileSync(join(repo, ALTVERSTOESSE), "utf8"));
}

function pruefe(repo) {
  const lauf = runIn(repo, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

function zuVielVonHand(repo, dateien, meldung) {
  writeFiles(repo, dateien);
  const lauf = pruefe(repo);
  assert.equal(lauf.status, EXIT_ROT, lauf.ausgabe);
  assert.match(lauf.ausgabe, meldung);
}

function schluessel(eintraege) {
  return eintraege.map(({ rule, from, to }) => `${rule.name} ${from} -> ${to}`).sort();
}

const TAKT_VORHER = datei('import { STUFE, TAKT } from "./store/defaults.js";', TAKT, STUFE);
const TAKT_NACHHER = datei('import { STUFE } from "./store/defaults.js";', 'export { takt } from "./konfiguration/rechnen.js";', STUFE);
const TAKT_NEU = datei('import { TAKT } from "../store/defaults.js";', TAKT);
const REINE_AUSLAGERUNG = { vorher: TAKT_VORHER, nachher: TAKT_NACHHER, neu: TAKT_NEU };
const OHNE_ZIEL_IMPORT = {
  vorher: datei('import { STUFE } from "./store/defaults.js";\nimport { NAME } from "./store/begriffe.js";', NAME, STUFE),
  nachher: datei('import { STUFE } from "./store/defaults.js";', 'export { name } from "./konfiguration/rechnen.js";', STUFE),
  neu: datei('import { NAME } from "../store/begriffe.js";', NAME),
};
const NEUER_EINTRAG_ZU_VIEL = /darf nur kürzer werden, neu eingefroren ist: src\/konfiguration\/rechnen\.js → src\/store\/defaults\.js/;

test("Altverstoß-Umzug: bei einer reinen Auslagerung übernimmt der Listenumzug den Altverstoß der alten Datei für die neue Datei, der Eintrag der alten Datei bleibt, und die Abhängigkeitsprüfung ist danach grün", (context) => {
  const repo = ausgelagert(context, REINE_AUSLAGERUNG);
  const vorher = pruefe(repo);
  assert.equal(vorher.status, EXIT_ROT, vorher.ausgabe);
  assert.match(vorher.ausgabe, /Neuer Verstoß: src\/konfiguration\/rechnen\.js → src\/store\/defaults\.js/);
  const eintraege = umziehen(repo);
  assert.deepEqual(schluessel(eintraege), [`${FASSADE} ${NEU} -> ${ZIEL}`, `${FASSADE} ${ALT} -> ${ZIEL}`]);
  assert.equal(eintraege.find(({ from }) => from === NEU).unresolvedTo, "../store/defaults.js");
  const nachher = pruefe(repo);
  assert.equal(nachher.status, EXIT_GRUEN, nachher.ausgabe);
  assert.match(nachher.ausgabe, /die Liste ist gegenüber der Basis um 1 Altverstoß einer reinen Auslagerung gewachsen/);
});

test("Altverstoß-Umzug: ist die Änderung keine reine Auslagerung, weil die alte Datei zusätzlich anders geändert ist, übernimmt der Listenumzug nichts und die neue Datei bleibt ein Neuer Verstoß", (context) => {
  const geaendert = datei('import { STUFE } from "./store/defaults.js";', 'export { takt } from "./konfiguration/rechnen.js";', STUFE.replace("return STUFE", "return STUFE + 1"));
  const repo = ausgelagert(context, { ...REINE_AUSLAGERUNG, nachher: geaendert });
  assert.deepEqual(schluessel(umziehen(repo)), [`${FASSADE} ${ALT} -> ${ZIEL}`]);
  const nachher = pruefe(repo);
  assert.equal(nachher.status, EXIT_ROT, nachher.ausgabe);
  assert.match(nachher.ausgabe, /Neuer Verstoß: src\/konfiguration\/rechnen\.js → src\/store\/defaults\.js/);
});

test("Altverstoß-Umzug: importiert die neue Datei ein anderes Ziel als das, für das die alte Datei den Altverstoß hat, übernimmt der Listenumzug nur den Eintrag für dieses Ziel", (context) => {
  const vorher = datei('import { STUFE, TAKT } from "./store/defaults.js";\nimport { NAME } from "./store/begriffe.js";', TAKT, NAME, STUFE);
  const nachher = datei('import { STUFE, TAKT } from "./store/defaults.js";', 'export { name } from "./konfiguration/rechnen.js";', TAKT, STUFE);
  const neu = datei('import { NAME } from "../store/begriffe.js";', NAME);
  const repo = ausgelagert(context, { vorher, nachher, neu, eintraege: [verstoss(ALT, ZIEL), verstoss(ALT, ANDERES_ZIEL)] });
  const eintraege = schluessel(umziehen(repo));
  assert.ok(eintraege.includes(`${FASSADE} ${NEU} -> ${ANDERES_ZIEL}`), eintraege.join("\n"));
  assert.ok(!eintraege.includes(`${FASSADE} ${NEU} -> ${ZIEL}`), eintraege.join("\n"));
  const nachPruefung = pruefe(repo);
  assert.equal(nachPruefung.status, EXIT_GRUEN, nachPruefung.ausgabe);
});

test("Altverstoß-Umzug: hat die alte Datei keinen Altverstoß in der Liste, nur eine andere Datei, bleibt die Liste unverändert und die neue Datei ein Neuer Verstoß", (context) => {
  const anderer = "src/anderer.js";
  const basisDazu = { [anderer]: 'import { TAKT } from "./store/defaults.js";\nexport const andere = TAKT;\n' };
  const repo = ausgelagert(context, { ...REINE_AUSLAGERUNG, eintraege: [verstoss(anderer, ZIEL)], basisDazu });
  assert.deepEqual(schluessel(umziehen(repo)), [`${FASSADE} ${anderer} -> ${ZIEL}`]);
  const nachher = pruefe(repo);
  assert.equal(nachher.status, EXIT_ROT, nachher.ausgabe);
  assert.match(nachher.ausgabe, /Neuer Verstoß: src\/konfiguration\/rechnen\.js → src\/store\/defaults\.js/);
});

test("Altverstoß-Umzug: importiert die neue Datei das Ziel des Altverstoßes nicht, übernimmt der Listenumzug nichts", (context) => {
  const repo = ausgelagert(context, { ...OHNE_ZIEL_IMPORT, eintraege: [verstoss(ALT, ZIEL)] });
  assert.deepEqual(schluessel(umziehen(repo)), [`${FASSADE} ${ALT} -> ${ZIEL}`]);
});

test("Altverstoß-Umzug: ein von Hand ergänzter Eintrag für die neue Datei mit anderer Regel als der Altverstoß der alten Datei ist für die Abhängigkeitsprüfung zu viel", (context) => {
  const repo = ausgelagert(context, REINE_AUSLAGERUNG);
  zuVielVonHand(repo, { [ALTVERSTOESSE]: liste(verstoss(ALT, ZIEL), verstoss(NEU, ZIEL, "keine-ordnerzyklen")) }, /defaults\.js verstößt gegen „keine-ordnerzyklen“/);
});

test("Altverstoß-Umzug: ein von Hand ergänzter Eintrag für eine Datei, die nicht neu ist, ist für die Abhängigkeitsprüfung zu viel, auch neben einer reinen Auslagerung", (context) => {
  const bestehend = "src/anderer.js";
  const eintraege = [verstoss(ALT, ZIEL)];
  const repo = ausgelagert(context, { ...REINE_AUSLAGERUNG, eintraege, basisDazu: { [bestehend]: 'import { TAKT } from "./store/defaults.js";\nexport const andere = TAKT;\n' } });
  zuVielVonHand(repo, { [ALTVERSTOESSE]: liste(verstoss(ALT, ZIEL), verstoss(NEU, ZIEL), verstoss(bestehend, ZIEL)) }, /neu eingefroren ist: src\/anderer\.js → src\/store\/defaults\.js/);
});

test("Altverstoß-Umzug: ein von Hand ergänzter Eintrag mit gleicher Regel und gleichem Ziel für die neue Datei ist für die Abhängigkeitsprüfung zu viel, wenn die Änderung keine reine Auslagerung ist", (context) => {
  const geaendert = datei('import { STUFE } from "./store/defaults.js";', 'export { takt } from "./konfiguration/rechnen.js";', STUFE.replace("return STUFE", "return STUFE + 1"));
  const repo = ausgelagert(context, { ...REINE_AUSLAGERUNG, nachher: geaendert });
  zuVielVonHand(repo, { [ALTVERSTOESSE]: liste(verstoss(ALT, ZIEL), verstoss(NEU, ZIEL)) }, NEUER_EINTRAG_ZU_VIEL);
});

test("Altverstoß-Umzug: ein von Hand ergänzter Eintrag mit gleicher Regel und gleichem Ziel ist zu viel, wenn die neue Datei das Ziel nicht importiert", (context) => {
  const repo = ausgelagert(context, { ...OHNE_ZIEL_IMPORT, eintraege: [verstoss(ALT, ZIEL), verstoss(ALT, ANDERES_ZIEL)] });
  zuVielVonHand(repo, { [ALTVERSTOESSE]: liste(verstoss(ALT, ZIEL), verstoss(ALT, ANDERES_ZIEL), verstoss(NEU, ZIEL)) }, NEUER_EINTRAG_ZU_VIEL);
});

test("Altverstoß-Umzug: der Durchlass gilt nur für die Liste der Altverstöße, ein von Hand ergänzter Eintrag in der Liste der Testimporte ist zu viel", (context) => {
  const testimporte = "tools/basis/test-importe.json";
  const eintrag = (von) => ({ ...verstoss(von, ZIEL, "tests-nur-ueber-eingaenge") });
  const repo = ausgelagert(context, { ...REINE_AUSLAGERUNG, basisDazu: { [testimporte]: liste(eintrag(ALT)) } });
  const dateien = { [ALTVERSTOESSE]: liste(verstoss(ALT, ZIEL), verstoss(NEU, ZIEL)), [testimporte]: liste(eintrag(ALT), eintrag(NEU)) };
  zuVielVonHand(repo, dateien, /tools\/basis\/test-importe\.json darf nur kürzer werden, neu eingefroren ist: src\/konfiguration\/rechnen\.js/);
});
