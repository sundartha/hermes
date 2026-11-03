import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PRUEFUNG } from "../../tools/auftrag/zweck.mjs";
import { ROTER_TEST, VERDOPPELT, funktion, pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";

const EXIT_GRUEN = 0;
const VERDOPPLE = { datei: "src/rechnen.js", funktion: "verdopple", fuer: "test/rechnen.test.js" };
const MIT_NUTZEN = { ...funktion("2 !== 4"), bereich: "src/", erwarteteDateien: ["src/rechnen.js", "src/text.js", "test/rechnen.test.js"], nutzen: [VERDOPPLE] };
const TEST_OHNE_DIE_FUNKTION = ['import assert from "node:assert/strict";', 'import { test } from "node:test";', 'import * as rechnen from "../src/rechnen.js";', 'test("verdoppelt", () => assert.equal(rechnen["verdopple"](2), 4));', ""].join("\n");
const NACHBAU_IN_NEUER_DATEI = { "src/text.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n", "src/rechnen.js": VERDOPPELT };

function verstossImPrompt(werkzeug, verstoss) {
  return readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8").includes(`Verstoß: ${verstoss}`);
}

test("nutzt nur die Testdatei des Auftrags die vorgeschriebene Funktion, ist vorhandenes genutzt grün", (context) => {
  const { lauf, beleg } = starte(context, { auftrag: MIT_NUTZEN, drehbuch: { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } } });
  assert.equal(pruefung(beleg, PRUEFUNG.GENUTZT), EXIT_GRUEN, lauf.stdout + lauf.stderr);
});

test("nennt keine neue Zeile des Auftrags die vorgeschriebene Funktion, ist vorhandenes genutzt rot", (context) => {
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: MIT_NUTZEN, drehbuch: { test: { "test/rechnen.test.js": TEST_OHNE_DIE_FUNKTION }, bau: { "src/rechnen.js": VERDOPPELT } } });
  assert.equal(pruefung(beleg, PRUEFUNG.GENUTZT), EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(verstossImPrompt(werkzeug, "nicht genutzt: src/rechnen.js:verdopple (für test/rechnen.test.js)"));
});

test("deklariert der Bau-Agent die Funktion in einer neuen Datei neu, ist vorhandenes genutzt trotz Nutzung in der Testdatei rot", (context) => {
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: MIT_NUTZEN, drehbuch: { test: { "test/rechnen.test.js": ROTER_TEST }, bau: NACHBAU_IN_NEUER_DATEI } });
  assert.equal(pruefung(beleg, PRUEFUNG.GENUTZT), EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(verstossImPrompt(werkzeug, "nachgebaut: src/text.js deklariert verdopple neu, statt src/rechnen.js:verdopple zu nutzen (für test/rechnen.test.js)"));
});
