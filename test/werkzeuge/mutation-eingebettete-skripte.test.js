import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const AUSFUEHRBAR = 0o755;
const KATALOG = [
  'export const eingebettet = new URL("./eingebettet.js", import.meta.url);',
  'export const fremd = new URL("./fremd.js", "https://beispiel.invalid/");',
  "",
].join("\n");
const BERICHT_SCHREIBER = [
  'import { readFileSync, writeFileSync } from "node:fs";',
  "const konfiguration = JSON.parse(readFileSync(process.argv[4], 'utf8'));",
  "const mutant = { id: '4', mutatorName: 'BooleanLiteral', replacement: 'false', location: { start: { line: 1 } } };",
  "writeFileSync(konfiguration.jsonReporter.fileName, JSON.stringify({ files: { 'src/ui/eingebettet.js': { mutants: [mutant] } } }));",
  "",
].join("\n");

function umgebungOhneGit(zusatz) {
  const eintraege = Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && name !== "TEIL" && name !== "TEILE");
  return { ...Object.fromEntries(eintraege), ...zusatz };
}

function imRepo(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: umgebungOhneGit({}), encoding: "utf8" }).trim();
}

function legeAn(ordner, pfad, inhalt) {
  mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
  writeFileSync(join(ordner, pfad), inhalt);
}

function programm(pfad, zeilen) {
  writeFileSync(pfad, ["#!/bin/sh", ...zeilen, ""].join("\n"));
  chmodSync(pfad, AUSFUEHRBAR);
}

function baueProbe(arbeit) {
  const ordner = join(arbeit, "repo");
  const attrappen = join(arbeit, "bin");
  mkdirSync(ordner);
  mkdirSync(attrappen);
  imRepo(ordner, "init", "-q");
  legeAn(ordner, "src/ui/katalog.js", KATALOG);
  legeAn(ordner, "src/ui/eingebettet.js", "globalThis.a = 1;\n");
  legeAn(ordner, "src/ui/fremd.js", "globalThis.b = 1;\n");
  legeAn(ordner, "test/katalog.test.js", 'import "./helfer.js";\n');
  imRepo(ordner, "add", "--", ".");
  imRepo(ordner, "commit", "-q", "-m", "basis");
  const graph = { modules: [{ source: "test/katalog.test.js", dependencies: [{ resolved: "src/ui/katalog.js" }] }], summary: { violations: [] } };
  mkdirSync(join(ordner, "node_modules/.bin"), { recursive: true });
  programm(join(ordner, "node_modules/.bin/depcruise"), [`printf '%s' '${JSON.stringify(graph)}'`]);
  writeFileSync(join(arbeit, "bericht.mjs"), BERICHT_SCHREIBER);
  programm(join(attrappen, "npx"), [`node "${join(arbeit, "bericht.mjs")}" "$@"`]);
  return { ordner, basis: imRepo(ordner, "rev-parse", "HEAD"), attrappen };
}

function mutationsLauf({ ordner, basis, attrappen }, zusatz = {}) {
  const ergebnis = spawnSync("node", [PRUEFEN, "mutation", "--basis", basis], {
    cwd: ordner,
    env: umgebungOhneGit({ PATH: `${attrappen}:${process.env.PATH}`, ...zusatz }),
    encoding: "utf8",
  });
  return { gruen: ergebnis.status === 0, text: ergebnis.stdout + ergebnis.stderr };
}

function mitProbe(ablauf) {
  const arbeit = mkdtempSync(join(tmpdir(), "mutation-einbettung-"));
  try {
    return ablauf(baueProbe(arbeit));
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

function aendere(probe, pfad) {
  writeFileSync(join(probe.ordner, pfad), "globalThis.geaendert = 2;\n");
}

test("Tests des Katalogs erreichen ein Skript, das er über import.meta.url einbettet", () => {
  mitProbe((probe) => {
    legeTestAn(probe, "test/katalog.test.js", 'import "./helfer.js";\nexport const skript = "eingebettet.js";\n');
    assert.deepEqual(messeAbdeckung(probe, "eingebettet"), { "test/katalog.test.js": [MUTANT_IM_SKRIPT] });
  });
});

test("Ein URL-Verweis ohne import.meta.url macht eine Datei nicht erreichbar", () => {
  mitProbe((probe) => {
    legeTestAn(probe, "test/katalog.test.js", 'import "./helfer.js";\nexport const skript = "fremd.js";\n');
    assert.deepEqual(messeAbdeckung(probe, "fremd"), { "test/katalog.test.js": [] });
  });
});

test("Ohne Teilangabe zählt der Lauf jeden Mutanten als ein einziger Teil", () => {
  mitProbe((probe) => {
    aendere(probe, "src/ui/eingebettet.js");
    const { text, gruen } = mutationsLauf(probe);
    assert.match(text, /### Mutation 1\/1 auf den geänderten Zeilen/);
    assert.match(text, /0 von 1 Mutanten getötet, 1 von 1 übrigen ohne Begründung/);
    assert.doesNotMatch(text, /NaN/);
    assert.equal(gruen, false);
  });
});

test("Ein Lauf ohne geänderte Zeilen meldet sich als leer und nennt keine Zählung", () => {
  mitProbe((probe) => {
    const { text, gruen } = mutationsLauf(probe);
    assert.match(text, /Leerer Lauf: keine Mutanten auf geänderten Zeilen unter src\/, nichts geprüft\./);
    assert.doesNotMatch(text, /0 von 0|NaN/);
    assert.equal(gruen, true);
  });
});

test("Ein leerer Teil nennt seine Nummer aus der CI-Angabe", () => {
  mitProbe((probe) => {
    const { text } = mutationsLauf(probe, { TEIL: "1", TEILE: "2" });
    assert.match(text, /### Mutation 2\/2 auf den geänderten Zeilen/);
  });
});

test("Eine im PR geänderte Testdatei steht in der Planzeile vor allen, die unverändert sind", () => {
  mitProbe((probe) => {
    for (const pfad of ["test/a-alt.test.js", "test/z-neu.test.js"]) legeTestAn(probe, pfad, "");
    imRepo(probe.ordner, "commit", "-q", "-m", "tests");
    const basis = imRepo(probe.ordner, "rev-parse", "HEAD");
    legeTestAn(probe, "test/z-neu.test.js", "// geändert\n");
    aendere(probe, "src/ui/eingebettet.js");
    const { text } = mutationsLauf({ ...probe, basis });
    assert.match(text, /src\/ui\/eingebettet\.js:1-1: 0 von 3 Testdateien mit Abdeckung, zuerst die im PR geänderten: test\/z-neu\.test\.js\n/);
  });
});

const PROTOKOLL_SCHREIBER = [
  'import { appendFileSync, readFileSync } from "node:fs";',
  "const plan = JSON.parse(readFileSync(process.env.MUTATION_PLAN, 'utf8'));",
  "appendFileSync(plan.protokoll, JSON.stringify({ id: '4', ergebnis: 'überlebt', ausgeschlossen: ['test/katalog.test.js'], dauer: 12, laeufe: 3 }) + '\\n');",
  "",
].join("\n");

test("Ein Mutant, bei dem eine Testdatei als Basis rot ausgeschlossen wurde, bekommt in der Ausgabe eine Zeile „Basis rot …“", () => {
  mitProbe((probe) => {
    writeFileSync(join(probe.attrappen, "protokoll.mjs"), PROTOKOLL_SCHREIBER);
    programm(join(probe.attrappen, "npx"), [`node "${join(probe.attrappen, "..", "bericht.mjs")}" "$@"`, `node "${join(probe.attrappen, "protokoll.mjs")}"`]);
    aendere(probe, "src/ui/eingebettet.js");
    const zeilen = mutationsLauf(probe).text.split("\n");
    const eigene = zeilen.findIndex((zeile) => zeile.startsWith("src/ui/eingebettet.js:1/4 "));
    assert.match(zeilen[eigene], / → überlebt {2}\(12 s, 3 Läufe\)$/);
    assert.equal(zeilen[eigene + 1], "Basis rot: test/katalog.test.js war bei src/ui/eingebettet.js:1/4 zweimal ohne Mutant rot und ist für den Rest des Jobs ausgeschlossen");
  });
});

const AKTIVER_MUTANT = "7";
const STRYKER_KOPF = [
  "function stryNS_9fa48() {",
  "  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function(\"return this\")();",
  "  var ns = g.__stryker__ || (g.__stryker__ = {});",
  "  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {",
  "    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;",
  "  }",
  "  function retrieveNS() { return ns; }",
  "  stryNS_9fa48 = retrieveNS;",
  "  return retrieveNS();",
  "}",
  "stryNS_9fa48();",
  "function stryMutAct_9fa48(id) { return stryNS_9fa48().activeMutant === id; }",
].join("\n");
const KIND_UMGEBUNG = pathToFileURL(resolve(import.meta.dirname, "../gemeinsam/kind-umgebung.mjs")).href;
const SANDBOX_AUSWERTUNG = [
  'import vm from "node:vm";',
  "const sandbox = {};",
  "vm.runInNewContext(skripttext, sandbox);",
  'appendFileSync("beobachtet.jsonl", JSON.stringify({ mutant: process.env.__STRYKER_ACTIVE_MUTANT__ ?? null, ergebnis: sandbox.ergebnis }) + "\\n");',
  'process.exitCode = sandbox.ergebnis === "an" ? 1 : 0;',
  "",
];
const LIEST_SELBST = [
  'import { appendFileSync, readFileSync } from "node:fs";',
  'const skripttext = readFileSync("src/ui/eingebettet.js", "utf8");',
  ...SANDBOX_AUSWERTUNG,
].join("\n");
const HOLT_VOM_SERVER = [
  'import { spawnSync } from "node:child_process";',
  'import { appendFileSync } from "node:fs";',
  "import { kindUmgebung } from " + JSON.stringify(KIND_UMGEBUNG) + ";",
  'const skripttext = spawnSync(process.execPath, ["test/gestarteter-server.mjs"], { env: kindUmgebung(), encoding: "utf8" }).stdout;',
  ...SANDBOX_AUSWERTUNG,
].join("\n");
const GESTARTETER_SERVER = [
  'import { readFileSync } from "node:fs";',
  'process.stdout.write(readFileSync("src/ui/eingebettet.js", "utf8"));',
  "",
].join("\n");
const KIND_STARTER = [
  'import { spawnSync } from "node:child_process";',
  'process.exitCode = spawnSync(process.execPath, [process.argv[3]], { stdio: "inherit" }).status;',
  "",
].join("\n");

function legeTestAn(probe, pfad, inhalt) {
  legeAn(probe.ordner, pfad, inhalt);
  imRepo(probe.ordner, "add", "--", pfad);
}

function setzeSkript(probe, inhalt) {
  legeAn(probe.ordner, "src/ui/eingebettet.js", inhalt);
}

const MUTANT_IM_SKRIPT = "4";

function messeAbdeckung({ ordner, attrappen }, skript, eigenerGraph) {
  const arbeit = dirname(ordner);
  const tests = imRepo(ordner, "ls-files", "test").split("\n").filter((pfad) => pfad.endsWith(".test.js"));
  const graph = eigenerGraph ?? { modules: tests.map((source) => ({ source, dependencies: [{ resolved: "src/ui/katalog.js" }] })), summary: { violations: [] } };
  programm(join(ordner, "node_modules/.bin/depcruise"), [`printf '%s' '${JSON.stringify(graph)}'`]);
  const text = readFileSync(join(ordner, `src/ui/${skript}.js`), "utf8");
  legeAn(ordner, `src/ui/${skript}.js`, `${text}void stryMutAct_9fa48("${MUTANT_IM_SKRIPT}");\n`);
  legeAn(ordner, "test/testbaenke-run.mjs", "");
  const plan = join(arbeit, "plan.json");
  writeFileSync(plan, JSON.stringify({ frist: Date.now() + 600_000, tests, dateien: [`src/ui/${skript}.js`], protokoll: join(arbeit, "protokoll.jsonl"), basisRot: join(arbeit, "basis-rot.json") }));
  const umgebung = umgebungOhneGit({ PATH: `${attrappen}:${process.env.PATH}`, TEIL: "0", TEILE: "1", MUTATION_PLAN: plan, MUTANTEN_ZAEHLEN: "1", MUTATION_ABDECKUNG: join(arbeit, "abdeckung") });
  delete umgebung.__STRYKER_ACTIVE_MUTANT__;
  const lauf = spawnSync("node", [PRUEFEN, "mutant"], { cwd: ordner, env: umgebung, encoding: "utf8" });
  assert.equal(lauf.status, 0, lauf.stderr);
  return JSON.parse(readFileSync(join(arbeit, "abdeckung/0.json"), "utf8"));
}

function erreichteTests(probe, graph) {
  return Object.values(messeAbdeckung(probe, "eingebettet", graph)).filter((ids) => ids.includes(MUTANT_IM_SKRIPT)).length;
}

const NENNT_NICHT = 'export default "src/ui/katalog.js";\n';

test("Ein Test, der den Katalog erreicht und das Skript nicht nennt, zählt nicht", () => {
  mitProbe((probe) => {
    setzeSkript(probe, "window.HermesProbe = {};\n");
    legeTestAn(probe, "test/nennt-nicht.test.js", NENNT_NICHT);
    assert.equal(erreichteTests(probe), 0);
  });
});

test("Ein Test, der den Katalog erreicht und den Dateinamen des Skripts nennt, zählt", () => {
  mitProbe((probe) => {
    setzeSkript(probe, "window.HermesProbe = {};\n");
    legeTestAn(probe, "test/nennt-datei.test.js", `${NENNT_NICHT}// eingebettet.js\n`);
    assert.equal(erreichteTests(probe), 1);
  });
});

test("Ein Test, der ein vom Skript gesetztes Global nennt, zählt", () => {
  mitProbe((probe) => {
    setzeSkript(probe, "window.HermesProbe = {};\n");
    legeTestAn(probe, "test/nennt-global.test.js", `${NENNT_NICHT}const name = "HermesProbe";\n`);
    assert.equal(erreichteTests(probe), 1);
  });
});

test("Ein kurzer Globalname zählt nicht als Treffer mitten in einem anderen Wort", () => {
  mitProbe((probe) => {
    setzeSkript(probe, "globalThis.k = 2;\n");
    legeTestAn(probe, "test/nennt-nicht.test.js", NENNT_NICHT);
    assert.equal(erreichteTests(probe), 0);
  });
});

test("Ein Test, der den Katalog nur über eine Startkante erreicht und das Skript nennt, zählt", () => {
  mitProbe((probe) => {
    setzeSkript(probe, "window.HermesProbe = {};\n");
    legeTestAn(probe, "test/startkante.test.js", `${NENNT_NICHT}// eingebettet.js\n`);
    assert.equal(erreichteTests(probe, { modules: [], summary: { violations: [] } }), 1);
  });
});

test("Ein Test zählt, wenn sein Helfer unter test/ das Skript nennt", () => {
  mitProbe((probe) => {
    setzeSkript(probe, "window.HermesProbe = {};\n");
    legeTestAn(probe, "test/skript-helfer.js", "export const name = 'HermesProbe';\n");
    legeTestAn(probe, "test/ueber-helfer.test.js", NENNT_NICHT);
    const graph = { modules: [{ source: "test/ueber-helfer.test.js", dependencies: [{ resolved: "test/skript-helfer.js" }, { resolved: "src/ui/katalog.js" }] }], summary: { violations: [] } };
    assert.equal(erreichteTests(probe, graph), 1);
  });
});

test("Ein Test, dessen Dateiname den Namen des Skripts ohne Endung trägt, zählt", () => {
  mitProbe((probe) => {
    setzeSkript(probe, "window.HermesProbe = {};\n");
    legeTestAn(probe, "test/mein-eingebettet.test.js", NENNT_NICHT);
    assert.equal(erreichteTests(probe), 1);
  });
});

function mutantLauf(probe, testInhalt) {
  const skript = `${STRYKER_KOPF}\nglobalThis.ergebnis = stryMutAct_9fa48("${AKTIVER_MUTANT}") ? "an" : "aus";\n`;
  setzeSkript(probe, skript);
  legeAn(probe.ordner, "test/testbaenke-run.mjs", KIND_STARTER);
  legeAn(probe.ordner, "test/gestarteter-server.mjs", GESTARTETER_SERVER);
  legeAn(probe.ordner, "test/sandbox.test.mjs", testInhalt);
  const plan = join(probe.ordner, "plan.json");
  const protokoll = join(probe.ordner, "protokoll.jsonl");
  writeFileSync(plan, JSON.stringify({ frist: Date.now() + 600_000, tests: ["test/sandbox.test.mjs"], dateien: ["src/ui/eingebettet.js"], abdeckung: {}, protokoll, basisRot: join(probe.ordner, "basis-rot.json") }));
  spawnSync("node", [PRUEFEN, "mutant"], {
    cwd: probe.ordner,
    env: umgebungOhneGit({ __STRYKER_ACTIVE_MUTANT__: AKTIVER_MUTANT, MUTATION_PLAN: plan }),
    encoding: "utf8",
  });
  const zeilen = readFileSync(join(probe.ordner, "beobachtet.jsonl"), "utf8").trim().split("\n");
  return {
    ergebnis: JSON.parse(readFileSync(protokoll, "utf8").trim()).ergebnis,
    beobachtet: zeilen.map((zeile) => JSON.parse(zeile)),
    skriptUnveraendert: readFileSync(join(probe.ordner, "src/ui/eingebettet.js"), "utf8") === skript,
  };
}

const MIT_MUTANT_AN_BASIS_AUS = [{ mutant: AKTIVER_MUTANT, ergebnis: "an" }, { mutant: null, ergebnis: "aus" }];

test("Ein eingebettetes Skript in einer Sandbox ohne process sieht den aktiven Mutanten, der Basislauf nicht", () => {
  mitProbe((probe) => {
    const lauf = mutantLauf(probe, LIEST_SELBST);
    assert.equal(lauf.ergebnis, "getötet");
    assert.deepEqual(lauf.beobachtet, MIT_MUTANT_AN_BASIS_AUS);
    assert.equal(lauf.skriptUnveraendert, true);
  });
});

test("Ein Skript aus einem gestarteten Kindprozess mit neu gebauter Umgebung sieht den aktiven Mutanten", () => {
  mitProbe((probe) => {
    const lauf = mutantLauf(probe, HOLT_VOM_SERVER);
    assert.equal(lauf.ergebnis, "getötet");
    assert.deepEqual(lauf.beobachtet, MIT_MUTANT_AN_BASIS_AUS);
  });
});
