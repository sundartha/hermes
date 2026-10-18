import assert from "node:assert/strict";
import { test } from "node:test";

import { fuehreAus } from "../../tools/auftrag/pruefungen.mjs";
import { funktion, ROTER_TEST } from "./auftrag-lauf-hilfen.js";
import { starte } from "./auftrag-lauf-probe.js";
import { probeDirectory } from "./probe-repo.js";

const COMMITS = ["zwischenstand", "commit"];

test("der Beleg eines Auftrags enthält je Prüfschritt außer den Commits die Dauer in Millisekunden", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const { lauf, beleg: gelesen } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const ohneDauer = gelesen.pruefungen
    .filter(({ dauer_ms: dauer }) => !Number.isInteger(dauer))
    .map(({ name }) => name);
  assert.deepEqual(ohneDauer, COMMITS, JSON.stringify(gelesen.pruefungen));
  const lint = gelesen.pruefungen.find(({ name }) => name === "lint");
  assert.ok(lint.dauer_ms > 0, JSON.stringify(lint));
});

test("fuehreAus wirft, wenn der Start des Befehls selbst scheitert, statt einen roten Schritt zu melden", (context) => {
  const ordner = probeDirectory(context, {});
  assert.throws(() =>
    fuehreAus("kaputt", [process.execPath, "a\0b"], { cwd: ordner, env: process.env }),
  );
});
