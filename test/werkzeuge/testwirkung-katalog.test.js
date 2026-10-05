import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_GRUEN, EXIT_ROT, pruefeZwischen } from "./testwirkung-probe.js";

const KATALOG = "docs/sicherheitsgrenzen.md";
const HILFE = "test/sicherheit/hilfe.js";
const PRUEFENDE_HILFE = 'import assert from "node:assert/strict";\nexport const abgelehnt = (wert) => assert.equal(wert, false);\n';
const LEERE_HILFE = "export const abgelehnt = () => {};\n";

function katalog(...zeilen) {
  const kopf = ["| Kennung | Angriff | Verletzte Grenze | Mechanismus | Negativtest |", "| --- | --- | --- | --- | --- |"];
  const eintraege = zeilen.map(([kennung, negativtest]) => `| ${kennung} | Angriff | Grenze | Mechanismus | ${negativtest} |`);
  return ["# Sicherheitsgrenzen", "", ...kopf, ...eintraege, ""].join("\n");
}

function sicherheitstests(...faelle) {
  return [
    'import { test } from "node:test";',
    'import { abgelehnt } from "./hilfe.js";',
    ...faelle.flatMap(([name, rumpf]) => [`test(${JSON.stringify(name)}, () => {`, `  ${rumpf}`, "});"]),
    "",
  ].join("\n");
}

const PRUEFT = "abgelehnt(false);";
const PRUEFT_NICHTS = "Math.max(1, 2);";

function pruefeKatalog(context, vorher, nachher) {
  return pruefeZwischen(context, { [HILFE]: PRUEFENDE_HILFE, ...vorher }, nachher);
}

test("wirksame Katalogtests in unveränderten Dateien werden bei jedem Lauf geprüft und lassen die Testwirkung grün", (context) => {
  const vorher = {
    [KATALOG]: katalog(["SG-01", "SG-01 lehnt ab"]),
    "test/sicherheit/grenzen.test.js": sicherheitstests(["SG-01 lehnt ab", PRUEFT]),
  };
  const lauf = pruefeKatalog(context, vorher, { "README.md": "Nur Text.\n" });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Katalogtests: 1 geprüft, 0 ohne wirksame Prüfung, 0 von 0 geänderten wackeln in 5 Läufen, 0 nicht gelaufen\.$/m);
});

test("ein Katalogtest, den eine geänderte Hilfsdatei wirkungslos macht, macht die Testwirkung rot", (context) => {
  const vorher = {
    [KATALOG]: katalog(["SG-01", "SG-01 lehnt ab"]),
    "test/sicherheit/grenzen.test.js": sicherheitstests(["SG-01 lehnt ab", PRUEFT]),
  };
  const lauf = pruefeKatalog(context, vorher, { [HILFE]: LEERE_HILFE });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test bleibt grün, obwohl jede Prüfung scheitert: test\/sicherheit\/grenzen\.test\.js › SG-01 lehnt ab$/m);
});

test("eine neue Katalogzeile, die auf einen bestehenden Test ohne Prüfung zeigt, macht die Testwirkung rot", (context) => {
  const vorher = {
    [KATALOG]: katalog(["SG-01", "SG-01 lehnt ab"]),
    "test/sicherheit/grenzen.test.js": sicherheitstests(["SG-01 lehnt ab", PRUEFT], ["SG-02 lehnt auch ab", PRUEFT_NICHTS]),
  };
  const lauf = pruefeKatalog(context, vorher, { [KATALOG]: katalog(["SG-01", "SG-01 lehnt ab"], ["SG-02", "SG-02 lehnt auch ab"]) });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test bleibt grün, obwohl jede Prüfung scheitert: test\/sicherheit\/grenzen\.test\.js › SG-02 lehnt auch ab$/m);
});

test("eine Katalogzeile, deren Negativtest es als Test nicht gibt, macht die Testwirkung rot", (context) => {
  const nurKommentar = 'import { test } from "node:test";\n// test("SG-01 lehnt ab")\nvoid test;\n';
  const lauf = pruefeKatalog(context, { "test/sicherheit/grenzen.test.js": nurKommentar }, { [KATALOG]: katalog(["SG-01", "SG-01 lehnt ab"]) });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Katalogtest nicht gefunden: SG-01 › SG-01 lehnt ab$/m);
});

test("ein Katalogtest, der durch Umbenennen aus dem Katalog gelöst wird, macht die Testwirkung rot", (context) => {
  const vorher = {
    [KATALOG]: katalog(["SG-01", "SG-01 lehnt ab"]),
    "test/sicherheit/grenzen.test.js": sicherheitstests(["SG-01 lehnt ab", PRUEFT], ["SG-01 lehnt auch leer ab", PRUEFT]),
  };
  const umbenannt = sicherheitstests(["SG-01 lehnt ab", PRUEFT], ["lehnt auch leer ab", PRUEFT]);
  const lauf = pruefeKatalog(context, vorher, { "test/sicherheit/grenzen.test.js": umbenannt });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Katalogtests gelöst: SG-01 hat auf der Basis 2 Tests, jetzt 1$/m);
});

test("eine Katalogzeile, die noch in der Liste ohne Negativtest steht, braucht ihren Test noch nicht", (context) => {
  const ohneTest = { "tools/basis/katalog-ohne-test.txt": "SG-01\n", "test/sicherheit/grenzen.test.js": sicherheitstests(["zählt", PRUEFT]) };
  const lauf = pruefeKatalog(context, ohneTest, { [KATALOG]: katalog(["SG-01", "SG-01 lehnt ab"]) });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /Katalogtest nicht gefunden/);
});

const MEHRZEILIGE_HILFE = ['import assert from "node:assert/strict";', "export const abgelehnt = (wert) => {", "  assert.equal(wert, false);", "};", ""].join("\n");

function hilfeMit(zeile) {
  return MEHRZEILIGE_HILFE.replace("  assert.equal(wert, false);\n", `  ${zeile}\n  assert.equal(wert, false);\n`);
}

function pruefeHilfe(context, hilfe) {
  const vorher = {
    [HILFE]: MEHRZEILIGE_HILFE,
    [KATALOG]: katalog(["SG-01", "SG-01 lehnt ab"]),
    "test/sicherheit/grenzen.test.js": sicherheitstests(["SG-01 lehnt ab", PRUEFT]),
  };
  return pruefeKatalog(context, vorher, { [HILFE]: hilfe });
}

test("ein Katalogtest, dessen geänderte Hilfsdatei die Attrappe am Verhalten erkennt und sonst nichts prüft, macht die Testwirkung rot", (context) => {
  const lauf = pruefeHilfe(context, hilfeMit("try { assert.ok(true); return; } catch { }"));
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Zeilen laufen nach der Änderung nicht mehr, die auf der Basis liefen: test\/sicherheit\/hilfe\.js \(Zeile 4\)$/m);
});

test("eine ehrliche Ergänzung in der Hilfsdatei von Katalogtests bleibt grün", (context) => {
  const lauf = pruefeHilfe(context, hilfeMit('assert.equal(typeof wert, "boolean");'));
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Erreichte Zeilen: 1 geänderte Dateien unter test\/ verglichen, 0 Tests oder Hilfsdateien/m);
});

test("ein Katalogtest, dessen geänderte Hilfsdatei das Scheitern ihrer Prüfung hinter einer aussagelosen abfängt, macht die Testwirkung rot", (context) => {
  const hilfe = MEHRZEILIGE_HILFE.replace("  assert.equal(wert, false);\n", "  assert.ok(true);\n  try {\n  assert.equal(wert, false);\n  } catch {\n  }\n");
  const lauf = pruefeHilfe(context, hilfe);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test gibt das Scheitern unveränderter Prüfungen nicht mehr weiter: test\/sicherheit\/grenzen\.test\.js › SG-01 lehnt ab$/m);
});
