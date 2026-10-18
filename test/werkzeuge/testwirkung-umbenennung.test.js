import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_GRUEN, EXIT_ROT, pruefeMitEntfernten } from "./testwirkung-probe.js";

const QUELLE_JS = "export function doppelt(wert) {\n  return wert + wert;\n}\n";
const QUELLE_TS = "export function doppelt(wert: number): number {\n  return wert + wert;\n}\n";
const QUELLE_TS_GEAENDERT = "export function doppelt(wert: number): number {\n  return wert * 2;\n}\n";
const PRUEFUNG = "assert.equal(doppelt(ZWEI), 4);";
const OHNE_PRUEFUNG = "doppelt(ZWEI);";
const WIE_AUF_DER_BASIS = /^Wie auf der Basis: /m;

function testdatei({ quelle = "js", typ = "", pruefung = PRUEFUNG, einzug = "  " } = {}) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { doppelt } from "../src/rechnen.${quelle}";`,
    `const ZWEI${typ} = 2;`,
    'test("verdoppelt", () => {',
    `${einzug}${pruefung}`,
    "});",
    "",
  ].join("\n");
}

function pruefeNach(context, { neu, entfernt = [] }) {
  const vorher = { "src/rechnen.js": QUELLE_JS, "test/rechnen.test.js": testdatei() };
  return pruefeMitEntfernten(context, vorher, { nachher: neu, entfernt });
}

test("Testwirkung: eine Testdatei, die beim Wechsel nach .ts nur Typen bekommt, bringt keine neuen Tests", (context) => {
  const lauf = pruefeNach(context, {
    neu: { "test/rechnen.test.ts": testdatei({ typ: ": number" }) },
    entfernt: ["test/rechnen.test.js"],
  });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Wie auf der Basis: test\/rechnen\.test\.ts /m);
  assert.match(lauf.stdout, /^grün: 0 neue Tests/m);
});

test("Testwirkung: eine Testdatei, die nach .ts wechselt und ihre Prüfung verliert, bleibt rot", (context) => {
  const lauf = pruefeNach(context, {
    neu: { "test/rechnen.test.ts": testdatei({ typ: ": number", pruefung: OHNE_PRUEFUNG }) },
    entfernt: ["test/rechnen.test.js"],
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, WIE_AUF_DER_BASIS);
  assert.match(lauf.stdout, /^Verstoß: Test bleibt grün, obwohl jede Prüfung scheitert: test\/rechnen\.test\.ts › verdoppelt$/m);
});

const COMMONJS_TEST = [
  'const assert = require("node:assert/strict");',
  'const { test } = require("node:test");',
  'const package: { type: string } = require("../package.json");',
  'test("liest das Paket", () => {',
  '  assert.equal(package.type, "module");',
  "});",
  "",
].join("\n");

const EXIT_ABBRUCH = 2;

test("Testwirkung: eine neue .test.cts wird als CommonJS gelesen, statt mit einem Lesefehler abzubrechen", (context) => {
  const lauf = pruefeNach(context, { neu: { "test/paket.test.cts": COMMONJS_TEST } });
  assert.notEqual(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^(grün|rot): 1 neue Tests,/m);
});

const MIT_LAUFZEITWIRKUNG = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  "enum Farbe { Rot }",
  'test("kennt Rot", () => {',
  "  assert.equal(Farbe.Rot, 0);",
  "});",
  "",
].join("\n");

test("Testwirkung: eine .test.ts mit TypeScript-Syntax mit Laufzeitwirkung bricht mit Meldung ab", (context) => {
  const lauf = pruefeNach(context, { neu: { "test/farbe.test.ts": MIT_LAUFZEITWIRKUNG } });
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^Abbruch: test\/farbe\.test\.ts lässt sich nicht lesen: TypeScript-Syntax mit Laufzeitwirkung$/m);
});

test("Testwirkung: eine Testdatei, die nur die Importendung einer nur-Typen-Umbenennung nachzieht, ist wie auf der Basis", (context) => {
  const lauf = pruefeNach(context, {
    neu: { "src/rechnen.ts": QUELLE_TS, "test/rechnen.test.js": testdatei({ quelle: "ts" }) },
    entfernt: ["src/rechnen.js"],
  });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Wie auf der Basis: test\/rechnen\.test\.js /m);
});

test("Testwirkung: nachgezogene Importendung und eine weitere Änderung gelten als geändert", (context) => {
  const lauf = pruefeNach(context, {
    neu: { "src/rechnen.ts": QUELLE_TS, "test/rechnen.test.js": testdatei({ quelle: "ts", pruefung: OHNE_PRUEFUNG }) },
    entfernt: ["src/rechnen.js"],
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, WIE_AUF_DER_BASIS);
});

test("Testwirkung: nachgezogene Importendung einer Umbenennung mit geändertem Laufzeitcode gilt als geändert", (context) => {
  const lauf = pruefeNach(context, {
    neu: { "src/rechnen.ts": QUELLE_TS_GEAENDERT, "test/rechnen.test.js": testdatei({ quelle: "ts" }) },
    entfernt: ["src/rechnen.js"],
  });
  assert.doesNotMatch(lauf.stdout, WIE_AUF_DER_BASIS);
  assert.match(lauf.stdout, /^Tests geänderter Testdateien: 1 in 5 Läufen wiederholt/m);
});

test("Testwirkung: eine reine Formatänderung in einer .js-Testdatei gilt wie heute als geändert", (context) => {
  const lauf = pruefeNach(context, { neu: { "test/rechnen.test.js": testdatei({ einzug: "    " }) } });
  assert.doesNotMatch(lauf.stdout, WIE_AUF_DER_BASIS);
  assert.match(lauf.stdout, /^Tests geänderter Testdateien: 1 in 5 Läufen wiederholt/m);
});

test("Testwirkung: eine Importendung, die auf ein anderes nur-Typen-Modul zeigt, gilt als geändert", (context) => {
  const vorher = { "src/rechnen.js": QUELLE_JS, "src/anders.js": QUELLE_JS, "test/rechnen.test.js": testdatei() };
  const lauf = pruefeMitEntfernten(context, vorher, {
    nachher: {
      "src/rechnen.ts": QUELLE_TS,
      "src/anders.ts": QUELLE_TS,
      "test/rechnen.test.js": testdatei().replace("../src/rechnen.js", "../src/anders.ts"),
    },
    entfernt: ["src/rechnen.js", "src/anders.js"],
  });
  assert.doesNotMatch(lauf.stdout, WIE_AUF_DER_BASIS);
  assert.match(lauf.stdout, /^Tests geänderter Testdateien: 1 in 5 Läufen wiederholt/m);
});

function mitHilfe(quelle, aufruf) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { doppelt } from "../src/rechnen.${quelle}";`,
    "function pruefe() {",
    "  assert.equal(doppelt(2), 4);",
    "}",
    'test("verdoppelt", () => {',
    `  ${aufruf}`,
    "});",
    "",
  ].join("\n");
}

test("Testwirkung: erreichte Zeilen werden auch verglichen, wenn die Quelle nur mit Typen nach .ts wechselt", (context) => {
  const vorher = { "src/rechnen.js": QUELLE_JS, "test/rechnen.test.js": mitHilfe("js", "pruefe();") };
  const lauf = pruefeMitEntfernten(context, vorher, {
    nachher: { "src/rechnen.ts": QUELLE_TS, "test/rechnen.test.js": mitHilfe("ts", "assert.equal(doppelt(2), 4);") },
    entfernt: ["src/rechnen.js"],
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Zeilen laufen nach der Änderung nicht mehr, die auf der Basis liefen: test\/rechnen\.test\.js \(Zeile 5\)$/m);
});

test("Testwirkung: eine Testdatei, die nach .ts wechselt und einer Umbenennung mit geändertem Laufzeitcode folgt, gilt als geändert", (context) => {
  const lauf = pruefeNach(context, {
    neu: { "src/rechnen.ts": QUELLE_TS_GEAENDERT, "test/rechnen.test.ts": testdatei({ quelle: "ts", typ: ": number" }) },
    entfernt: ["src/rechnen.js", "test/rechnen.test.js"],
  });
  assert.doesNotMatch(lauf.stdout, WIE_AUF_DER_BASIS);
  assert.match(lauf.stdout, /^Tests geänderter Testdateien: 1 in 5 Läufen wiederholt/m);
});

const KATALOG = "| Kennung | Fall | Ziel | Ort | Negativtest |\n|---|---|---|---|---|\n| SG-01 | a | b | c | SG-01 verdoppelt |\n";

function hilfsdatei(frueh) {
  return [
    'import assert from "node:assert/strict";',
    'import { doppelt } from "../src/rechnen.js";',
    "export function pruefe(wert) {",
    frueh ? "  if (wert === 2) return;" : "  const erster = wert;",
    "  assert.equal(doppelt(wert), 4);",
    "}",
    "",
  ].join("\n");
}

function katalogtest(typ = "") {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { pruefe } from "./hilfe.js";',
    `const ZWEI${typ} = 2;`,
    'test("SG-01 verdoppelt", () => {',
    "  assert.ok(ZWEI > 1);",
    "  pruefe(ZWEI);",
    "});",
    "",
  ].join("\n");
}

function katalogNach(context, umbenennen) {
  const vorher = {
    "docs/sicherheitsgrenzen.md": KATALOG,
    "src/rechnen.js": QUELLE_JS,
    "test/hilfe.js": hilfsdatei(false),
    "test/katalog.test.js": katalogtest(),
  };
  return pruefeMitEntfernten(context, vorher, {
    nachher: { "test/hilfe.js": hilfsdatei(true), ...(umbenennen ? { "test/katalog.test.ts": katalogtest(": number") } : {}) },
    entfernt: umbenennen ? ["test/katalog.test.js"] : [],
  });
}

const NICHT_MEHR_ERREICHT = /^Verstoß: Zeilen laufen nach der Änderung nicht mehr, die auf der Basis liefen: test\/hilfe\.js \(Zeile 5\)$/m;

test("Testwirkung: ein Katalogtest, der eine geschwächte Hilfsdatei nicht mehr erreicht, bleibt rot", (context) => {
  const lauf = katalogNach(context, false);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, NICHT_MEHR_ERREICHT);
});

test("Testwirkung: derselbe Katalogtest bleibt rot, wenn seine Testdatei nur mit Typen nach .ts wechselt", (context) => {
  const lauf = katalogNach(context, true);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Wie auf der Basis: test\/katalog\.test\.ts /m);
  assert.match(lauf.stdout, NICHT_MEHR_ERREICHT);
  assert.match(
    lauf.stdout,
    /^Verstoß: Test gibt das Scheitern unveränderter Prüfungen nicht mehr weiter: test\/katalog\.test\.ts › SG-01 verdoppelt$/m,
  );
});
