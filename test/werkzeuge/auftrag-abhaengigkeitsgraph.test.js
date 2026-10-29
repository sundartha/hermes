import assert from "node:assert/strict";
import { test } from "node:test";

import { abhaengigkeitsgraph, ausserhalbBetrifft, vermesse } from "../../tools/auftrag/abhaengigkeitsgraph.mjs";
import { phasenBefunde, reihenfolge } from "../../tools/auftrag/format.mjs";
import { bereicheZwischen, geaenderteBereiche, kollisionen } from "../../tools/auftrag/kollision.mjs";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const QUELLE = [
  "export const ALPHA = 1;",
  "",
  "export function beta() {",
  "  return ALPHA;",
  "}",
  "",
  "export function gamma() {",
  "  return 3;",
  "}",
  "",
  "export function delta() {",
  "  return beta();",
  "}",
  "",
].join("\n");

const TEXTE = { "src/m.js": QUELLE, "src/n.js": "export const NEU = 1;\n" };
const quelle = (datei) => TEXTE[datei] ?? null;

function auftrag(id, extra = {}) {
  return { id, art: "umbau", erwarteteDateien: ["src/m.js", `test/${id}.test.js`], ...extra };
}

function vorgaengerVon(auftraege, kennung) {
  return [...abhaengigkeitsgraph(auftraege, quelle).get(kennung).keys()];
}

test("zwei Aufträge in derselben Datei ohne betrifft hängen aneinander, der spätere am früheren", () => {
  const graph = abhaengigkeitsgraph([auftrag("eins"), auftrag("zwei")], quelle);
  assert.deepEqual([...graph.get("eins").keys()], []);
  assert.deepEqual(graph.get("zwei").get("eins"), ["gleiche Datei src/m.js"]);
});

test("zwei Aufträge mit betrifft auf getrennten Deklarationen sind unabhängig, auch wenn sie nebeneinander stehen", () => {
  const eins = auftrag("eins", { betrifft: { "src/m.js": ["beta"] } });
  const zwei = auftrag("zwei", { betrifft: { "src/m.js": ["gamma"] } });
  assert.deepEqual(vorgaengerVon([eins, zwei], "zwei"), []);
});

test("eine abhaengigVon-Angabe bleibt, auch wenn beide Aufträge gemessen sind und nichts teilen", () => {
  const eins = auftrag("eins", { betrifft: { "src/m.js": ["beta"] } });
  const zwei = auftrag("zwei", { abhaengigVon: ["eins"], betrifft: { "src/m.js": ["gamma"] } });
  assert.deepEqual(vorgaengerVon([eins, zwei], "zwei"), ["eins"]);
});

test("eine namenlose Standard-Ausgabe wird übersprungen, und gleiche Namen in der Datei überschneiden sich weiterhin", () => {
  const text = "export default function () {}\nexport function beta() {\n  return 1;\n}\n";
  const eins = auftrag("eins", { betrifft: { "src/m.js": ["beta"] } });
  const zwei = auftrag("zwei", { betrifft: { "src/m.js": ["beta"] } });
  const graph = abhaengigkeitsgraph([eins, zwei], () => text);
  assert.deepEqual([...graph.get("zwei").keys()], ["eins"]);
});

test("eine abhaengigVon-Angabe bleibt, wenn der spätere Auftrag kein betrifft hat", () => {
  const eins = auftrag("eins", { betrifft: { "src/m.js": ["beta"] } });
  const zwei = auftrag("zwei", { abhaengigVon: ["eins"], erwarteteDateien: ["src/o.js"] });
  assert.deepEqual(vorgaengerVon([eins, zwei], "zwei"), ["eins"]);
});

test("ein Auftrag, dessen Zeilen einen Namen des früheren nennen, hängt am früheren", () => {
  const eins = auftrag("eins", { betrifft: { "src/m.js": ["beta"] } });
  const zwei = auftrag("zwei", { betrifft: { "src/m.js": ["delta"] } });
  const gruende = abhaengigkeitsgraph([eins, zwei], quelle).get("zwei").get("eins");
  assert.deepEqual(gruende, ["zwei nutzt beta aus eins"]);
});

test("nennt der frühere Auftrag den Namen des späteren, hängt der spätere ebenfalls am früheren", () => {
  const eins = auftrag("eins", { betrifft: { "src/m.js": ["delta"] } });
  const zwei = auftrag("zwei", { betrifft: { "src/m.js": ["beta"] } });
  assert.deepEqual(abhaengigkeitsgraph([eins, zwei], quelle).get("zwei").get("eins"), ["eins nutzt beta aus zwei"]);
});

test("derselbe Name in beiden Aufträgen überschneidet die Zeilenbereiche", () => {
  const eins = auftrag("eins", { betrifft: { "src/m.js": ["gamma"] } });
  const zwei = auftrag("zwei", { betrifft: { "src/m.js": ["gamma"] } });
  assert.deepEqual(abhaengigkeitsgraph([eins, zwei], quelle).get("zwei").get("eins"), ["Zeilenbereiche in src/m.js überschneiden sich"]);
});

test("eine Datei, die es am Paketstand nicht gibt, macht beide Aufträge abhängig, auch mit betrifft", () => {
  const eins = auftrag("eins", { erwarteteDateien: ["src/neu.js"], betrifft: { "src/neu.js": ["a"] } });
  const zwei = auftrag("zwei", { erwarteteDateien: ["src/neu.js"], betrifft: { "src/neu.js": ["b"] } });
  assert.deepEqual(abhaengigkeitsgraph([eins, zwei], quelle).get("zwei").get("eins"), ["gleiche neue Zieldatei src/neu.js"]);
});

test("ein Name, den die Datei nicht enthält, gilt als nicht gemessen und fällt auf die Dateiregel zurück", () => {
  const eins = auftrag("eins", { betrifft: { "src/m.js": ["gibtEsNicht"] } });
  const zwei = auftrag("zwei", { betrifft: { "src/m.js": ["gamma"] } });
  assert.deepEqual(abhaengigkeitsgraph([eins, zwei], quelle).get("zwei").get("eins"), ["gleiche Datei src/m.js"]);
});

test("ein gemeinsamer Test hängt den späteren Auftrag an den früheren, auch ohne gemeinsame Quelldatei", () => {
  const eins = auftrag("eins", { erwarteteDateien: ["src/m.js", "test/gemeinsam.test.js"], betrifft: { "src/m.js": ["beta"] } });
  const zwei = auftrag("zwei", { erwarteteDateien: ["src/n.js", "test/gemeinsam.test.js"] });
  assert.deepEqual(abhaengigkeitsgraph([eins, zwei], quelle).get("zwei").get("eins"), ["gleiche Testdatei test/gemeinsam.test.js"]);
});

test("eine abhaengigVon-Angabe auf einen in der Liste späteren Auftrag stellt ihn nach der Ordnung der Phase vor", () => {
  const eins = auftrag("eins", { abhaengigVon: ["zwei"], betrifft: { "src/m.js": ["beta"] } });
  const zwei = auftrag("zwei", { erwarteteDateien: ["src/n.js"] });
  const { ordnung } = reihenfolge([eins, zwei]);
  assert.deepEqual(vorgaengerVon(ordnung, "eins"), ["zwei"]);
});

test("ein betrifft, das nur für eine von zwei gemeinsamen Dateien gilt, fällt auf die Dateiregel zurück", () => {
  const dateien = ["src/m.js", "src/n.js"];
  const eins = auftrag("eins", { erwarteteDateien: dateien, betrifft: { "src/m.js": ["beta"] } });
  const zwei = auftrag("zwei", { erwarteteDateien: dateien, betrifft: { "src/m.js": ["gamma"] } });
  assert.deepEqual(abhaengigkeitsgraph([eins, zwei], quelle).get("zwei").get("eins"), ["gleiche Datei src/m.js", "gleiche Datei src/n.js"]);
});

const DIFF = [
  "diff --git a/src/m.js b/src/m.js",
  "--- a/src/m.js",
  "+++ b/src/m.js",
  "@@ -3,2 +3,0 @@ x",
  "@@ -10 +8,2 @@ y",
  "diff --git a/test/m.test.js b/test/m.test.js",
  "@@ -1,0 +2,3 @@ z",
].join("\n");

test("die geänderten Zeilen eines Diffs werden je Datei als alte Bereiche gelesen, eine Einfügung zählt als Stelle vor und nach", () => {
  assert.deepEqual([...geaenderteBereiche(DIFF)], [["src/m.js", [[3, 4], [10, 10]]], ["test/m.test.js", [[1, 2]]]]);
});

test("zwei Änderungen derselben Quelldatei kollidieren nur, wenn sich ihre Zeilen überschneiden", () => {
  const eigene = new Map([["src/m.js", [[3, 5]]]]);
  assert.deepEqual(kollisionen(eigene, new Map([["src/m.js", [[6, 9]]]])), []);
  assert.deepEqual(kollisionen(eigene, new Map([["src/m.js", [[5, 9]]]])), ["src/m.js: geänderte Zeilen überschneiden sich"]);
});

test("zwei Änderungen derselben Testdatei kollidieren auch an getrennten Zeilen", () => {
  const eigene = new Map([["test/m.test.js", [[1, 2]]]]);
  const fremde = new Map([["test/m.test.js", [[40, 41]]]]);
  assert.deepEqual(kollisionen(eigene, fremde), ["test/m.test.js: beide ändern diese Testdatei"]);
});

function betrifftBefunde(betrifft) {
  const eintrag = { id: "eins", art: "umbau", ziel: "Z", bereich: "src/store/", erwarteteDateien: ["src/store/defaults.js", "test/kyc-gate.test.js"], abnahme: "test/kyc-gate.test.js", betrifft };
  const phase = { phase: "bet", issue: 1, entwurf: { "src/store/": "Entwurf." }, auftraege: [eintrag] };
  return phasenBefunde(phase, REPO_ROOT).filter((befund) => befund.includes("betrifft"));
}

test("betrifft mit Namen einer erwarteten Quelldatei ist gültig und fehlt es ganz, ist das auch gültig", () => {
  assert.deepEqual(betrifftBefunde({ "src/store/defaults.js": ["DEFAULT_GREETING"] }), []);
  assert.deepEqual(betrifftBefunde(undefined), []);
});

test("betrifft wird abgelehnt bei fremder Datei, Testdatei, leerer Liste, Nicht-Namen und falscher Form", () => {
  assert.equal(betrifftBefunde({ "src/store/anders.js": ["a"] }).length, 1);
  assert.equal(betrifftBefunde({ "test/kyc-gate.test.js": ["a"] }).length, 1);
  assert.equal(betrifftBefunde({ "src/store/defaults.js": [] }).length, 1);
  assert.equal(betrifftBefunde({ "src/store/defaults.js": ["a b"] }).length, 1);
  assert.equal(betrifftBefunde(["src/store/defaults.js"]).length, 1);
});

test("bereicheZwischen findet die geänderten Zeilen auch in einer Datei mit Umlaut im Pfad", (context) => {
  const pfad = "src/größe.js";
  const repo = probeRepository(context, { [pfad]: "export const A = 1;\n" });
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  const von = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(repo, { [pfad]: "export const A = 2;\n" });
  commitAll(repo, "Ändere");
  assert.deepEqual(bereicheZwischen({ cwd: repo, von, bis: "HEAD" }).get(pfad), [[1, 1]]);
});

test("ausserhalbBetrifft lässt neben einer Deklaration nur eine leere Zeile zu, keine fremde", () => {
  const faelle = [
    { text: "const A = 1;\nconst B = 2;\n", namen: ["A"], geaendert: [[2, 2]], erwartet: [[2, 2]] },
    { text: "const A = 1;\n\nconst B = 2;\n", namen: ["A"], geaendert: [[2, 2]], erwartet: [] },
    { text: "const A = 1;\n\nconst B = 2;\n", namen: ["B"], geaendert: [[2, 2]], erwartet: [] },
    { text: "const A = 1;\n\nconst B = 2;\n", namen: ["A"], geaendert: [[3, 3]], erwartet: [[3, 3]] },
    { text: 'import { x } from "./x.js";\nconst A = 1;\n', namen: ["A"], geaendert: [[1, 1]], erwartet: [] },
    { text: 'import { x } from "./x.js";\n\nconst A = 1;\nconst B = 2;\n', namen: ["A"], geaendert: [[4, 4]], erwartet: [[4, 4]] },
  ];
  for (const { text, namen, geaendert, erwartet } of faelle) assert.deepEqual(ausserhalbBetrifft(vermesse(text, namen), geaendert), erwartet, text);
});

test("ein Dateikopf mit Anführungszeichen im Namen wird nicht der vorigen Datei zugerechnet und gilt als überschneidende Änderung", () => {
  const diff = ["diff --git a/src/m.js b/src/m.js", "@@ -3 +3 @@ x", 'diff --git "a/src/x\\"y.js" "b/src/x\\"y.js"', "@@ -1 +1 @@ y"].join("\n");
  const bereiche = geaenderteBereiche(diff);
  assert.deepEqual(bereiche.get("src/m.js"), [[3, 3]]);
  assert.deepEqual(kollisionen(bereiche, geaenderteBereiche(diff)).length, 2);
});
