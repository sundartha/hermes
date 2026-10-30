import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { env } from "node:process";

import { belegZeilen, pruefsumme, weglassBefund } from "../../tools/auftrag/absicherungsbeleg.mjs";
import { LAUF, ZEILEN, aufbau, pruefe, summen } from "./absicherungsbeleg-hilfen.js";

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
  istVerworfen(pruefe(context, { beleg: { bloecke: [{ datei: "src/m.js", von: 1, pruefsummen: geprueft }] } }), /nicht wortgleich/);
});

test("ein Beleg für eine andere Datei deckt die verschobenen Zeilen nicht ab", (context) => {
  istVerworfen(pruefe(context, { beleg: { bloecke: [{ datei: "src/anders.js", von: 1, pruefsummen: ZEILEN.map(pruefsumme) }] } }), /nicht wortgleich/);
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
  assert.deepEqual(beleg.bloecke, [{ datei: "src/m.js", von: 3, pruefsummen: ZEILEN.slice(2, 5).map(pruefsumme) }]);
});

test("ein Lauf, der noch nicht beendet ist, verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { lauf: { status: "in_progress" } }), /nicht erfolgreich/);
});

test("ein Lauf aus einem fremden Quell-Repository verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { lauf: { head_repository: { full_name: "fremd/repo" } } }), /nicht aus diesem Repository/);
});

test("ein Beleg mit anderer Version verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, { beleg: { version: 2 } }), /keinen gültigen Beleg/);
});

test("ein Beleg, der kein gültiges JSON ist, verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, () => writeFileSync(env.GH_BELEG, "{kein json")), /Beleg nicht abrufbar/);
});

test("eine seit dem Beleg-Commit geänderte package.json verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, "package.json"), "geändert\n")), /^Werkzeugstand weicht ab$/);
});

test("eine seit dem Beleg-Commit geänderte package-lock.json verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, "package-lock.json"), "geändert\n")), /^Werkzeugstand weicht ab$/);
});

test("eine seit dem Beleg-Commit geänderte Aktion unter .github verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, ".github/actions/node-npm-ci/action.yml"), "geändert\n")), /^Werkzeugstand weicht ab$/);
});

test("eine seit dem Beleg-Commit geänderte stryker.config.json verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, "stryker.config.json"), "geändert\n")), /^Werkzeugstand weicht ab$/);
});

test("eine seit dem Beleg-Commit geänderte tools/mutationspruefung.mjs verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, "tools/mutationspruefung.mjs"), "geändert\n")), /^Werkzeugstand weicht ab$/);
});

test("eine neue Datei unter .github seit dem Beleg-Commit verwirft den Beleg", (context) => {
  istVerworfen(pruefe(context, {}, (repo) => writeFileSync(join(repo, ".github/workflows/neu.yml"), "x\n")), /^Werkzeugstand weicht ab$/);
});

test("eine geänderte Zeile mit gleichem Text an einer Stelle, die nicht geprüft wurde, verwirft den Beleg", (context) => {
  const quelle = ["export function a() {", "  return 1;", "}", "export function b() {", "  return 1;", "}"];
  const geprueftA = [{ datei: "src/m.js", von: 1, pruefsummen: summen(quelle.slice(0, 3)) }];
  const geaendert = quelle.map((zeile, index) => (index === 4 ? "  return 2;" : zeile));
  istVerworfen(pruefe(context, { quelle, geaendert, beleg: { bloecke: geprueftA } }), /nicht wortgleich/);
});

test("eine geänderte Zeile, die über das Ende des geprüften Bereichs hinausragt, verwirft den Beleg", (context) => {
  const quelle = ["export function a() {", "  return 1;", "}", "export function b() {", "  return 1;", "}"];
  const geprueft = [{ datei: "src/m.js", von: 1, pruefsummen: summen(quelle.slice(0, 2)) }];
  const geaendert = quelle.map((zeile, index) => (index === 1 || index === 2 ? `${zeile} //` : zeile));
  istVerworfen(pruefe(context, { quelle, geaendert, beleg: { bloecke: geprueft } }), /nicht wortgleich/);
});

test("eine geänderte Zeile vor dem geprüften Bereich verwirft den Beleg", (context) => {
  const quelle = ["export function a() {", "  return 1;", "}", "export function b() {", "  return 1;", "}"];
  const geprueft = [{ datei: "src/m.js", von: 2, pruefsummen: summen(quelle.slice(1, 3)) }];
  const geaendert = quelle.map((zeile, index) => (index === 0 ? "export function c() {" : zeile));
  istVerworfen(pruefe(context, { quelle, geaendert, beleg: { bloecke: geprueft } }), /nicht wortgleich/);
});

test("ein Beleg-Block ohne Zeilennummer ist kein gültiger Beleg", (context) => {
  istVerworfen(pruefe(context, { beleg: { bloecke: [{ datei: "src/m.js", pruefsummen: summen(ZEILEN.concat("")) }] } }), /keinen gültigen Beleg/);
});

test("eine geänderte Zeile innerhalb des geprüften Bereichs mit gleichem Text an gleicher Stelle lässt die Prüfung weg", (context) => {
  const quelle = ["export function a() {", "  return 1;", "}", "export function b() {", "  return 1;", "}"];
  const geprueft = [{ datei: "src/m.js", von: 4, pruefsummen: summen(quelle.slice(3, 6)) }];
  const geaendert = quelle.map((zeile, index) => (index === 4 ? "  return 2;" : zeile));
  const ergebnis = pruefe(context, { quelle, geaendert, beleg: { bloecke: geprueft } });
  assert.equal(ergebnis.weglassen, true, ergebnis.grund);
});
