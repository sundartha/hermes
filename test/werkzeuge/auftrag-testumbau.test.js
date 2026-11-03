import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { phasenBefunde } from "../../tools/auftrag/format.mjs";
import { prueflisteSoll } from "../../tools/auftrag/planung/antworten.mjs";
import { BASIS, EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const MUTATION = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const UMBAU_AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
const NIE = { wiederholung: "-", gleichzeitig: "-", zeitueberschreitung: "-", abbruch: "-" };
const ABSATZ_PRODUKT_IM_TEST = "Zweck grenzen/produkt-im-test: Drehbuchtext des Ersatz-Agenten.";

function auftrag(felder) {
  return {
    id: "A1",
    art: "testumbau",
    ziel: "Ziehe die Vorbereitung in eine Hilfe",
    bereich: "test/",
    erwarteteDateien: ["test/text.test.js", "test/hilfe.js"],
    vorbild: "test/text.test.js",
    abnahme: "test/text.test.js",
    prueft: UMBAU_AUSWEG,
    ...felder,
  };
}

function befunde(eintrag) {
  return phasenBefunde({ phase: "P-1-probe", entwurf: { [eintrag.bereich]: "Entwurf." }, auftraege: [eintrag] }, REPO_ROOT);
}

test("Testumbau: ein Umbau nur aus Tests muss testumbau heißen, ein testumbau braucht einen Bereich nur aus Tests und ändert keinen Produktcode", () => {
  const abnahme = "test/website-onboarding/portal-zugang.test.js";
  const gueltig = auftrag({ bereich: "test/website-onboarding/", erwarteteDateien: ["test/website-onboarding/hilfe.js"], vorbild: abnahme, abnahme });
  assert.deepEqual(befunde(gueltig), []);
  assert.match(befunde({ ...gueltig, art: "umbau" }).join("\n"), /A1: bereich test\/website-onboarding\/ umfasst nur Tests; ein reiner Testumbau hat art testumbau/);
  assert.match(befunde({ ...gueltig, bereich: "src/" }).join("\n"), /A1: ein testumbau braucht einen bereich, der nur Tests umfasst, nicht src\//);
  assert.match(befunde({ ...gueltig, erwarteteDateien: ["test/website-onboarding/hilfe.js", "test/website-onboarding/x.js", "src/x.js"] }).join("\n"), /ein testumbau ändert keinen Produktcode; erwartete Datei src\/x\.js ist keine Testdatei/);
  assert.match(befunde({ ...gueltig, prueft: ["S1"] }).join("\n"), /prueft muss bei einem Umbau genau/);
  assert.ok(prueflisteSoll({ auftraege: [gueltig] }, new Map(), []).includes("umbau:A1"));
});

const ZAHL = 'export function einordnen(zahl) {\n  if (zahl < 0) return "negativ";\n  return "positiv";\n}\n';
const ZEILE_DER_NEGATIV_PRUEFUNG = 2;
const HILFE = 'import { einordnen } from "../src/zahl.js";\nexport const ordne = (zahl) => einordnen(zahl);\n';

function zahlTest(kopf, ...faelle) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    kopf,
    ...faelle.map(([name, zahl, wert]) => `test("${name}", () => assert.equal(ordne(${zahl}), "${wert}"));`),
    "",
  ].join("\n");
}

const DIREKT = 'import { einordnen as ordne } from "../src/zahl.js";';
const UEBER_HILFE = 'import { ordne } from "./hilfe.js";';
const NEGATIV = ["negativ", -1, "negativ"];
const POSITIV = ["positiv", 1, "positiv"];

function zahlRepo(context, dateien = {}) {
  return probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    ".gitignore": "node_modules/\n",
    "src/zahl.js": ZAHL,
    "test/zahl.test.js": zahlTest(DIREKT, NEGATIV, POSITIV),
    ...dateien,
  });
}

function faelle(repo) {
  const lauf = spawnSync(process.execPath, [EINSTIEG, "testumbau", "--basis", "HEAD"], { cwd: repo, encoding: "utf8", env: isolatedEnvironment() });
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test("Testumbau-Fälle: ein Umbau, der jeden Fall vorher und nachher grün lässt, ist grün und nennt entfernte Fälle", (context) => {
  const repo = zahlRepo(context);
  writeFiles(repo, { "test/hilfe.js": HILFE, "test/zahl.test.js": zahlTest(UEBER_HILFE, NEGATIV, POSITIV) });
  const gruen = faelle(repo);
  assert.equal(gruen.status, 0, gruen.ausgabe);
  assert.match(gruen.ausgabe, /grün: 2 Testdateien geändert, 1 betroffene Testdateien vor und nach dem Umbau gelaufen, 0 Fälle entfernt/);
  writeFiles(repo, { "test/zahl.test.js": zahlTest(UEBER_HILFE, NEGATIV) });
  const entfernt = faelle(repo);
  assert.equal(entfernt.status, 0, entfernt.ausgabe);
  assert.match(entfernt.ausgabe, /^Entfernt: test\/zahl\.test\.js: positiv$/m);
  writeFiles(repo, { "test/zahl.test.js": zahlTest(UEBER_HILFE, NEGATIV, POSITIV).replace('test("positiv"', 'test.skip("positiv"') });
  const still = faelle(repo);
  assert.equal(still.status, 0, still.ausgabe);
  assert.match(still.ausgabe, /^Entfernt: test\/zahl\.test\.js: positiv$/m);
});

test("Testumbau-Fälle: ein Fall, der nach dem Umbau rot ist, eine geänderte Hilfe, die einen anderen Test rot macht, und ein Umbau ohne Änderung sind rot", (context) => {
  const repo = zahlRepo(context, { "test/hilfe.js": HILFE, "test/nutzer.test.js": zahlTest(UEBER_HILFE, POSITIV) });
  writeFiles(repo, { "test/zahl.test.js": zahlTest(DIREKT, NEGATIV, ["positiv", 1, "negativ"]) });
  const rot = faelle(repo);
  assert.equal(rot.status, EXIT_ROT, rot.ausgabe);
  assert.match(rot.ausgabe, /Verstoß: test\/zahl\.test\.js: Der Fall „positiv“ ist nach dem Umbau rot\./);
  runIn(repo, "git", ["checkout", "-q", "--", "test/zahl.test.js"]);
  writeFiles(repo, { "test/hilfe.js": HILFE.replace("einordnen(zahl)", "einordnen(-zahl)") });
  const hilfe = faelle(repo);
  assert.equal(hilfe.status, EXIT_ROT, hilfe.ausgabe);
  assert.match(hilfe.ausgabe, /Verstoß: test\/nutzer\.test\.js: Der Fall „positiv“ ist nach dem Umbau rot\./);
  runIn(repo, "git", ["checkout", "-q", "--", "test/hilfe.js"]);
  const leer = faelle(repo);
  assert.equal(leer.status, EXIT_ROT, leer.ausgabe);
  assert.match(leer.ausgabe, /Verstoß: Der Testumbau hat keine Testdatei geändert\./);
  writeFiles(repo, { "test/hilfe.js": `${HILFE}export const EINS = 1;\n`, "test/daten/zahlen.json": "[1]\n" });
  const unerreicht = faelle(repo);
  assert.equal(unerreicht.status, EXIT_ROT, unerreicht.ausgabe);
  assert.match(unerreicht.ausgabe, /^Verstoß: Kein ausführbarer Test erreicht die geänderte Datei test\/daten\/zahlen\.json; ihre Wirkung ist nicht messbar\.$/m);
  assert.doesNotMatch(unerreicht.ausgabe, /erreicht die geänderte Datei test\/hilfe\.js/);
});

function grenzen(context, { art, erwarteteDateien = ["test/hilfe.js", "test/neu.js", "test/zahl.test.js"] }, dateien) {
  const repo = zahlRepo(context, { "test/hilfe.js": HILFE });
  const eintrag = auftrag({ art, erwarteteDateien, vorbild: "test/zahl.test.js", abnahme: "test/zahl.test.js" });
  if (art !== "testumbau") Object.assign(eintrag, { bereich: "src/zahl.js", erwarteterFehler: "x", wasDarfNiePassieren: NIE, prueft: undefined });
  const ordner = probeDirectory(context, { "phase.json": JSON.stringify({ phase: "probe", entwurf: { [eintrag.bereich]: "Entwurf." }, auftraege: [eintrag] }) });
  const phase = join(ordner, "phase.json");
  writeFiles(repo, dateien);
  const lauf = spawnSync(process.execPath, [EINSTIEG, "grenzen", phase, "A1", "--rolle", "test", "--basis", "HEAD"], { cwd: repo, encoding: "utf8", env: isolatedEnvironment() });
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test("Testumbau-Grenzen: eine bestehende Testhilfe ändert der Test-Agent nur im testumbau, eine neue auch im Verhaltensschritt", (context) => {
  const geaendert = { "test/hilfe.js": `${HILFE}export const ZWEI = 2;\n` };
  const verhalten = grenzen(context, { art: "funktion" }, geaendert);
  assert.equal(verhalten.status, EXIT_ROT, verhalten.ausgabe);
  assert.match(verhalten.ausgabe, /Verstoß: Der Test-Agent hat eine bestehende Testhilfe geändert: test\/hilfe\.js; Testhilfen ändert nur ein testumbau/);
  const umbau = grenzen(context, { art: "testumbau" }, geaendert);
  assert.equal(umbau.status, 0, umbau.ausgabe);
  const neu = grenzen(context, { art: "funktion" }, { "test/neu.js": "export const DREI = 3;\n" });
  assert.equal(neu.status, 0, neu.ausgabe);
});

test("Testumbau-Grenzen: den Abnahmetest ändert der Test-Agent im testumbau nur, wenn er unter den erwarteten Dateien steht", (context) => {
  const geaendert = { "test/zahl.test.js": zahlTest(DIREKT, POSITIV) };
  const ohne = grenzen(context, { art: "testumbau", erwarteteDateien: ["test/hilfe.js"] }, geaendert);
  assert.equal(ohne.status, EXIT_ROT, ohne.ausgabe);
  assert.match(ohne.ausgabe, /Verstoß: Der Test-Agent hat einen fremden Test geändert: test\/zahl\.test\.js/);
  const mit = grenzen(context, { art: "testumbau" }, geaendert);
  assert.equal(mit.status, 0, mit.ausgabe);
});

const UMGEBAUT = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { gross } from "../src/text.js";\nconst A = "A";\ntest("gross", () => assert.equal(gross("a"), A));\n';

function testumbauLauf(context, drehbuch) {
  const eintrag = auftrag({ erwarteteDateien: ["test/text.test.js"] });
  return starte(context, { auftrag: eintrag, drehbuch });
}

test("Testumbau-Lauf: der Test-Agent baut um, das Skript prüft vorher und nachher und committet als testumbau ohne Bau-Agenten", (context) => {
  const { lauf, werkzeug, beleg, repo } = testumbauLauf(context, { test: { "test/text.test.js": UMGEBAUT } });
  assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`);
  assert.deepEqual(beleg.pruefungen.map(({ name }) => name), ["abnahme vorher", "grenzen test", "testumbau fälle", "lint", "abnahme", "commit"]);
  assert.match(readFileSync(join(werkzeug, "prompt-test.txt"), "utf8"), /## Testumbau/);
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
  assert.match(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout, /^Art: testumbau$/m);
});

test("Testumbau-Lauf: ein entfernter Fall braucht eine Zeile Entfernt mit Grund, die dann in der Commit-Nachricht steht", (context) => {
  const ohneFall = 'import { test } from "node:test";\n';
  const ohne = testumbauLauf(context, { test: { "test/text.test.js": ohneFall } });
  assert.equal(ohne.lauf.status, EXIT_ROT);
  assert.match(ohne.beleg.grund, /entfernt Fälle, die die Antwort nicht .* nennt: test\/text\.test\.js: gross/);
  const mit = testumbauLauf(context, { test: { "test/text.test.js": `${ohneFall}test("klein", () => {});\n` }, "test-antwort": "Fertig.\nEntfernt: test/text.test.js: gross, weil die Probe es so will" });
  assert.equal(mit.lauf.status, 0, `${mit.lauf.stdout}${mit.lauf.stderr}`);
  assert.match(runIn(mit.repo, "git", ["log", "-1", "--format=%B"]).stdout, /^Entfernt: test\/text\.test\.js: gross, weil die Probe es so will$/m);
});

test("Testumbau-Lauf: ändert der Test-Agent Produktcode oder macht er den Abnahmetest rot, committet das Skript nichts", (context) => {
  const produkt = testumbauLauf(context, { test: { "src/text.js": `${BASIS["src/text.js"]}export const X = 1;\n` }, "test-antwort": ABSATZ_PRODUKT_IM_TEST });
  assert.equal(produkt.lauf.status, EXIT_ROT);
  assert.equal(produkt.kopf, produkt.basis);
  assert.deepEqual([produkt.beleg.grund, produkt.beleg.pruefungen.map(({ name }) => name)], ["grenzen test endete mit Exit 1.", ["abnahme vorher", "grenzen test"]]);
  const rot = testumbauLauf(context, { test: { "test/text.test.js": UMGEBAUT.replace('const A = "A"', 'const A = "B"') } });
  assert.equal(rot.lauf.status, EXIT_ROT);
  assert.equal(rot.kopf, rot.basis);
  assert.deepEqual([rot.beleg.grund, rot.beleg.pruefungen.map(({ name }) => name)], ["testumbau fälle endete mit Exit 1.", ["abnahme vorher", "grenzen test", "testumbau fälle"]]);
});

function mutation(repo) {
  const lauf = runIn(repo, process.execPath, [MUTATION, "--basis", "HEAD", "--testumbau"]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test("Testumbau-Mutation: verschiebt der Umbau eine Prüfung in eine Hilfe, bleibt jeder Mutant getötet; fällt eine Prüfung weg, ist er rot mit dem Mutanten", (context) => {
  const repo = zahlRepo(context);
  writeFiles(repo, { "test/hilfe.js": HILFE, "test/zahl.test.js": zahlTest(UEBER_HILFE, NEGATIV, POSITIV) });
  const gruen = mutation(repo);
  assert.equal(gruen.status, 0, gruen.ausgabe);
  assert.match(gruen.ausgabe, /grün: \d+ vorher getötete Mutanten in 1 Quelldateien \(src\/zahl\.js\) werden nach dem Testumbau weiter getötet\./);
  writeFiles(repo, { "test/zahl.test.js": zahlTest(UEBER_HILFE, POSITIV) });
  const rot = mutation(repo);
  assert.equal(rot.status, EXIT_ROT, rot.ausgabe);
  assert.match(rot.ausgabe, new RegExp(`^Verstoß: Mutant nicht mehr getötet: src/zahl\\.js:${ZEILE_DER_NEGATIV_PRUEFUNG}:`, "m"));
  assert.match(rot.ausgabe, /die umgebauten Tests prüfen weniger als vorher/);
});

test("Testumbau-Mutation: trifft die Vorher-Seite den Speicher, ist ein Umbau trotzdem rot, wenn eine Prüfung wegfällt", (context) => {
  const repo = zahlRepo(context);
  writeFiles(repo, { "test/hilfe.js": HILFE, "test/zahl.test.js": zahlTest(UEBER_HILFE, POSITIV) });
  const erst = mutation(repo);
  const wieder = mutation(repo);
  assert.equal(erst.status, EXIT_ROT, erst.ausgabe);
  assert.doesNotMatch(erst.ausgabe, /Vorher-Seite aus dem Speicher/);
  assert.match(wieder.ausgabe, /Vorher-Seite aus dem Speicher/);
  assert.equal(wieder.status, EXIT_ROT, wieder.ausgabe);
  assert.match(wieder.ausgabe, new RegExp(`^Verstoß: Mutant nicht mehr getötet: src/zahl\\.js:${ZEILE_DER_NEGATIV_PRUEFUNG}:`, "m"));
});
