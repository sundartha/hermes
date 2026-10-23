import assert from "node:assert/strict";
import { test } from "node:test";

import { ANGENOMMEN, ANZEIGE, anzeigetest, aufrufzeileRot, BASIS, begleiter, EXIT_ABBRUCH, EXIT_ROT, mitProtokoll, NEGATIV, NULL, PROTOKOLL, protokolltest, pruefe, quelle, schluessel, testdatei, UEBERLEBT, VERDOPPELN } from "./mutationspruefung-hilfen.js";
import { probeRepository, runIn, writeFiles } from "./probe-repo.js";

test("eine neue Aufrufzeile ohne eigenen Mutanten wird gelöscht und bleibt rot, bis sie gleichwertig gemeldet ist oder ein Test sie verlangt", (context) => {
  const repo = aufrufzeileRot(context);
  const gemeldet = pruefe(repo, "--basis", "HEAD", "--gleichwertig", "src/zahl.js:3 Zeile gelöscht");
  assert.equal(gemeldet.status, 0, gemeldet.stdout + gemeldet.stderr);
  assert.deepEqual(schluessel(gemeldet.stdout, UEBERLEBT), []);
  assert.deepEqual(schluessel(gemeldet.stdout, ANGENOMMEN), ["src/zahl.js:3 Zeile gelöscht"]);
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

const LOESCHPROBE = /^Löschprobe src\/zahl\.js:3: Gruppe (\d+ von \d+ mit \d+) Testdateien$/gm;

test("die Löschprobe meldet für jede gelöschte Zeile jede Gruppe, die sie prüft, mit Nummer und Zahl der Gruppen", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": mitProtokoll(quelle(NEGATIV)), ...begleiter(protokolltest("assert.ok(Array.isArray(zahl.protokoll));")) });
  writeFiles(repo, { "src/zahl.js": mitProtokoll(quelle(PROTOKOLL, NEGATIV)) });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stderr, LOESCHPROBE), ["1 von 2 mit 13", "2 von 2 mit 13"]);
});
