import assert from "node:assert/strict";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BASIS, planAusgabe as plan } from "./mutationspruefung-hilfen.js";
import { REPO_ROOT, commitAll, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERTE = "src/werte.js";
const STATUS_DATEI = "src/status.js";
const ERKANNT = /^reine Auslagerung: keine Mutanten nötig \(aus src\/werte\.js nach src\/status\.js: 2 Anweisungen\)\. Grund: /m;
const KEIN_TEIL = /^Plan: keine geänderte Zeile unter src\/ mit Mutanten oder Abschaltung\.$/m;
const UMBAU = "Lagere aus\n\nWarum: kleiner.\n\nArt: umbau\nPaket: 1";
const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");

const KOPF = 'import { einordnen } from "./zahl.js";';
const STATUS = 'export const STATUS = Object.freeze({\n  AN: "an",\n  AUS: "aus",\n});';
const UEBERGAENGE = "export const UEBERGAENGE = Object.freeze({\n  [STATUS.AN]: Object.freeze([STATUS.AUS]),\n  [STATUS.AUS]: Object.freeze([STATUS.AN]),\n});";
const ZUSTAND = 'export function zustand(wert) {\n  return einordnen(wert) === "negativ" ? "aus" : "an";\n}';
const WEITER = 'export { STATUS, UEBERGAENGE } from "./status.js";';

function datei(...teile) {
  return `${teile.join("\n\n")}\n`;
}

const VORHER = datei(KOPF, STATUS, UEBERGAENGE, ZUSTAND);
const WERTE_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { UEBERGAENGE, zustand } from "../src/werte.js";',
  'test("werte", () => {',
  '  assert.deepEqual(UEBERGAENGE.an, ["aus"]);',
  '  assert.equal(zustand(-1), "aus");',
  "});",
  "",
].join("\n");

function ausgelagert(context, { werte = datei(KOPF, WEITER, ZUSTAND), status = datei(STATUS, UEBERGAENGE), vorher = VORHER, basisDazu = {}, dazu = {}, nachricht = "Auslagerung", vorDemCommit = () => {} } = {}) {
  const repo = probeRepository(context, { ...BASIS, ...basisDazu, [WERTE]: vorher, "test/werte.test.js": WERTE_TEST });
  writeFiles(repo, { [WERTE]: werte, ...(status === null ? {} : { [STATUS_DATEI]: status }), ...dazu });
  vorDemCommit(repo);
  commitAll(repo, nachricht);
  return repo;
}

function erkannt(context, repo) {
  const ausgabe = plan(context, repo);
  assert.match(ausgabe, ERKANNT);
  assert.match(ausgabe, KEIN_TEIL);
  return ausgabe;
}

function vollGerechnet(context, repo) {
  const ausgabe = plan(context, repo);
  assert.doesNotMatch(ausgabe, /^reine Auslagerung/m);
  assert.match(ausgabe, /^Teil 1 von \d+: .*src\/(werte|status)\.js/m);
}

function mitKonstanten(context, namen, ...konstanten) {
  const werte = datei(KOPF, `export { ${["STATUS", ...namen].join(", ")} } from "./status.js";`, ZUSTAND);
  return ausgelagert(context, { vorher: datei(KOPF, STATUS, ...konstanten, ZUSTAND), werte, status: datei(STATUS, ...konstanten) });
}

function grenzen(context, repo, rolle = "bau") {
  const phasendatei = join(probeDirectory(context, {}), "phase.json");
  const auftrag = { id: "A1", art: "umbau", ziel: "Lagere aus", bereich: "src/", erwarteteDateien: [WERTE, STATUS_DATEI], abnahme: "test/werte.test.js" };
  writeFileSync(phasendatei, JSON.stringify({ phase: "probe", issue: 1, entwurf: { "src/": "Entwurf." }, auftraege: [auftrag] }));
  return runIn(repo, process.execPath, [EINSTIEG, "grenzen", phasendatei, "A1", "--rolle", rolle, "--basis", "HEAD~1"]).stdout;
}

test("Quellauslagerung: Konstanten wandern Wort für Wort aus einer Quelldatei in eine neue und werden mit export … from weitergereicht; der Plan hat keinen Teil, die Zeilengrenze zählt nur die Weiterreichung", (context) => {
  const repo = ausgelagert(context);
  erkannt(context, repo);
  const ausgabe = grenzen(context, repo);
  assert.match(ausgabe, /^grün: 2 Dateien geändert, 1 neue Zeilen Produktcode, Rolle bau\.$/m);
  assert.match(ausgabe, /^Hinweis: reine Auslagerung aus src\/werte\.js nach src\/status\.js \(2 Anweisungen Wort für Wort verschoben und weitergereicht\); deren Zeilen zählen nicht als neue Zeilen Produktcode\.$/m);
});

test("Quellauslagerung: als Umbau-Commit plant sie auch auf dem alten Stand nichts; nutzt die alte Datei einen verschobenen Namen selbst, holt sie ihn aus der neuen", (context) => {
  const zustand = ZUSTAND.replace('"aus" : "an"', "STATUS.AUS : STATUS.AN");
  const vorher = datei(KOPF, STATUS, UEBERGAENGE, zustand);
  const werte = datei(`${KOPF}\nimport { STATUS } from "./status.js";`, 'export * from "./status.js";', zustand);
  const ausgabe = erkannt(context, ausgelagert(context, { vorher, werte, nachricht: UMBAU }));
  assert.equal(ausgabe.match(new RegExp(ERKANNT.source, "gm")).length, 2, ausgabe);
});

test("Quellauslagerung: eine geänderte Zeile in der neuen Datei rechnet voll, auch an der Zeilengrenze", (context) => {
  const repo = ausgelagert(context, { status: datei(STATUS.replace('"aus"', '"ab"'), UEBERGAENGE) });
  vollGerechnet(context, repo);
  assert.match(grenzen(context, repo), /^grün: 2 Dateien geändert, 10 neue Zeilen Produktcode, Rolle bau\.$/m);
});

test("Quellauslagerung: ein zugleich geänderter Test rechnet voll", (context) => {
  vollGerechnet(context, ausgelagert(context, { dazu: { "test/werte.test.js": `${WERTE_TEST}// umgebaut\n` } }));
});

test("Quellauslagerung: eine neue Datei, die die alte nur lädt und nicht mit export … from weiterreicht, rechnet voll", (context) => {
  const tot = "const TOT = Object.freeze({ an: 1 });";
  const werte = datei(`${KOPF}\nimport "./tot.js";`, WEITER, ZUSTAND);
  const dazu = { "src/tot.js": datei(tot) };
  vollGerechnet(context, ausgelagert(context, { vorher: datei(KOPF, STATUS, UEBERGAENGE, tot, ZUSTAND), werte, dazu }));
});

test("Quellauslagerung: eine Weiterleitung mit zusätzlicher Logik rechnet voll", (context) => {
  vollGerechnet(context, ausgelagert(context, { werte: datei(KOPF, WEITER, 'export const ENDE = "aus";', ZUSTAND) }));
});

test("Quellauslagerung: ein Schlüssel aus einem nicht eingefrorenen Objekt rechnet voll", (context) => {
  const offen = STATUS.replace("Object.freeze({", "{").replace("});", "};");
  vollGerechnet(context, ausgelagert(context, { vorher: datei(KOPF, offen, UEBERGAENGE, ZUSTAND), status: datei(offen, UEBERGAENGE) }));
});

test("Quellauslagerung: ein berechneter Schlüssel, der auf ein Objekt statt auf einen Text zeigt, rechnet voll", (context) => {
  const objektSchluessel = "export const UEBERGAENGE = Object.freeze({\n  [STATUS]: [STATUS.AUS],\n});";
  vollGerechnet(context, ausgelagert(context, { vorher: datei(KOPF, STATUS, objektSchluessel, ZUSTAND), status: datei(STATUS, objektSchluessel) }));
});

test("Quellauslagerung: ein Wert aus einem Objekt, in dem ein berechneter Schlüssel denselben Namen tragen kann, rechnet voll", (context) => {
  const doppelt = 'export const DOPPELT = Object.freeze({\n  an: 1,\n  [STATUS.AN]: 2,\n});';
  const nachAn = "export const NACH_AN = DOPPELT.an;";
  const werte = datei(KOPF, 'export { STATUS, DOPPELT, NACH_AN } from "./status.js";', ZUSTAND);
  vollGerechnet(context, ausgelagert(context, { vorher: datei(KOPF, STATUS, doppelt, nachAn, ZUSTAND), werte, status: datei(STATUS, doppelt, nachAn) }));
});

test("Quellauslagerung: ist die neue Datei eine symbolische Verknüpfung, rechnet sie voll", (context) => {
  const verknuepft = (repo) => {
    rmSync(join(repo, STATUS_DATEI));
    symlinkSync("../vorlage/status.js", join(repo, STATUS_DATEI));
  };
  vollGerechnet(context, ausgelagert(context, { dazu: { "vorlage/status.js": datei(STATUS, UEBERGAENGE) }, vorDemCommit: verknuepft }));
});

test("Quellauslagerung: mit Rolle test zählt die Zeilengrenze die Zeilen der neuen Datei mit", (context) => {
  const ausgabe = grenzen(context, ausgelagert(context), "test");
  assert.match(ausgabe, /^rot: 2 Dateien geändert, 10 neue Zeilen Produktcode, Rolle test\.$/m);
  assert.doesNotMatch(ausgabe, /^Hinweis: reine Auslagerung/m);
});

test("Quellauslagerung: wandern die Konstanten in eine neue .ts-Datei, rechnet sie voll", (context) => {
  const werte = datei(KOPF, 'export { STATUS, UEBERGAENGE } from "./status.ts";', ZUSTAND);
  const ausgabe = plan(context, ausgelagert(context, { werte, status: null, dazu: { "src/status.ts": datei(STATUS, UEBERGAENGE) } }));
  assert.doesNotMatch(ausgabe, /^reine Auslagerung/m);
  assert.match(ausgabe, /^Teil \d+ von \d+: src\/status\.ts /m);
});

test("Quellauslagerung: ist neben der alten Datei eine zweite Datei unter src/ geändert, rechnet sie voll", (context) => {
  vollGerechnet(context, ausgelagert(context, { dazu: { "src/zahl.js": `${BASIS["src/zahl.js"]}export const NULL = 0;\n` } }));
});

test("Quellauslagerung: ist zugleich eine Datei unter src/ gelöscht, rechnet sie voll", (context) => {
  const geloescht = (repo) => rmSync(join(repo, "src/alt.js"));
  vollGerechnet(context, ausgelagert(context, { basisDazu: { "src/alt.js": "export const ALT = 1;\n" }, vorDemCommit: geloescht }));
});

test("Quellauslagerung: stellt die alte Datei nur ihre Importe um und kommt keine neue Datei dazu, meldet sie keine Auslagerung", (context) => {
  const leer = 'import "./leer.js";';
  const repo = ausgelagert(context, { vorher: datei(KOPF, leer, ZUSTAND), werte: datei(leer, KOPF, ZUSTAND), status: null, basisDazu: { "src/leer.js": "export {};\n" } });
  assert.doesNotMatch(plan(context, repo), /^reine Auslagerung/m);
});

test("Quellauslagerung: ein Wert über einen Getter eines eingefrorenen Objekts rechnet voll", (context) => {
  vollGerechnet(context, mitKonstanten(context, ["MIT_GETTER", "VOM_GETTER"], "export const MIT_GETTER = Object.freeze({ get an() {\n  return 1;\n} });", "export const VOM_GETTER = MIT_GETTER.an;"));
});

test("Quellauslagerung: ein Wert aus einem Objekt mit doppeltem Schlüssel rechnet voll", (context) => {
  vollGerechnet(context, mitKonstanten(context, ["DOPPELT", "VOM_DOPPELT"], "export const DOPPELT = Object.freeze({ an: 1, an: 2 });", "export const VOM_DOPPELT = DOPPELT.an;"));
});

test("Quellauslagerung: ein berechneter Zugriff auf ein eingefrorenes Objekt rechnet voll", (context) => {
  vollGerechnet(context, mitKonstanten(context, ["AN", "PER_NAME"], 'export const AN = "aus";', "export const PER_NAME = STATUS[AN];"));
});

test("Quellauslagerung: ein Zugriff auf eine eingefrorene Liste rechnet voll", (context) => {
  vollGerechnet(context, mitKonstanten(context, ["LISTE", "LAENGE"], 'export const LISTE = Object.freeze(["an"]);', "export const LAENGE = LISTE.length;"));
});

test("Quellauslagerung: ein berechneter Schlüssel, der weder Text noch Zahl ist, rechnet voll", (context) => {
  vollGerechnet(context, mitKonstanten(context, ["MIT_NULL"], "export const MIT_NULL = Object.freeze({ [null]: 1 });"));
});

test("Quellauslagerung: hat der Umbau-Commit eine geänderte Zeile in der neuen Datei, rechnet der alte Stand voll, auch wenn der Arbeitsbaum wieder wortgleich ist", (context) => {
  const repo = ausgelagert(context, { status: datei(STATUS.replace('"aus"', '"ab"'), UEBERGAENGE), nachricht: UMBAU });
  writeFiles(repo, { [STATUS_DATEI]: datei(STATUS, UEBERGAENGE) });
  const ausgabe = plan(context, repo);
  assert.equal(ausgabe.match(new RegExp(ERKANNT.source, "gm"))?.length, 1, ausgabe);
  assert.match(ausgabe, /^Teil 1 von \d+: .*src\/(werte|status)\.js/m);
});
