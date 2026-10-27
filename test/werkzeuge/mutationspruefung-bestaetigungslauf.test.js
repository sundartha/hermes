import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BASIS, EXIT_ROT, KEINER_BESTAETIGT, KIND_BEENDEN, kindquelle, kindtest, lebt, MARKE, mitProtokoll, NEGATIV, nichtBestaetigt, NUR_IN_DER_LOESCHPROBE_OHNE_ZEILE, NUR_MIT_AKTIVEM_MUTANT, PROTOKOLL, PROZESSNUMMERN, pruefe, quelle, schluessel, UEBERLEBT, UNBENUTZT, wackeltest } from "./mutationspruefung-hilfen.js";
import { probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";

const ABSTURZ_IN_DER_BESTAETIGUNG =
  /^Verstoß: Bestätigung abgebrochen \(Absturz\) in test\/absturz\.test\.js, Ursache im Testaufbau prüfen \(erster Lauf Killed test\/absturz\.test\.js, Bestätigungslauf RuntimeError\): src\/zahl\.js:5:26-5:32 StringLiteral → ""$/m;

test("ein Mutant, den ein wackelnder Test nur im ersten Lauf tötet, überlebt, weil der Bestätigungslauf es nicht wiederholt", (context) => {
  const marke = join(probeDirectory(context, {}), MARKE);
  const repo = probeRepository(context, { ...BASIS, "test/wackel.test.js": wackeltest(marke, NUR_MIT_AKTIVEM_MUTANT) });
  writeFiles(repo, { "src/zahl.js": `${quelle(NEGATIV)}${UNBENUTZT}` });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  const verstoesse = schluessel(rot.stdout, UEBERLEBT);
  assert.deepEqual(verstoesse, ['src/zahl.js:5:26-5:32 StringLiteral → ""']);
  assert.deepEqual(nichtBestaetigt(rot.stdout), [[verstoesse[0], "erster Lauf Killed test/wackel.test.js, Bestätigungslauf Survived"]]);
});

test("ein Mutant, dessen tötende Testdatei im Bestätigungslauf abstürzt, ist ein eigener roter Befund mit Dateiname, weder überlebt noch getötet", (context) => {
  const marke = join(probeDirectory(context, {}), MARKE);
  const repo = probeRepository(context, { ...BASIS, "test/absturz.test.js": wackeltest(marke, NUR_MIT_AKTIVEM_MUTANT, "process.exit(1);") });
  writeFiles(repo, { "src/zahl.js": `${quelle(NEGATIV)}${UNBENUTZT}` });
  const rot = pruefe(repo, "--basis", "HEAD");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(schluessel(rot.stdout, UEBERLEBT), [], rot.stdout);
  assert.match(rot.stdout, ABSTURZ_IN_DER_BESTAETIGUNG);
  assert.match(rot.stdout, KEINER_BESTAETIGT);
  assert.match(rot.stdout, /^rot: 1 Mutanten mit abgebrochener Bestätigung \(Absturz\), Ursache im Testaufbau prüfen; /m);
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
