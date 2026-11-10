import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { ausgefuehrteMutanten, schutzOrte } from "../../tools/pruefen.mjs";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const ELTERNWAECHTER = resolve(import.meta.dirname, "../gemeinsam/elternwaechter.mjs");
const QUELLE = [
  "const stryMutAct_9fa48 = () => false;",
  "export function eins() {",
  '  return stryMutAct_9fa48("1") ? 0 : 1;',
  "}",
  "export function zwei() {",
  '  return stryMutAct_9fa48("2") ? 0 : 2;',
  "}",
  "",
].join("\n");
const TESTLAUF = [
  'import { appendFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'appendFileSync("ausgefuehrt.txt", datei + "\\n");',
  'const quelle = await import("../src/quelle.mjs");',
  'if (datei === "test/eins.test.js") quelle.eins();',
  'if (datei === "test/zwei.test.js") quelle.zwei();',
  'process.exitCode = datei === "test/eins.test.js" && process.env.__STRYKER_ACTIVE_MUTANT__ === "1" ? 1 : 0;',
  "",
].join("\n");

function mitOrdner(ablauf) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-zeilen-"));
  try {
    return ablauf(ordner);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Ein Mutant gilt als ausgeführt, wenn der Test seinen Schutzaufruf erreicht, und sonst nicht", () => {
  mitOrdner((ordner) => {
    const quelle = join(ordner, "quelle.mjs");
    writeFileSync(quelle, QUELLE);
    writeFileSync(join(ordner, "test.mjs"), 'import { eins } from "./quelle.mjs";\neins();\n');
    const abdeckung = join(ordner, "abdeckung");
    const lauf = spawnSync(process.execPath, [join(ordner, "test.mjs")], { env: { ...process.env, NODE_V8_COVERAGE: abdeckung } });
    assert.equal(lauf.status, 0);
    const prozesse = readdirSync(abdeckung).map((name) => JSON.parse(readFileSync(join(abdeckung, name), "utf8")).result);
    assert.deepEqual(ausgefuehrteMutanten(prozesse, schutzOrte([quelle])), ["1"]);
  });
});

test("Eine Datei, die ein Prozess nie lädt, führt keinen Mutanten aus", () => {
  const prozesse = [[{ url: "file:///anders.mjs", functions: [{ ranges: [{ startOffset: 0, endOffset: 99, count: 1 }] }] }]];
  assert.deepEqual(ausgefuehrteMutanten(prozesse, { 1: { datei: "/quelle.mjs", offset: 5 } }), []);
});

test("Die Ausführung in irgendeinem Prozess genügt", () => {
  const skript = (count) => [{ url: "file:///quelle.mjs", functions: [{ ranges: [{ startOffset: 0, endOffset: 99, count: 1 }, { startOffset: 4, endOffset: 9, count }] }] }];
  assert.deepEqual(ausgefuehrteMutanten([skript(0), skript(1)], { 1: { datei: "/quelle.mjs", offset: 5 } }), ["1"]);
  assert.deepEqual(ausgefuehrteMutanten([skript(0)], { 1: { datei: "/quelle.mjs", offset: 5 } }), []);
});

function aufbauen(ordner, abdeckung = {}) {
  mkdirSync(join(ordner, "src"));
  mkdirSync(join(ordner, "test"));
  writeFileSync(join(ordner, "src/quelle.mjs"), QUELLE);
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
  for (const datei of ["eins", "zwei", "keins"]) writeFileSync(join(ordner, `test/${datei}.test.js`), "");
  const plan = { frist: Date.now() + 600_000, tests: ["test/eins.test.js", "test/keins.test.js", "test/zwei.test.js"], dateien: ["src/quelle.mjs"], eingebettete: {}, abdeckung, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
  return plan;
}

function mutantLauf(ordner, mutant) {
  spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: mutant, MUTATION_PLAN: join(ordner, "plan.json") } });
  const zeilen = readFileSync(join(ordner, "protokoll.jsonl"), "utf8").trim().split("\n");
  const { dauer, ...urteil } = JSON.parse(zeilen.at(-1));
  assert.equal(typeof dauer, "number");
  return urteil;
}

function messen(ordner, teil = "0", teile = "1") {
  imRepo(ordner, "init", "-q");
  imRepo(ordner, "add", "--", ".");
  const lauf = spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, env: { ...process.env, TEIL: teil, TEILE: teile, __STRYKER_ACTIVE_MUTANT__: undefined, MUTATION_PLAN: join(ordner, "plan.json"), MUTANTEN_ZAEHLEN: "1", MUTATION_ABDECKUNG: join(ordner, "abdeckung") }, encoding: "utf8" });
  assert.equal(lauf.status, 0, lauf.stderr);
  return JSON.parse(readFileSync(join(ordner, "abdeckung", `${teil}.json`), "utf8"));
}

function imRepo(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))) });
}

function ausgefuehrt(ordner) {
  const zaehler = {};
  const datei = join(ordner, "ausgefuehrt.txt");
  for (const name of existsSync(datei) ? readFileSync(datei, "utf8").trim().split("\n") : []) zaehler[name] = (zaehler[name] ?? 0) + 1;
  return zaehler;
}

const GEMESSEN = { "test/eins.test.js": ["1"], "test/zwei.test.js": ["2"], "test/keins.test.js": [] };

test("Ein Mutant in einer Zeile, die nur eine Testdatei ausführt, wird von genau dieser getötet; keine andere läuft", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner, GEMESSEN);
    assert.deepEqual(mutantLauf(ordner, "1"), { id: "1", ergebnis: "getötet", test: "test/eins.test.js", laeufe: 2 });
    assert.deepEqual(ausgefuehrt(ordner), { "test/eins.test.js": 2 });
  });
});

test("Ein Mutant, den die Testdatei mit seiner Zeile nicht tötet, überlebt; die anderen Dateien laufen nicht", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner, GEMESSEN);
    assert.deepEqual(mutantLauf(ordner, "2"), { id: "2", ergebnis: "überlebt", laeufe: 1 });
    assert.deepEqual(ausgefuehrt(ordner), { "test/zwei.test.js": 1 });
  });
});

test("Eine Zeile, die keine Testdatei ausführt, überlebt, ohne dass eine Testdatei läuft", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner, GEMESSEN);
    assert.deepEqual(mutantLauf(ordner, "9"), { id: "9", ergebnis: "überlebt", laeufe: 0 });
    assert.deepEqual(ausgefuehrt(ordner), {});
  });
});

test("Eine Testdatei ohne Abdeckung oder mit null zählt als alles und läuft für jeden Mutanten", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner, { "test/eins.test.js": null });
    assert.deepEqual(mutantLauf(ordner, "2"), { id: "2", ergebnis: "überlebt", laeufe: 3 });
    assert.deepEqual(ausgefuehrt(ordner), { "test/eins.test.js": 1, "test/keins.test.js": 1, "test/zwei.test.js": 1 });
  });
});

test("Ein Mutant, den nur eine Testdatei tötet, die ihn laut Abdeckung ausführt, bleibt getötet, auch wenn Dateien davor ihn nicht ausführen", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner, GEMESSEN);
    const abdeckung = messen(ordner);
    assert.deepEqual(abdeckung, GEMESSEN);
    assert.deepEqual(mutantLauf(ordner, "1"), { id: "1", ergebnis: "getötet", test: "test/eins.test.js", laeufe: 2 });
  });
});

test("Zählen und Teil nennen denselben Mutanten gleich: Die Abdeckung eines Teils ist nach den Schutzaufrufen der Quelle benannt, die der Mutantenlauf liest", () => {
  mitOrdner((ordner) => {
    const plan = aufbauen(ordner);
    const orte = Object.keys(schutzOrte([join(ordner, plan.dateien[0])]));
    const abdeckung = messen(ordner);
    assert.deepEqual(orte.sort(), ["1", "2"]);
    assert.deepEqual(Object.values(abdeckung).flat().sort(), orte);
  });
});

test("Die Messung eines Sechstels deckt nur dessen Testdateien ab; alle Teile zusammen jede einmal", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner);
    const teile = [0, 1, 2].map((teil) => messen(ordner, String(teil), "3"));
    assert.deepEqual(teile.map((teil) => Object.keys(teil)), [["test/eins.test.js"], ["test/keins.test.js"], ["test/zwei.test.js"]]);
    assert.deepEqual(Object.assign({}, ...teile), GEMESSEN);
  });
});

test("Ein Import mit Query oder Hash zählt als dieselbe Datei", () => {
  const skript = (url) => [{ url, functions: [{ ranges: [{ startOffset: 0, endOffset: 99, count: 1 }] }] }];
  const orte = { 1: { datei: "/quelle.mjs", offset: 5 } };
  for (const url of ["file:///quelle.mjs?x", "file:///quelle.mjs#y", "file:///quelle.mjs?x=1#y"]) assert.deepEqual(ausgefuehrteMutanten([skript(url)], orte), ["1"]);
  assert.deepEqual(ausgefuehrteMutanten([skript("file:///quelle.mjs2?x")], orte), []);
});

test("Eine Zeile, die nur ein vom Elternwächter sanft beendeter Kindprozess mit frischer Umgebung ausführt, zählt als ausgeführt", async () => {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-zeilen-"));
  try {
    const quelle = join(ordner, "quelle.mjs");
    writeFileSync(quelle, QUELLE);
    const eintrag = join(ordner, "kind.mjs");
    writeFileSync(eintrag, [`import { starteElternwaechter } from ${JSON.stringify(ELTERNWAECHTER)};`, "starteElternwaechter({ sanft: true });", 'const { eins } = await import("./quelle.mjs?x");', "eins();", 'process.stdout.write("bereit");', "setInterval(() => {}, 1000);", ""].join("\n"));
    const abdeckung = join(ordner, "abdeckung");
    const kind = spawn(process.execPath, [eintrag], { env: { PATH: process.env.PATH, NODE_V8_COVERAGE: abdeckung }, stdio: ["pipe", "pipe", "ignore"] });
    kind.stdout.once("data", () => kind.stdin.end());
    const [code, signal] = await once(kind, "exit");
    assert.equal(signal, null);
    assert.equal(code, 143);
    const prozesse = readdirSync(abdeckung).map((name) => JSON.parse(readFileSync(join(abdeckung, name), "utf8")).result);
    assert.deepEqual(ausgefuehrteMutanten(prozesse, schutzOrte([quelle])), ["1"]);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});

import { basisRotZeilen, mutantReihenfolge, mutationUrteil } from "../../tools/pruefen.mjs";

const TESTLAUF_KONTROLLE = [
  'import { appendFileSync, readFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'appendFileSync("ausgefuehrt.txt", datei + "\\n");',
  'const quelle = await import("../src/quelle.mjs");',
  "quelle.eins();",
  "const mutant = process.env.__STRYKER_ACTIVE_MUTANT__;",
  'let rot = datei === "test/rot.test.js" || mutant === "1";',
  'if (datei === "test/wackel.test.js" && !mutant) {',
  '  appendFileSync("kontrollen.txt", "x");',
  '  rot = readFileSync("kontrollen.txt", "utf8").length === 1;',
  "}",
  "process.exitCode = rot ? 1 : 0;",
  "",
].join("\n");

function aufbauenMitKontrolle(ordner, tests) {
  const plan = { ...aufbauen(ordner), tests };
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF_KONTROLLE);
}

test("Ein Mutant, den nur ein zuvor einmal wackelnder Test tötet, wird getötet", () => {
  mitOrdner((ordner) => {
    aufbauenMitKontrolle(ordner, ["test/wackel.test.js"]);
    assert.deepEqual(mutantLauf(ordner, "1"), { id: "1", ergebnis: "getötet", test: "test/wackel.test.js", laeufe: 3 });
    assert.equal(ausgefuehrt(ordner)["test/wackel.test.js"], 3);
  });
});

test("Eine Testdatei, die zweimal ohne Mutant rot ist, fliegt mit Logzeile für den Rest des Jobs raus; der Mutant überlebt", () => {
  mitOrdner((ordner) => {
    aufbauenMitKontrolle(ordner, ["test/rot.test.js", "test/zwei.test.js"]);
    const erster = mutantLauf(ordner, "2");
    assert.deepEqual(erster, { id: "2", ergebnis: "überlebt", ausgeschlossen: ["test/rot.test.js"], laeufe: 4 });
    assert.deepEqual(basisRotZeilen({ schluessel: "src/quelle.mjs:6/2", ...erster }), ["Basis rot: test/rot.test.js war bei src/quelle.mjs:6/2 zweimal ohne Mutant rot und ist für den Rest des Jobs ausgeschlossen"]);
    assert.equal(ausgefuehrt(ordner)["test/rot.test.js"], 3);
    assert.deepEqual(mutantLauf(ordner, "9"), { id: "9", ergebnis: "überlebt", laeufe: 1 });
    assert.equal(ausgefuehrt(ordner)["test/rot.test.js"], 3);
  });
});

test("Die Reihenfolge je Mutant: geänderte Testdateien zuerst, dann nach Treffern der Mutantenzeile", () => {
  mitOrdner((ordner) => {
    const [alpha, beta, ohne, geaendert] = ["alpha.test.js", "beta.test.js", "ohne.test.js", "geaendert.test.js"].map((name) => join(ordner, name));
    writeFileSync(alpha, 'assert("alpha-text");');
    writeFileSync(beta, 'assert("beta-text");');
    writeFileSync(ohne, "");
    writeFileSync(geaendert, "");
    const plan = { tests: [ohne, beta, alpha, geaendert], geaendert: [geaendert] };
    assert.deepEqual(mutantReihenfolge(plan, '  return stryMutAct_9fa48("1") ? "" : (stryCov_9fa48("1"), "alpha-text");'), [geaendert, alpha, beta, ohne]);
    assert.deepEqual(mutantReihenfolge(plan, '  return stryMutAct_9fa48("2") ? "" : (stryCov_9fa48("2"), "beta-text");'), [geaendert, beta, alpha, ohne]);
    assert.deepEqual(mutantReihenfolge({ tests: [beta, alpha] }, "stryMutAct_9fa48"), [alpha, beta]);
  });
});

test("Namen in einer echt instrumentierten Zeile mit zwei Schutzaufrufen sind Merkmale", () => {
  mitOrdner((ordner) => {
    const [leer, mit] = ["aaa.test.js", "mit.test.js"].map((name) => join(ordner, name));
    writeFileSync(leer, "");
    writeFileSync(mit, "normalized");
    const zeile = '  if (stryMutAct_9fa48("3") ? normalized !== "true" : (stryCov_9fa48("3"), normalized === "true")) return 1;';
    assert.deepEqual(mutantReihenfolge({ tests: [leer, mit] }, zeile), [mit, leer]);
  });
});

test("Ein nicht getöteter Mutant bleibt rot, auch bei „nicht geprüft (Frist)“", () => {
  const mutant = (ergebnis) => ({ schluessel: "src/quelle.mjs:3/1", mutation: "StringLiteral: \"\"", ergebnis });
  assert.equal(mutationUrteil([mutant("getötet")], 1), true);
  for (const ergebnis of ["überlebt", "nicht geprüft (Frist)"]) assert.equal(mutationUrteil([mutant(ergebnis)], 1), false);
});

test("Eine Begründung im PR-Text macht nur einen überlebenden Mutanten grün, einen „nicht geprüft (Frist)“ nie", () => {
  const mutant = (ergebnis) => ({ schluessel: "src/quelle.mjs:3/1", mutation: "StringLiteral: \"\"", ergebnis });
  const vorher = process.env.PR_TEXT;
  process.env.PR_TEXT = "## Überlebende Mutanten\n\n- `src/quelle.mjs:3/1`: äquivalent, der Text ändert nur die Anzeige und kein Ergebnis\n";
  try {
    assert.equal(mutationUrteil([mutant("überlebt")], 1), true);
    assert.equal(mutationUrteil([mutant("nicht geprüft (Frist)")], 1), false);
  } finally {
    if (vorher === undefined) delete process.env.PR_TEXT;
    else process.env.PR_TEXT = vorher;
  }
});

const QUELLE_MERKMAL = [QUELLE, "export function drei() {", '  return stryMutAct_9fa48("3") ? "" : "zeilen-merkmal";', "}", ""].join("\n");
const TESTLAUF_REIHENFOLGE = [
  'import { appendFileSync, readFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'appendFileSync("ausgefuehrt.txt", datei + "\\n");',
  'const quelle = await import("../src/quelle.mjs");',
  "quelle.drei();",
  "const mutant = process.env.__STRYKER_ACTIVE_MUTANT__;",
  'const vierteFruehereDateiGestartet = () => readFileSync("ausgefuehrt.txt", "utf8").split("\\n").filter((name) => name.startsWith("test/a")).length > 3;',
  'if (mutant && datei !== "test/z-treffer.test.js") await new Promise((bisEinUeberzaehligerLaufStartet) => { const takt = setInterval(() => vierteFruehereDateiGestartet() && (clearInterval(takt), bisEinUeberzaehligerLaufStartet()), 10); });',
  'process.exitCode = mutant && datei === "test/z-treffer.test.js" ? 1 : 0;',
  "",
].join("\n");

test("Die Zeile des Mutanten bestimmt, welche Testdateien zuerst laufen: Die Datei mit ihrem Merkmal steht vor vier früheren Namen", () => {
  mitOrdner((ordner) => {
    const plan = aufbauen(ordner);
    const tests = [...[1, 2, 3, 4, 5].map((nummer) => `test/a${nummer}.test.js`), "test/z-treffer.test.js"];
    writeFileSync(join(ordner, "src/quelle.mjs"), QUELLE_MERKMAL);
    writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF_REIHENFOLGE);
    for (const datei of tests) writeFileSync(join(ordner, datei), datei.includes("treffer") ? '// prüft "zeilen-merkmal"\n' : "");
    writeFileSync(join(ordner, "plan.json"), JSON.stringify({ ...plan, tests }));
    assert.deepEqual(mutantLauf(ordner, "3"), { id: "3", ergebnis: "getötet", test: "test/z-treffer.test.js", laeufe: 5 });
    assert.deepEqual(Object.keys(ausgefuehrt(ordner)).sort(), ["test/a1.test.js", "test/a2.test.js", "test/a3.test.js", "test/z-treffer.test.js"]);
  });
});
