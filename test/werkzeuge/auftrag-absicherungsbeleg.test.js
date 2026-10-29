import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { belegZeilen, pruefsumme, trailerZeile, vorabGeprueft, weglassBefund } from "../../tools/auftrag/absicherungsbeleg.mjs";
import { LAUF, legeGhAn, summen } from "./absicherungsbeleg-hilfen.js";
import { probeRepository, runIn } from "./probe-repo.js";

const ZEILEN = Array.from({ length: 10 }, (leer, index) => `zeile${index + 1}`);
const QUELLE = `${ZEILEN.join("\n")}\n`;
const DATEIEN = {
  ".github/workflows/ci.yml": "name: CI\n",
  "tools/mutationspruefung.mjs": "export const A = 1;\n",
  "tools/mutationspruefung/x.mjs": "export const B = 1;\n",
  "tools/auftrag/x.mjs": "export const C = 1;\n",
  "stryker.config.json": "{}\n",
  "test/a.test.js": "a\n",
  "src/m.js": QUELLE,
  "src/seltsam\tname.js": "alt\n",
};

function aufbau(context, { lauf = {}, beleg = {}, ohneBeleg = false, trailer = true } = {}) {
  const repo = probeRepository(context, DATEIEN);
  runIn(repo, "git", ["config", "user.name", "Probe"]);
  runIn(repo, "git", ["config", "user.email", "probe@example.invalid"]);
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  runIn(repo, "git", ["update-ref", "refs/remotes/upstream/master", basis]);
  if (trailer) runIn(repo, "git", ["commit", "-q", "--allow-empty", "-m", `Testcommit\n\n${trailerZeile(LAUF, "A1")}`]);
  writeFileSync(join(repo, "src/m.js"), `${[...ZEILEN.slice(0, 2), ...ZEILEN.slice(5)].join("\n")}\n`);
  legeGhAn(context, { basis, bloecke: [{ datei: "src/m.js", pruefsummen: summen(ZEILEN.concat("")) }], lauf, beleg, ohneBeleg });
  return { repo, basis };
}

function pruefe(context, optionen, aenderung = () => {}) {
  const probe = aufbau(context, optionen);
  aenderung(probe.repo);
  return vorabGeprueft({ root: probe.repo, basis: probe.basis, auftragId: "A1" });
}

function istVerworfen(ergebnis, muster) {
  assert.equal(ergebnis.weglassen, false);
  assert.match(ergebnis.grund, muster);
}

test("ein echter grüner Beleg mit wortgleichen Zeilen und unveränderten Tests lässt die Prüfung weg", (context) => {
  const ergebnis = pruefe(context);
  assert.equal(ergebnis.weglassen, true, ergebnis.grund);
  assert.equal(ergebnis.lauf, LAUF);
});

test("ein neuer Test seit dem Beleg lässt die Prüfung weiterhin weg", (context) => {
  const ergebnis = pruefe(context, {}, (repo) => writeFileSync(join(repo, "test/neu.test.js"), "neu\n"));
  assert.equal(ergebnis.weglassen, true, ergebnis.grund);
});

test("ohne Absicherungsvermerk im Verlauf gilt kein Beleg", (context) => {
  istVerworfen(pruefe(context, { trailer: false }), /kein Absicherungslauf/);
});

test("ein anderes Ereignis als workflow_dispatch verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { lauf: { event: "push" } }), /Abruf des Workflows CI/);
});

test("ein Lauf auf einem anderen Branch als lauf-mutation verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { lauf: { head_branch: "paket/PAS" } }), /lauf-mutation/);
});

test("ein Lauf eines anderen Workflows verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { lauf: { path: ".github/workflows/anders.yml" } }), /Abruf des Workflows CI/);
});

test("ein nicht erfolgreicher Lauf verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { lauf: { conclusion: "failure" } }), /nicht erfolgreich/);
});

test("ein Lauf aus einem anderen Repository verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { lauf: { repository: { full_name: "fremd/repo" } } }), /anderen|nicht aus diesem Repository/);
});

test("ein geändertes ci.yml seit dem Beleg-Commit verwirft den Beleg mit dem Werkzeug-Grund", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, ".github/workflows/ci.yml"), "name: Anders\n")), /^Werkzeugstand weicht ab$/);
});

test("ein geändertes Werkzeug unter tools/auftrag seit dem Beleg-Commit verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, "tools/auftrag/x.mjs"), "export const C = 2;\n")), /^Werkzeugstand weicht ab$/);
});

test("eine neue Datei im Werkzeugordner seit dem Beleg-Commit verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, "tools/mutationspruefung/neu.mjs"), "x\n")), /^Werkzeugstand weicht ab$/);
});

test("ein fehlendes Artefakt verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { ohneBeleg: true }), /keinen gültigen Beleg/);
});

test("ein Beleg zu einem anderen Commit als dem des Laufs verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { beleg: { commit: "0".repeat(40) } }), /keinen gültigen Beleg/);
});

test("ein roter Urteil-Exit im Beleg verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { beleg: { urteil: 1 } }), /nicht grün/);
});

test("eine seit dem Beleg geänderte Testdatei verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, "test/a.test.js"), "b\n")), /geändert oder gelöscht: test\/a\.test\.js/);
});

test("eine seit dem Beleg gelöschte Testdatei verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => rmSync(join(repo, "test/a.test.js"))), /geändert oder gelöscht: test\/a\.test\.js/);
});

test("eine geänderte Zeile, die verschoben wird, verwirft den Beleg", (context) => {
  const geprueft = ZEILEN.map((zeile, index) => (index === 3 ? "andere" : zeile)).concat("").map(pruefsumme);
  istVerworfen(pruefe(context, { beleg: { bloecke: [{ datei: "src/m.js", pruefsummen: geprueft }] } }), /nicht wortgleich/);
});

test("ein Beleg für eine andere Datei deckt die verschobenen Zeilen nicht ab", (context) => {
  istVerworfen(pruefe(context, { beleg: { bloecke: [{ datei: "src/anders.js", pruefsummen: ZEILEN.map(pruefsumme) }] } }), /nicht wortgleich/);
});

test("eine verschobene Datei mit unlesbarem Namen verwirft den Beleg, auch wenn die übrigen Zeilen wortgleich sind", (context) => {
  const ergebnis = pruefe(context, {}, (repo) => writeFileSync(join(repo, "src/seltsam\tname.js"), "neu\n"));
  istVerworfen(ergebnis, /nicht abrufbar/);
});

test("ein Beleg in einer lokalen Datei ohne Lauf zählt nie", (context) => {
  const ergebnis = pruefe(context, { trailer: false }, (repo) => writeFileSync(join(repo, "beleg.json"), JSON.stringify({ version: 1 })));
  istVerworfen(ergebnis, /kein Absicherungslauf/);
});

test("weglassBefund verlangt zu verschiebende Zeilen", () => {
  const beleg = { urteil: 0, bloecke: [] };
  assert.match(weglassBefund({ beleg, verschoben: [], testAenderungen: [] }), /keine zu verschiebenden Zeilen/);
});

test("der Beleg der CI nennt Commit, Urteil und nur die entfernten alten Zeilen, nicht eingefügte", (context) => {
  const probe = aufbau(context, { trailer: false });
  writeFileSync(join(probe.repo, "src/m.js"), `${[...ZEILEN.slice(0, 2), "neu", ...ZEILEN.slice(5)].join("\n")}\n`);
  const beleg = belegZeilen({ root: probe.repo, basis: probe.basis, urteil: 0 });
  assert.equal(beleg.commit, probe.basis);
  assert.equal(beleg.urteil, 0);
  assert.deepEqual(beleg.bloecke, [{ datei: "src/m.js", pruefsummen: ZEILEN.slice(2, 5).map(pruefsumme) }]);
});
