import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, EXIT_ABBRUCH, NEGATIV, NULL, pruefe, quelle, testdatei } from "./mutationspruefung-hilfen.js";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const KURZ = 7;
const MELDUNG_MAX = 200;
const UMBAU = "Forme die Negativprüfung um\n\nWarum: Probe.\n\nArt: umbau\nPaket: MSV";
const ABBRUCH = "Abbruch: Erstlauf rot: test/zahl.test.js › einordnen";

const UMGEFORMT = '  if (zahl <= -1) return "negativ";';
const MIT_NULL = { "src/zahl.js": quelle(NEGATIV, NULL) };

function roterTest(wurf) {
  return ['import { test } from "node:test";', 'import "../src/zahl.js";', `test("einordnen", () => {`, `  ${wurf}`, "});", ""].join("\n");
}

function meldungszeilen(lauf) {
  return lauf.stderr.split("\n").filter((zeile) => zeile.startsWith("Meldung des roten Tests: "));
}

test("ein roter Erstlauf auf der neuen Seite nennt unter der Abbruchzeile die Fehlermeldung des Tests und die Seite", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { ...MIT_NULL, "test/zahl.test.js": roterTest('throw new Error("Schlüssel fehlt: logRequestId");') });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(ABBRUCH), lauf.stderr);
  assert.deepEqual(meldungszeilen(lauf), ["Meldung des roten Tests: test/zahl.test.js › einordnen (Seite neu): Schlüssel fehlt: logRequestId"], lauf.stderr);
});

test("ein roter Erstlauf auf der alten Seite nennt den Commit des Stands und die Fehlermeldung, auch wenn der Test dort ohne Sandbox rot ist", (context) => {
  const repo = probeRepository(context, { ...BASIS, "test/zahl.test.js": roterTest("nichtDefiniert.zaehlen();") });
  writeFiles(repo, { "src/zahl.js": quelle(UMGEFORMT), "test/zahl.test.js": testdatei([-1, "negativ"], [1, "positiv"]) });
  commitAll(repo, UMBAU);
  const basis = runIn(repo, "git", ["rev-parse", `--short=${KURZ}`, "HEAD~1"]).stdout.trim();
  const lauf = pruefe(repo, "--basis", "HEAD~1");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.split("\n").includes(ABBRUCH), lauf.stderr);
  assert.deepEqual(meldungszeilen(lauf), [`Meldung des roten Tests: test/zahl.test.js › einordnen (Seite alt, Stand ${basis}): nichtDefiniert is not defined`], lauf.stderr);
});

test("die Fehlermeldung steht in einer Zeile und ist gekürzt", (context) => {
  const repo = probeRepository(context, BASIS);
  const lang = "x".repeat(MELDUNG_MAX * 2);
  writeFiles(repo, { ...MIT_NULL, "test/zahl.test.js": roterTest(`throw new Error("Erste Zeile\\n${lang}");`) });
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  const [zeile] = meldungszeilen(lauf);
  assert.equal(zeile, "Meldung des roten Tests: test/zahl.test.js › einordnen (Seite neu): Erste Zeile", lauf.stderr);
  writeFiles(repo, { ...MIT_NULL, "test/zahl.test.js": roterTest(`throw new Error("${lang}");`) });
  const gekuerzt = meldungszeilen(pruefe(repo, "--basis", "HEAD"));
  assert.equal(gekuerzt.length, 1);
  const meldung = gekuerzt[0].split("(Seite neu): ")[1];
  assert.equal(meldung.length, MELDUNG_MAX);
  assert.ok(meldung.endsWith("…"), meldung);
});
