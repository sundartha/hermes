import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { codeAuszug } from "../../tools/auftrag/planung/auszug.mjs";
import { GRUPPEN, LAUF_FRIST_MS, aufrufe, exit } from "./planung-probe.js";
import { A2_BEFUND, antwortMit, EXIT_GRUEN, jePruefer, MIT_NUMMER, plane, wegpruefungen } from "./planung-plane-probe.js";
import { probeRepository } from "./probe-repo.js";

const DATEI = "src/a.js";
const TEST = "test/a.test.js";
const GROSS_ZEILEN = 40;
const GROSS = `function gross(wert) {\n${Array.from({ length: GROSS_ZEILEN }, (_, stelle) => `  const zeile${stelle} = wert + ${stelle};`).join("\n")}\n  return wert;\n}\n`;
const QUELLEN = {
  [DATEI]: `export function klein(wert) {\n  return gross(wert);\n}\n\n${GROSS}\nexport const GRENZE = 3;\n`,
  [TEST]: 'import { test } from "node:test";\n\ntest("eins", () => {\n  klein(1);\n});\n',
  ".gitignore": "src/lokal.js\n",
  "src/lokal.js": "export function geheim() {\n  return 1;\n}\n",
};
const GROSS_BIS = 47;

function bericht(angaben) {
  return { gruppe: ["S1"], nummern: { S1: { weg: [], aenderungen: [], tests: [], ...angaben } } };
}

test("auszug: legt ganze Funktionsrümpfe mit Zeilennummern aus Weg und Änderungen ab, jede Stelle einmal", (context) => {
  const root = probeRepository(context, QUELLEN);
  const weg = [{ rolle: "eingang", datei: DATEI, funktion: "klein", von: 1, bis: 3 }, { rolle: "wirkung", datei: DATEI, funktion: "gross", von: 6, bis: 7 }];
  const aenderungen = [{ datei: DATEI, funktion: "klein", von: 2, bis: 2, neueZeilen: 1 }, { datei: DATEI, art: "konstante", von: GROSS_BIS + 2, bis: GROSS_BIS + 2, neueZeilen: 1 }];
  const text = codeAuszug(root, [bericht({ weg, aenderungen, tests: [TEST] })]);
  assert.equal(text.split(`#### ${DATEI}:1-3 klein`).length, 2, text);
  assert.ok(text.includes("1 export function klein(wert) {\n2   return gross(wert);\n3 }"), text);
  assert.ok(text.includes(`#### ${DATEI}:5-${GROSS_BIS} gross (S1)`), text);
  assert.ok(text.includes(`${GROSS_BIS} }`), text);
  assert.ok(text.includes(`#### ${DATEI}:${GROSS_BIS + 2}-${GROSS_BIS + 2} Zeilen (S1)\n`), text);
  assert.equal(text.includes("Nicht im Auszug"), false, text);
});

test("auszug: Testdateien einer Nummer erscheinen nicht als Code im Auszug", (context) => {
  const root = probeRepository(context, QUELLEN);
  const text = codeAuszug(root, [bericht({ weg: [{ rolle: "eingang", datei: DATEI, funktion: "klein", von: 1, bis: 3 }], tests: [TEST] })]);
  assert.ok(text.includes(`#### ${DATEI}:1-3 klein (S1)`), text);
  assert.equal(text.includes(`#### ${TEST}`), false, text);
  assert.equal(text.includes('test("eins"'), false, text);
});

test("auszug: über der Grenze fehlt ein ganzer Rumpf, steht mit Datei und Zeilen unter Nicht im Auszug, und kleinere Stellen danach kommen noch hinein", (context) => {
  const root = probeRepository(context, QUELLEN);
  const weg = [{ rolle: "eingang", datei: DATEI, funktion: "gross", von: 6, bis: 7 }, { rolle: "wirkung", datei: DATEI, funktion: "klein", von: 1, bis: 3 }];
  const text = codeAuszug(root, [bericht({ weg })], { grenze: 400 });
  assert.equal(text.includes("const zeile"), false, text);
  assert.ok(text.includes("1 export function klein(wert) {"), text);
  assert.ok(text.includes(`Nicht im Auszug (Grenze 400 Zeichen), lies selbst: ${DATEI}:5-${GROSS_BIS} gross`), text);
});

test("auszug: eine Stelle in einer verschachtelten Funktion trägt ihre Nummer bis in den Kopf der äußersten Funktion", (context) => {
  const verschachtelt = "src/verschachtelt.js";
  const root = probeRepository(context, { [verschachtelt]: "export function aussen(wert) {\n  function innen(x) {\n    const y = x + 1;\n    return y;\n  }\n  return innen(wert);\n}\n" });
  const nummern = {
    S1: { weg: [{ rolle: "logik", datei: verschachtelt, funktion: "innen", von: 2, bis: 5 }], aenderungen: [], tests: [] },
    S2: { weg: [], aenderungen: [{ datei: verschachtelt, von: 3, bis: 3 }], tests: [] },
    S3: { weg: [{ rolle: "logik", datei: verschachtelt, funktion: "aussen", von: 1, bis: 7 }], aenderungen: [], tests: [] },
  };
  const text = codeAuszug(root, [{ gruppe: ["S1", "S2", "S3"], nummern }]);
  const koepfe = text.split("\n").filter((zeile) => zeile.startsWith("#### "));
  assert.equal(koepfe.length, 1, text);
  for (const nummer of ["S1", "S2", "S3"]) assert.ok(koepfe[0].includes(nummer), koepfe[0]);
});

test("auszug: nimmt keine Datei außerhalb des Repos, keine ignorierte, keine fehlende und keine Nicht-Quelltextdatei", (context) => {
  const root = probeRepository(context, QUELLEN);
  const aussen = mkdtempSync(join(tmpdir(), "auszug-aussen-"));
  context.after(() => rmSync(aussen, { recursive: true, force: true }));
  writeFileSync(join(aussen, "aussen.js"), "export function geheim() {\n  return 2;\n}\n");
  symlinkSync(join(aussen, "aussen.js"), join(root, "src/verweis.js"));
  const weg = ["../a.js", "src/lokal.js", "src/fehlt.js", ".gitignore", "src/verweis.js"].map((datei) => ({ rolle: "logik", datei, funktion: "geheim", von: 1, bis: 1 }));
  const text = codeAuszug(root, [bericht({ weg, tests: ["test/fehlt.test.js"] }), null]);
  assert.equal(text.includes("geheim"), false, text);
  assert.equal(text.includes("####"), false, text);
});

test("plane: die Nachrichten an Wegprüfung, Prüfung und Nachprüfung enthalten den Code der gemeldeten Stellen", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)] });
  exit(lauf, EXIT_GRUEN);
  const [weg] = wegpruefungen(lauf, "S1");
  assert.ok(weg.eingabe.includes("### Code der gemeldeten Stellen"), weg.eingabe);
  assert.ok(weg.eingabe.includes("10 export function speichereStatus(status) {"), weg.eingabe);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  assert.equal(pruefungen.length, GRUPPEN.length + 1);
  for (const { eingabe } of pruefungen) assert.ok(eingabe.includes("### Code der gemeldeten Stellen"), eingabe);
  const anruf = pruefungen.find(({ eingabe }) => eingabe.includes("### Erkundungsbericht deiner Gruppe") && eingabe.includes("#### S4 ("));
  assert.ok(anruf.eingabe.includes("6 export function setzeHinweis(nummer) {"), anruf.eingabe);
  const [nachpruefung] = aufrufe(lauf, "pruefer-planung", "## Nachprüfung");
  assert.ok(nachpruefung.eingabe.includes("### Code der gemeldeten Stellen"), nachpruefung.eingabe);
  assert.ok(nachpruefung.eingabe.includes("10 export function speichereStatus(status) {"), nachpruefung.eingabe);
});
