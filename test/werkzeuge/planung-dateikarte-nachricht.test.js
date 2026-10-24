import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AUFTRAG, planeAntworten, UEBERGREIFENDER_PRUEFER } from "./planung-plane-probe.js";
import { aufrufe, BESTEHENDER_TEST, exit, GRUPPEN, hinweisInDerDateikarte, INDIREKTER_TEST, LAUF_FRIST_MS, ORDNER, planeIn, planOrdner, UEBER_ZWISCHENDATEI } from "./planung-probe.js";
import { commitAll, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";
import { dateiKarte, nachrichtenKarte } from "../../tools/auftrag/planung/funktionsliste.mjs";

const EXIT_GRUEN = 0;

function nachrichtenProbe(context) {
  const wurzel = probeRepository(context, {
    ".gitignore": "node_modules\n",
    "package.json": JSON.stringify({ type: "module" }),
    "src/a.js": "export const a = 1;\n",
    "src/b.js": 'import { a } from "./a.js";\nexport const b = a;\n',
    "test/direkt.test.js": 'import { a } from "../src/a.js";\nexport const x = a;\n',
    "test/ueber-b.test.js": 'import { b } from "../src/b.js";\nexport const x = b;\n',
    "test/hilfe.js": 'import { a } from "../src/a.js";\nexport const h = a;\n',
    "test/ueber-hilfe.test.js": 'import { h } from "./hilfe.js";\nexport const x = h;\n',
  });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(wurzel, "node_modules"));
  return wurzel;
}

test("die Nachrichtenform der Dateikarte nennt die Zahl aller erreichenden Tests und nur die direkten", async (context) => {
  const wurzel = nachrichtenProbe(context);
  const karte = await dateiKarte(wurzel, [{ nummern: { S1: { aenderungen: [{ datei: "src/a.js", funktion: "a", von: 1, bis: 1 }] } } }]);
  const [eintrag] = await nachrichtenKarte(wurzel, karte);
  const { tests, testsGesamt, ...rest } = eintrag;
  assert.equal(testsGesamt, 3);
  assert.deepEqual(tests, ["test/direkt.test.js"]);
  const { tests: alle, ...ohneTests } = karte[0];
  assert.deepEqual(rest, ohneTests);
  assert.deepEqual(alle, ["test/direkt.test.js", "test/ueber-b.test.js", "test/ueber-hilfe.test.js"]);
});

test("plane: Planer und übergreifender Prüfer sehen in der Dateikarte die Zahl aller Tests und nur die direkten", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  writeFiles(wurzel, UEBER_ZWISCHENDATEI);
  commitAll(wurzel, "indirekter Test");
  const lauf = planeIn(context, wurzel, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER] });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  assert.equal(pruefungen.length, GRUPPEN.length + UEBERGREIFENDER_PRUEFER);
  const uebergreifend = pruefungen.find(({ eingabe }) => eingabe.includes("### Dateikarte"));
  for (const { eingabe } of [zuschnitt, uebergreifend]) {
    assert.deepEqual(hinweisInDerDateikarte(eingabe), { testsGesamt: 2, tests: [BESTEHENDER_TEST] });
    assert.equal(eingabe.includes(INDIREKTER_TEST), false, eingabe);
  }
});
