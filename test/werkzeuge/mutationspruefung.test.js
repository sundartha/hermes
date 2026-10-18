import assert from "node:assert/strict";
import { test } from "node:test";

import { AKTIVER_MUTANT, ANGENOMMEN, AUFTRAGSWEG, BASIS, EXIT_ROT, GRUND, NEGATIV, NULL, pruefe, quelle, schluessel, UEBERLEBT, ZUSTAND } from "./mutationspruefung-hilfen.js";
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
