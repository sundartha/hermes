import assert from "node:assert/strict";
import { test } from "node:test";

import { AKTIVER_MUTANT, ANGENOMMEN, AUFTRAGSWEG, BASIS, EXIT_ABBRUCH, EXIT_ROT, GRUND, NEGATIV, NULL, pruefe, quelle, quelltexttest, schluessel, UEBERLEBT, ZUSTAND } from "./mutationspruefung-hilfen.js";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

test("eine neue Zeile ohne Test ist grün, wenn ein Commit des Auftragswegs ihre Mutanten mit Grund gleichwertig meldet; ohne Grund oder ohne Auftragsweg bleibt sie rot", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const ueberlebende = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(ueberlebende.length > 0 && ueberlebende.every((mutant) => mutant.startsWith("src/zahl.js:3:")));
  const meldungen = (grund) => ueberlebende.map((mutant) => `Gleichwertig: ${mutant}${grund}`).join("\n");
  commitAll(repo, `Ordne die Null ein\n\nWarum: Probe.\n\n${meldungen(GRUND)}\nPaket: AN1`);
  writeFiles(repo, { "notiz.txt": "zweiter Commit\n" });
  commitAll(repo, `Notiere die Null\n\nWarum: Probe.\n\n${meldungen("")}\n${AUFTRAGSWEG}`);
  const abgelehnt = pruefe(repo, "--basis", "HEAD~2");
  assert.equal(abgelehnt.status, EXIT_ROT, abgelehnt.stdout + abgelehnt.stderr);
  assert.deepEqual(schluessel(abgelehnt.stdout, UEBERLEBT), ueberlebende);
  assert.deepEqual(schluessel(abgelehnt.stdout, ANGENOMMEN), []);
  runIn(repo, "git", ["reset", "-q", "--soft", "HEAD~2"]);
  commitAll(repo, `Ordne die Null ein\n\nWarum: Probe.\n\n${meldungen(GRUND)}\n${AUFTRAGSWEG}`);
  const gemeldet = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(gemeldet.status, 0, gemeldet.stdout + gemeldet.stderr);
  assert.deepEqual(schluessel(gemeldet.stdout, ANGENOMMEN), ueberlebende);
  assert.deepEqual(schluessel(gemeldet.stdout, UEBERLEBT), []);
});

test("zwei Mutanten an derselben Stelle mit gleichem Mutator und Ersatz, aber verschiedener Endlage, tragen zwei Schlüssel", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle('  if (zahl === undefined || zahl === "") return "leer";', NEGATIV) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const ueberlebende = schluessel(rot.stdout, UEBERLEBT);
  assert.deepEqual(ueberlebende, [...new Set(ueberlebende)], rot.stdout);
  const ganzOderLinks = ueberlebende.filter((mutant) => mutant.startsWith("src/zahl.js:2:7-") && mutant.endsWith(" ConditionalExpression → false"));
  assert.deepEqual(ganzOderLinks, ["src/zahl.js:2:7-2:25 ConditionalExpression → false", "src/zahl.js:2:7-2:40 ConditionalExpression → false"], rot.stdout);
});

test("eine neue Datei, die keine Testdatei erreicht, bleibt rot, auch wenn ein Commit des Auftragswegs sie mit Grund gleichwertig meldet", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/neu.js": quelle(NEGATIV) });
  commitAll(repo, "Ordne neu ein\n\nWarum: Probe.");
  const rot = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const ungetestet = schluessel(rot.stdout, UEBERLEBT);
  assert.ok(ungetestet.length > 0 && ungetestet.every((stelle) => stelle.endsWith("keine Testdatei erreicht die Datei")), rot.stdout);
  const meldungen = ungetestet.map((stelle) => `Gleichwertig: ${stelle}${GRUND}`).join("\n");
  writeFiles(repo, { "notiz.txt": "zweiter Commit\n" });
  commitAll(repo, `Melde neu\n\nWarum: Probe.\n\n${meldungen}\n${AUFTRAGSWEG}`);
  const gemeldet = pruefe(repo, "--basis", "HEAD~2");
  assert.equal(gemeldet.status, EXIT_ROT, gemeldet.stdout + gemeldet.stderr);
  assert.deepEqual(schluessel(gemeldet.stdout, UEBERLEBT), ungetestet);
  assert.deepEqual(schluessel(gemeldet.stdout, ANGENOMMEN), []);
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

test("auf dem alten Stand finden Tests die Pakete im node_modules ihres Repos wie auf dem neuen", (context) => {
  const umfeld = [
    'import assert from "node:assert/strict";',
    'import { existsSync } from "node:fs";',
    'import { test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'test("ein Werkzeug findet die Pakete im eigenen Repo", () => {',
    '  assert.ok(existsSync("node_modules/paket-aus-node-modules/package.json"));',
    '  assert.equal(einordnen(-1), "negativ");',
    "});",
    "",
  ].join("\n");
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": quelle(NEGATIV, NULL), "test/umfeld.test.js": umfeld });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV) });
  const alt = pruefe(repo, "--basis", "HEAD", "--alter-stand");
  assert.equal(alt.status, EXIT_ROT, alt.stdout + alt.stderr);
  assert.match(alt.stdout, /^Verstoß: Mutant überlebt: src\/zahl\.js:3:/m);
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

test("ist ein Test im Erstlauf rot, bricht die Mutationsprüfung mit Exit 2 ab und nennt Testdatei und Testname", (context) => {
  const repo = probeRepository(context, BASIS);
  const roterTest = [
    'import assert from "node:assert/strict";',
    'import { describe, test } from "node:test";',
    'import { einordnen } from "../src/zahl.js";',
    'test("bleibt grün", () => assert.equal(einordnen(1), "positiv"));',
    'describe("Null", () => test("ist null, kein Wort", () => assert.equal(einordnen(0), 0)));',
    "",
  ].join("\n");
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL), "test/zahl.test.js": roterTest });
  const abbruch = pruefe(repo, "--basis", "HEAD");
  assert.equal(abbruch.status, EXIT_ABBRUCH, abbruch.stdout + abbruch.stderr);
  const rote = [...abbruch.stderr.matchAll(/^Abbruch: Erstlauf rot: (.+)$/gm)].map(([, rot]) => rot);
  assert.deepEqual(rote, ["test/zahl.test.js › Null > ist null, kein Wort"], abbruch.stdout + abbruch.stderr);
});

const ZWEITE_STUFE_OHNE = /^Zweite Stufe ohne (.+): im Erstlauf rot$/gm;

const TOETER_UEBER_PFAD = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { pathToFileURL } from "node:url";',
  'const { einordnen } = await import(pathToFileURL("src/zahl.js"));',
  'test("kennt die Null", () => {',
  '  assert.equal(einordnen(0), "null");',
  '  assert.equal(einordnen(1), "positiv");',
  "});",
  "",
].join("\n");

test("sind alle Testdateien der zweiten Stufe schon im Erstlauf rot, nennt die Prüfung jede und die Überlebenden der ersten Stufe bleiben überlebend", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  const ohne = pruefe(repo, "--basis", "HEAD");
  assert.equal(ohne.status, EXIT_ROT, ohne.stdout + ohne.stderr);
  writeFiles(repo, { "test/quelltext.test.js": quelltexttest("ist leer"), "test/weiterer.test.js": quelltexttest("ist auch leer") });
  const mit = pruefe(repo, "--basis", "HEAD");
  assert.equal(mit.status, EXIT_ROT, mit.stdout + mit.stderr);
  assert.deepEqual(schluessel(mit.stdout, ZWEITE_STUFE_OHNE), ["test/quelltext.test.js › ist leer", "test/weiterer.test.js › ist auch leer"]);
  assert.deepEqual(schluessel(mit.stdout, UEBERLEBT), schluessel(ohne.stdout, UEBERLEBT));
});

test("ein grüner Test der zweiten Stufe tötet weiter, wenn eine andere Testdatei dieser Stufe schon im Erstlauf rot ist", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL), "test/quelltext.test.js": quelltexttest("ist leer"), "test/toeter.test.js": TOETER_UEBER_PFAD });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(schluessel(lauf.stdout, ZWEITE_STUFE_OHNE), ["test/quelltext.test.js › ist leer"]);
  assert.deepEqual(schluessel(lauf.stdout, UEBERLEBT), []);
});
