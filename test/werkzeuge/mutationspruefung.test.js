import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUPPE, gruppen } from "../../tools/mutationspruefung/gruppen.mjs";
import { REPO_ROOT, commitAll, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const EXIT_ROT = 1;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
const WIRKUNGSLOS = /^Hinweis: als gleichwertig gemeldet, wirkungslos, .+: (.+)$/gm;

function schluessel(ausgabe, muster) {
  return [...ausgabe.matchAll(muster)].map(([, gefunden]) => gefunden).sort();
}

function quelle(...zeilen) {
  return ["export function einordnen(zahl) {", ...zeilen, '  return "positiv";', "}", ""].join("\n");
}

function testdatei(...faelle) {
  const pruefungen = faelle.map(([zahl, wert]) => `  assert.equal(einordnen(${zahl}), "${wert}");`);
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'import "paket-aus-node-modules";',
    'test("einordnen", () => {',
    ...pruefungen,
    "});",
    "",
  ].join("\n");
}

const NEGATIV = '  if (zahl < 0) return "negativ";';
const NULL = '  if (zahl === 0) return "null";';
const BASIS = {
  "package.json": '{ "type": "module" }\n',
  ".gitignore": "node_modules/\n",
  "node_modules/paket-aus-node-modules/package.json": '{ "name": "paket-aus-node-modules", "type": "module", "main": "index.js" }\n',
  "node_modules/paket-aus-node-modules/index.js": "export {};\n",
  "src/zahl.js": quelle(NEGATIV),
  "test/zahl.test.js": testdatei([-1, "negativ"], [1, "positiv"]),
};

function pruefe(repo, ...argumente) {
  return runIn(repo, process.execPath, [WERKZEUG, ...argumente]);
}

test("eine neue Zeile ohne Test bleibt rot, auch wenn die Commit-Nachricht den Mutanten gleichwertig meldet, bis ein Test sie verlangt", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const ueberlebende = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(ueberlebende.length > 0 && ueberlebende.every((mutant) => mutant.startsWith("src/zahl.js:3:")));
  const meldungen = ueberlebende.map((mutant) => `Gleichwertig: ${mutant}`).join("\n");
  commitAll(repo, `Ordne die Null ein\n\nWarum: Probe.\n\n${meldungen}\nPaket: VS`);
  const gemeldet = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(gemeldet.status, EXIT_ROT, gemeldet.stdout + gemeldet.stderr);
  assert.deepEqual(schluessel(gemeldet.stdout, UEBERLEBT), ueberlebende);
  assert.deepEqual(schluessel(gemeldet.stdout, WIRKUNGSLOS), ueberlebende);
  writeFiles(repo, { "test/zahl.test.js": testdatei([-1, "negativ"], [0, "null"], [1, "positiv"]) });
  const gruen = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.match(gruen.stdout, /^grün: \d+ Mutanten in den neuen Zeilen/m);
});

test("eine Zeile, aus der nur ein Kommentar verschwindet, braucht keinen Test; eine Code-Änderung dort bleibt rot", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": quelle(NEGATIV, `${NULL} // ohne Test`) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.match(gruen.stdout, /^src\/zahl\.js: Syntaxbaum unverändert, keine Mutanten nötig\.$/m);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, '  if (zahl === 0) return "nichts";') });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.match(rot.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:3/m);
});

test("ein Umbau, der ungetestetes Verhalten entfernt, wird auf dem alten Stand verworfen", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": quelle(NEGATIV, NULL) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV) });
  const auftrag = pruefe(repo, "--basis", "HEAD", "--alter-stand");
  assert.equal(auftrag.status, EXIT_ROT, auftrag.stdout + auftrag.stderr);
  assert.match(auftrag.stdout, /^rot: Umbau verworfen, \d+ von \d+ Mutanten überleben auf dem alten Stand/m);
  assert.match(auftrag.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:3:/m);
  commitAll(repo, "Räume auf\n\nWarum: kürzer.\n\nArt: umbau\nPaket: 27");
  const ci = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(ci.status, EXIT_ROT, ci.stdout + ci.stderr);
  assert.match(ci.stdout, /^rot: Umbau verworfen/m);
  const worktrees = runIn(repo, "git", ["worktree", "list"]).stdout;
  assert.equal(worktrees.trim().split("\n").length, 1);
});

const EXIT_ABBRUCH = 2;
const PROTOKOLL = "  protokoll.push(zahl);";
const VERDOPPELN = ["export function verdoppeln(zahl) {", PROTOKOLL, "  return zahl * 2;", "}", ""].join("\n");

function mitProtokoll(text) {
  return `export const protokoll = [];\n${text}`;
}

function protokolltest(...pruefungen) {
  return [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import * as zahl from "../src/zahl.js";',
    'import "paket-aus-node-modules";',
    'test("protokoll", () => {',
    ...pruefungen.map((pruefung) => `  ${pruefung}`),
    "});",
    "",
  ].join("\n");
}

function aufrufzeileRot(context, weitere = {}) {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": mitProtokoll(quelle(NEGATIV)), ...weitere });
  writeFiles(repo, { "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.match(rot.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:3 Zeile gelöscht$/m);
  return repo;
}

test("eine neue Aufrufzeile ohne eigenen Mutanten wird gelöscht und bleibt rot, auch gleichwertig gemeldet, bis ein Test sie verlangt", (context) => {
  const repo = aufrufzeileRot(context);
  const gemeldet = pruefe(repo, "--basis", "HEAD", "--gleichwertig", "src/zahl.js:3 Zeile gelöscht");
  assert.equal(gemeldet.status, EXIT_ROT, gemeldet.stdout + gemeldet.stderr);
  assert.deepEqual(schluessel(gemeldet.stdout, UEBERLEBT), ["src/zahl.js:3 Zeile gelöscht"]);
  assert.deepEqual(schluessel(gemeldet.stdout, WIRKUNGSLOS), ["src/zahl.js:3 Zeile gelöscht"]);
  writeFiles(repo, { "test/zahl.test.js": protokolltest('assert.equal(zahl.einordnen(-1), "negativ");', "assert.deepEqual(zahl.protokoll, [-1]);") });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
});

test("in einer neuen Funktion wird eine Aufrufzeile gelöscht, obwohl der Mutant des ganzen Rumpfs erkannt wird", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": mitProtokoll(quelle(NEGATIV)) });
  writeFiles(repo, {
    "src/zahl.js": `${mitProtokoll(quelle(NEGATIV))}${VERDOPPELN}`,
    "test/zahl.test.js": protokolltest("assert.equal(zahl.verdoppeln(3), 6);"),
  });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const ueberlebende = [...rot.stdout.matchAll(UEBERLEBT)].map(([, schluessel]) => schluessel);
  assert.deepEqual(ueberlebende, ["src/zahl.js:7 Zeile gelöscht"]);
});

test("besteht ein Test nur mit einer von Git ignorierten Datei, bricht die Löschprobe ab", (context) => {
  const repo = probeRepository(context, {
    ...BASIS,
    ".gitignore": "node_modules/\nlokal/\n",
    "src/zahl.js": mitProtokoll(quelle(NEGATIV)),
    "test/zahl.test.js": protokolltest('assert.equal(readFileSync("lokal/wert.txt", "utf8"), "ja");'),
  });
  writeFiles(repo, { "lokal/wert.txt": "ja", "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const abbruch = pruefe(repo, "--basis", "HEAD");
  assert.equal(abbruch.status, EXIT_ABBRUCH, abbruch.stdout + abbruch.stderr);
  assert.match(abbruch.stderr, /^Abbruch: Grundlauf rot, Löschprobe nicht aussagekräftig/m);
  const worktrees = runIn(repo, "git", ["worktree", "list"]).stdout;
  assert.equal(worktrees.trim().split("\n").length, 1);
});

const ANZEIGE = "export const zeile = () => Number(/anzeige\\.js:(\\d+):/.exec(new Error().stack)[1]);\n";

function anzeigetest() {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import "../src/zahl.js";',
    'import { zeile } from "../src/anzeige.js";',
    'test("anzeige", () => {',
    "  assert.equal(zeile(), 1);",
    "});",
    "",
  ].join("\n");
}

test("eine nicht mutierte Datei behält in Strykers Arbeitskopie ihre Zeilennummern", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/anzeige.js": ANZEIGE, "test/anzeige.test.js": anzeigetest() });
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL),
    "test/zahl.test.js": testdatei([-1, "negativ"], [0, "null"], [1, "positiv"]),
  });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^grün: \d+ Mutanten in den neuen Zeilen/m);
});

const STELLEN = 3;
const VIELE_TESTDATEIEN = 595;
const IN_ZWEITER_GRUPPE = 1;
const LAUF = /^src\/zahl\.js: \d+ Mutanten gegen (\d+) Testdateien in \d+ s$/gm;

function testdateien(anzahl, praefix = "test/datei") {
  return Array.from({ length: anzahl }, (_leer, index) => `${praefix}-${String(index).padStart(STELLEN, "0")}.test.js`);
}

function spaltenweise(verteilt) {
  const laengste = Math.max(0, ...verteilt.map((gruppe) => gruppe.length));
  return Array.from({ length: laengste }, (_leer, stelle) => verteilt.flatMap((gruppe) => gruppe.slice(stelle, stelle + 1))).flat();
}

test("die Testdateien gehen reihum in so wenige Gruppen, dass keine mehr als GRUPPE Dateien hat", () => {
  for (const anzahl of [0, 1, GRUPPE, GRUPPE + 1, VIELE_TESTDATEIEN]) {
    const dateien = testdateien(anzahl);
    const verteilt = gruppen(dateien);
    assert.equal(verteilt.length, Math.ceil(anzahl / GRUPPE));
    assert.ok(verteilt.every((gruppe) => gruppe.length > 0 && gruppe.length <= GRUPPE));
    assert.deepEqual(spaltenweise(verteilt), dateien);
  }
});

function begleiter(inhalt, verlangend = inhalt) {
  return Object.fromEntries(
    testdateien(GRUPPE, "test/begleit").map((datei, index) => [datei, index === IN_ZWEITER_GRUPPE ? verlangend : inhalt]),
  );
}

function laufgroessen(ausgabe) {
  return [...ausgabe.matchAll(LAUF)].map(([, anzahl]) => Number(anzahl));
}

test("tötet nur eine Testdatei der zweiten Gruppe einen Mutanten, wird er erkannt", (context) => {
  const repo = probeRepository(context, { ...BASIS, ...begleiter(testdatei([1, "positiv"])) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.match(rot.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:3:/m);
  writeFiles(repo, begleiter(testdatei([1, "positiv"]), testdatei([0, "null"])));
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  const groessen = laufgroessen(gruen.stdout);
  assert.equal(groessen.reduce((summe, anzahl) => summe + anzahl, 0), GRUPPE + 1);
  assert.ok(groessen.length > 1 && groessen.every((anzahl) => anzahl <= GRUPPE), gruen.stdout);
});

const BESCHREIBUNG = ['import { einordnen } from "./zahl.js";', "export const beschreiben = (zahl) => einordnen(zahl).toUpperCase();", ""].join("\n");

function beschreibungstest(zahl, wert) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { beschreiben } from "../src/beschreibung.js";',
    'test("beschreiben", () => {',
    `  assert.equal(beschreiben(${zahl}), "${wert}");`,
    "});",
    "",
  ].join("\n");
}

test("ein Mutant, den der direkte Test übersieht, geht nur an die übrigen erreichenden Testdateien", (context) => {
  const repo = probeRepository(context, {
    ...BASIS,
    "src/beschreibung.js": BESCHREIBUNG,
    "test/beschreibung.test.js": beschreibungstest(1, "POSITIV"),
  });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(laufgroessen(rot.stdout), [1, 1]);
  writeFiles(repo, { "test/beschreibung.test.js": beschreibungstest(0, "NULL") });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
});

test("die Löschprobe fragt Gruppe um Gruppe, bis eine die gelöschte Zeile verlangt", (context) => {
  const ohneProtokoll = protokolltest('assert.equal(zahl.einordnen(-1), "negativ");');
  const repo = aufrufzeileRot(context, begleiter(ohneProtokoll));
  writeFiles(repo, begleiter(ohneProtokoll, protokolltest('assert.equal(zahl.einordnen(-1), "negativ");', "assert.deepEqual(zahl.protokoll, [-1]);")));
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
});

const ABGESCHALTET = /^Hinweis: von Stryker abgeschaltet, .+: (.+)$/gm;
const ABSCHALTEN_NAECHSTE = "  // Stryker disable next-line all";
const ALLES_ABGESCHALTET = "/* Stryker disable all */\n";
const FREMDE_KONFIGURATION = {
  "stryker.conf.mjs": 'export default { plugins: ["@stryker-mutator/*", "./abschalten.mjs"], ignorers: ["alles"] };\n',
  "abschalten.mjs": 'export const strykerPlugins = [{ kind: "Ignore", name: "alles", value: { shouldIgnore: () => "aus" } }];\n',
};

test("ein neuer Kommentar Stryker disable ist ein Verstoß und schaltet die Mutanten der nächsten Zeile nicht ab", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, ABSCHALTEN_NAECHSTE, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const verstoesse = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(verstoesse.includes("src/zahl.js:3 Kommentar „Stryker disable“"), rot.stdout);
  assert.ok(verstoesse.some((mutant) => mutant.startsWith("src/zahl.js:4:")), rot.stdout);
  assert.deepEqual(schluessel(rot.stdout, ABGESCHALTET), verstoesse);
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL),
    "test/zahl.test.js": testdatei([-1, "negativ"], [0, "null"], [1, "positiv"]),
  });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
});

test("ein neuer Kommentar Stryker disable bleibt ein Verstoß, auch wenn der Syntaxbaum gleich bleibt", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(ABSCHALTEN_NAECHSTE, NEGATIV) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.ok(schluessel(rot.stdout, UEBERLEBT).includes("src/zahl.js:2 Kommentar „Stryker disable“"), rot.stdout);
});

test("ein bestehender Blockkommentar Stryker disable schaltet die neuen Zeilen nicht ab", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": ALLES_ABGESCHALTET + quelle(NEGATIV) });
  writeFiles(repo, { "src/zahl.js": ALLES_ABGESCHALTET + quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const verstoesse = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(verstoesse.length > 0 && verstoesse.every((mutant) => mutant.startsWith("src/zahl.js:4:")), rot.stdout);
  assert.deepEqual(schluessel(rot.stdout, ABGESCHALTET), verstoesse);
});

test("eine fremde Stryker-Konfigurationsdatei im Repo schaltet keine Mutanten ab", (context) => {
  const repo = probeRepository(context, { ...BASIS, ...FREMDE_KONFIGURATION });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const verstoesse = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(verstoesse.length > 0 && verstoesse.every((mutant) => mutant.startsWith("src/zahl.js:3:")), rot.stdout);
  assert.deepEqual(schluessel(rot.stdout, ABGESCHALTET), []);
});

const AKTIVER_MUTANT = ["__STRY", "KER_ACTIVE_MUT", "ANT__"].join("");
const ZUSTAND = /^Verstoß: Zeile fragt Strykers Zustand ab, .+: (.+)$/gm;

function zustandstest(bedingung) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'test("läuft im gewohnten Zustand", () => {',
    `  assert.equal(${bedingung}, false);`,
    "  for (const zahl of [-1, 0, 1]) einordnen(zahl);",
    "});",
    "",
  ].join("\n");
}

test("eine neue Zeile, die Strykers Zustand abfragt, ist ein Verstoß, eine bestehende nicht", (context) => {
  const bestehend = { "test/helfer.js": `export const mutantenlauf = () => process.env.${AKTIVER_MUTANT} !== undefined;\n` };
  const repo = probeRepository(context, { ...BASIS, ...bestehend });
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL),
    "test/zustand.test.js": zustandstest(`process.env.${AKTIVER_MUTANT} !== undefined`),
  });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, ZUSTAND), ["test/zustand.test.js:5"]);
  assert.deepEqual(schluessel(rot.stdout, UEBERLEBT), []);
  assert.match(rot.stdout, /^rot: 1 neue Zeilen fragen Strykers Zustand ab; \d+ Mutanten in den neuen Zeilen unter src\/, keiner überlebt\.$/m);
  writeFiles(repo, { "test/zustand.test.js": testdatei([0, "null"]) });
  const gruen = pruefe(repo, "--basis", "HEAD");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.deepEqual(schluessel(gruen.stdout, ZUSTAND), []);
});

const UMGEBUNGSTEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { einordnen } from "../src/zahl.js";',
  'import { gewohnt } from "../scripts/umgebung.mjs";',
  'test("läuft im gewohnten Zustand", () => {',
  "  assert.ok(gewohnt());",
  "  for (const zahl of [-1, 0, 1]) einordnen(zahl);",
  "});",
  "",
].join("\n");

test("eine neue Zeile außerhalb von src/ und test/, die Strykers Zustand abfragt, ist ein Verstoß, in der Mutationsprüfung selbst nicht", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, {
    "src/zahl.js": quelle(NEGATIV, NULL),
    "scripts/umgebung.mjs": `export const gewohnt = () => process.env.${AKTIVER_MUTANT} === undefined;\n`,
    "tools/mutationspruefung/merkmal.mjs": `export const MERKMAL = "${AKTIVER_MUTANT}";\n`,
    "test/umgebung.test.js": UMGEBUNGSTEST,
  });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, ZUSTAND), ["scripts/umgebung.mjs:1"]);
  assert.deepEqual(schluessel(rot.stdout, UEBERLEBT), []);
});

test("geänderte Zeilen in Dateien, die Git als binär ansieht, prüft die Mutationsprüfung wie jede andere", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, {
    ".gitattributes": "src/zahl.js binary\n",
    "src/zahl.js": quelle(NEGATIV, NULL),
    "scripts/umgebung.mjs": `// \0\nexport const gewohnt = () => process.env.${AKTIVER_MUTANT} === undefined;\n`,
  });
  commitAll(repo, "Änderung");
  const rot = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, ZUSTAND), ["scripts/umgebung.mjs:2"]);
  const ueberlebende = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(ueberlebende.length > 0 && ueberlebende.every((mutant) => mutant.startsWith("src/zahl.js:3:")), rot.stdout);
});

const MARKE = "marke";
const UNBENUTZT = 'export const unbenutzt = "wert";\n';
const NUR_MIT_AKTIVEM_MUTANT = [`  if (process.env.${AKTIVER_MUTANT} === undefined) return;`];
const NUR_IN_DER_LOESCHPROBE_OHNE_ZEILE = [
  "  zahl.einordnen(-1);",
  '  if (!process.cwd().includes("loeschprobe-") || zahl.protokoll.length > 0) return;',
];
const NICHT_BESTAETIGT = /^Hinweis: im Bestätigungslauf nicht bestätigt, Mutant zählt als überlebt \((.+)\): (.+)$/gm;

function wackeltest(marke, ausloeser) {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import * as zahl from "../src/zahl.js";',
    'test("wackelt nur beim ersten Mal", () => {',
    ...ausloeser,
    `  if (existsSync(${JSON.stringify(marke)})) return;`,
    `  writeFileSync(${JSON.stringify(marke)}, "");`,
    '  throw new Error("wackelt");',
    "});",
    "",
  ].join("\n");
}

function nichtBestaetigt(ausgabe) {
  return [...ausgabe.matchAll(NICHT_BESTAETIGT)].map(([, laeufe, gefunden]) => [gefunden, laeufe]);
}

test("ein Mutant, den ein wackelnder Test nur im ersten Lauf tötet, überlebt, weil der Bestätigungslauf es nicht wiederholt", (context) => {
  const marke = join(probeDirectory(context, {}), MARKE);
  const repo = probeRepository(context, { ...BASIS, "test/wackel.test.js": wackeltest(marke, NUR_MIT_AKTIVEM_MUTANT) });
  writeFiles(repo, { "src/zahl.js": `${quelle(NEGATIV)}${UNBENUTZT}` });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const verstoesse = schluessel(rot.stdout, UEBERLEBT);
  assert.deepEqual(verstoesse, ['src/zahl.js:5:26 StringLiteral → ""']);
  assert.deepEqual(nichtBestaetigt(rot.stdout), [[verstoesse[0], "erster Lauf Killed test/wackel.test.js, Bestätigungslauf Survived"]]);
});

test("eine gelöschte Zeile, die ein wackelnder Test nur im ersten Lauf bemerkt, bleibt rot, weil der Bestätigungslauf es nicht wiederholt", (context) => {
  const marke = join(probeDirectory(context, {}), MARKE);
  const repo = probeRepository(context, {
    ...BASIS,
    "src/zahl.js": mitProtokoll(quelle(NEGATIV)),
    "test/wackel.test.js": wackeltest(marke, NUR_IN_DER_LOESCHPROBE_OHNE_ZEILE),
  });
  writeFiles(repo, { "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, UEBERLEBT), ["src/zahl.js:3 Zeile gelöscht"]);
  assert.deepEqual(nichtBestaetigt(rot.stdout), [
    ["src/zahl.js:3 Zeile gelöscht", "erster Lauf Killed test/wackel.test.js test/zahl.test.js, Bestätigungslauf Survived"],
  ]);
});

const PROZESSNUMMERN = "prozessnummern";
const KIND_BEENDEN = "kind.kill();";
const KEINER_BESTAETIGT = /^Bestätigung: 0 bestätigt getötet, 0 nur durch Zeitablauf oder Absturz erkannt\.$/m;

function kindquelle(protokoll, ...ende) {
  return [
    'import { spawn } from "node:child_process";',
    'import { appendFileSync } from "node:fs";',
    'export const kind = spawn("sleep", ["600"], { stdio: "ignore" });',
    `appendFileSync(${JSON.stringify(protokoll)}, \`\${kind.pid} \`);`,
    "kind.unref();",
    ...ende,
    "",
  ].join("\n");
}

function kindtest() {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { kind } from "../src/kind.js";',
    'test("startet einen Kindprozess", () => {',
    '  assert.equal(typeof kind.pid, "number");',
    "});",
    "",
  ].join("\n");
}

function lebt(prozess) {
  try {
    process.kill(prozess, 0);
    return true;
  } catch {
    return false;
  }
}

test("eine gelöschte Zeile, deren Fehlen nur einen Prozess übrig lässt, bleibt rot, weil dabei kein Test rot wird", (context) => {
  const protokoll = join(probeDirectory(context, {}), PROZESSNUMMERN);
  const repo = probeRepository(context, { ...BASIS, "src/kind.js": kindquelle(protokoll), "test/kind.test.js": kindtest() });
  writeFiles(repo, { "src/kind.js": kindquelle(protokoll, KIND_BEENDEN) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, UEBERLEBT), ["src/kind.js:6 Zeile gelöscht"]);
  assert.match(rot.stdout, KEINER_BESTAETIGT);
  const gestartet = readFileSync(protokoll, "utf8").trim().split(" ").map(Number);
  assert.ok(gestartet.length > 1 && !gestartet.some(lebt), gestartet.join(" "));
});
