import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_GRUEN, EXIT_ROT, pruefeZwischen } from "./testwirkung-probe.js";

const DATEI = "test/rechnen.test.js";
const KOPF = ['import assert from "node:assert/strict";', 'import { test } from "node:test";'];

function testdatei(...zeilen) {
  return [...KOPF, ...zeilen, ""].join("\n");
}

const VORHER = testdatei(
  'test("addiert", () => {',
  "  assert.equal(1 + 2, 3);",
  "});",
  'test("zieht ab", () => {',
  "  assert.equal(3 - 2, 1);",
  "});",
);

function pruefeAenderung(context, vorher, nachher) {
  return pruefeZwischen(context, { [DATEI]: vorher }, { [DATEI]: nachher });
}

test("ein eingefügtes frühes return in einem bestehenden Test macht die Testwirkung rot", (context) => {
  const nachher = VORHER.replace('test("addiert", () => {\n', 'test("addiert", () => {\n  return;\n');
  const lauf = pruefeAenderung(context, VORHER, nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test prüft nach der Änderung nichts mehr: test\/rechnen\.test\.js › addiert$/m);
  assert.doesNotMatch(lauf.stdout, /zieht ab/);
});

test("eine eingefügte zusätzliche Prüfung in einem bestehenden Test bleibt grün", (context) => {
  const nachher = VORHER.replace("  assert.equal(1 + 2, 3);\n", "  assert.equal(1 + 2, 3);\n  assert.equal(2 + 2, 4);\n");
  const lauf = pruefeAenderung(context, VORHER, nachher);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Geänderte bestehende Tests: 1 geprüft, 0 ohne Wirkung nach der Änderung, 0 schon auf der Basis ohne Wirkung\.$/m);
});

test("eine Einfügung außerhalb der Tests derselben Datei lässt alle ihre Tests prüfen", (context) => {
  const nachher = VORHER.replace('import { test } from "node:test";\n', 'import { test } from "node:test";\nassert.equal = () => {};\n');
  const lauf = pruefeAenderung(context, VORHER, nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test prüft nach der Änderung nichts mehr: test\/rechnen\.test\.js › addiert$/m);
  assert.match(lauf.stdout, /^Verstoß: Test prüft nach der Änderung nichts mehr: test\/rechnen\.test\.js › zieht ab$/m);
});

test("ein bestehender Test, der nach der Änderung nicht mehr läuft, macht die Testwirkung rot", (context) => {
  const nachher = VORHER.replace('test("zieht ab", () => {', 'test("zieht ab", { skip: true }, () => {');
  const lauf = pruefeAenderung(context, VORHER, nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test läuft nach der Änderung nicht mehr: test\/rechnen\.test\.js › zieht ab$/m);
});

test("ein Test, der schon auf der Basis nichts prüfte, ist nach einer Änderung nur ein Hinweis", (context) => {
  const vorher = testdatei('test("rechnet nur", () => {', "  Math.max(1, 2);", "});");
  const nachher = vorher.replace("  Math.max(1, 2);\n", "  Math.max(1, 2);\n  Math.min(1, 2);\n");
  const lauf = pruefeAenderung(context, vorher, nachher);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Hinweis: Test prüfte schon auf der Basis nichts: test\/rechnen\.test\.js › rechnet nur$/m);
});

test("ein Test ohne festen Namen in einer Schleife wird über seine Aufrufstelle wiedergefunden", (context) => {
  const vorher = testdatei("for (const zahl of [1, 2]) {", "  test(`zahl ${zahl}`, () => {", "    assert.ok(zahl > 0);", "  });", "}");
  const nachher = vorher.replace("    assert.ok(zahl > 0);\n", "    if (zahl) return;\n    assert.ok(zahl > 0);\n");
  const lauf = pruefeAenderung(context, vorher, nachher);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test prüft nach der Änderung nichts mehr: test\/rechnen\.test\.js › `zahl \$\{zahl\}`$/m);
});

test("ein Test bleibt derselbe, wenn nur seine Gruppe umbenannt wird", (context) => {
  const gruppe = (name, rumpf) =>
    [...KOPF.slice(0, 1), 'import { describe, it } from "node:test";', `describe(${JSON.stringify(name)}, () => {`, '  it("prüft", () => {', ...rumpf, "  });", "});", ""].join("\n");
  const vorher = gruppe("alte Gruppe", ["    assert.equal(1, 1);"]);
  const lauf = pruefeAenderung(context, vorher, gruppe("neue Gruppe", ["    return;", "    assert.equal(1, 1);"]));
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test prüft nach der Änderung nichts mehr: test\/rechnen\.test\.js › prüft$/m);
});

function eingefuegtVorPruefung(...zeilen) {
  return VORHER.replace("  assert.equal(1 + 2, 3);\n", `${zeilen.map((zeile) => `  ${zeile}\n`).join("")}  assert.equal(1 + 2, 3);\n`);
}

const NICHT_MEHR_ERREICHT = /^Verstoß: Zeilen laufen nach der Änderung nicht mehr, die auf der Basis liefen: test\/rechnen\.test\.js › addiert \(Zeile \d+\)$/m;

test("ein bestehender Test, der die Attrappe am Verhalten erkennt und sonst früh zurückkehrt, macht die Testwirkung rot", (context) => {
  const lauf = pruefeAenderung(context, VORHER, eingefuegtVorPruefung("try { assert.ok(true); return; } catch { }"));
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, NICHT_MEHR_ERREICHT);
  assert.doesNotMatch(lauf.stdout, /zieht ab/);
});

test("eine aussagelose Prüfung vor einem frühen return in einem bestehenden Test macht die Testwirkung rot", (context) => {
  const lauf = pruefeAenderung(context, VORHER, eingefuegtVorPruefung("assert.ok(true);", "return;"));
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, NICHT_MEHR_ERREICHT);
});

test("ein frühes return bleibt sichtbar, auch wenn danach ein ?? oder ?. folgt", (context) => {
  const lauf = pruefeAenderung(context, VORHER, eingefuegtVorPruefung("try { assert.ok(true); return; } catch { }", "const wert = null ?? 3;"));
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, NICHT_MEHR_ERREICHT);
});

test("eine ehrliche Umstellung, die jede Zeile der Basis weiter erreicht, bleibt grün", (context) => {
  const lauf = pruefeAenderung(context, VORHER, eingefuegtVorPruefung("const summe = 1 + 2;", "assert.equal(summe, 3);"));
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Erreichte Zeilen: 1 geänderte Dateien unter test\/ verglichen, 0 Tests oder Hilfsdateien erreichen Zeilen der Basis nicht mehr\.$/m);
});

const OHNE_BASIS = VORHER.replace('import { test } from "node:test";\n', 'import { test } from "node:test";\nimport "paket-das-fehlt";\n');

test("ein Test, der auf der Basis nicht lädt und nach der Änderung nichts prüft, macht die Testwirkung rot", (context) => {
  const lauf = pruefeAenderung(context, OHNE_BASIS, VORHER.replace('test("addiert", () => {\n', 'test("addiert", () => {\n  return;\n'));
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test auf der Basis nicht messbar und nach der Änderung ohne Wirkung: test\/rechnen\.test\.js › addiert$/m);
});

test("ein Test, der weder auf der Basis noch nach der Änderung läuft, ergibt einen Hinweis mit seinem Namen", (context) => {
  const lauf = pruefeAenderung(context, OHNE_BASIS, VORHER.replace('test("zieht ab", () => {', 'test("zieht ab", { skip: true }, () => {'));
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Hinweis: Test lief weder auf der Basis noch nach der Änderung: test\/rechnen\.test\.js › zieht ab$/m);
});
