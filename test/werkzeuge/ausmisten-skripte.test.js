import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_GRUEN, EXIT_ROT, messeUndMelde, plane, testDatei } from "./ausmisten/messung.mjs";

const SKRIPT = "scripts/zaehlen.mjs";
const WERKZEUG = "tools/zaehlen/summe.mjs";
const SKRIPT_TEST = "test/post/zaehlen.test.js";
const SKRIPT_ZWEIT = "test/post/zaehlen-zweit.test.js";
const PROGRAMM = "scripts/doppeln.mjs";
const PROGRAMM_TEST = "test/post/doppeln.test.js";

const SKRIPT_INHALT = "export function zaehle(liste) {\n  return liste.length;\n}\n";
const ZAEHLT = "assert.equal(modul.zaehle([1, 2]), 2);";
const PROGRAMM_INHALT = [
  "const zahl = Number(process.argv[2]);",
  "process.stdout.write(String(zahl * 2));",
  "",
].join("\n");

function programmTest(name) {
  return [
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import { test } from "node:test";',
    "",
    `test(${JSON.stringify(name)}, () => {`,
    `  const lauf = spawnSync(process.execPath, [${JSON.stringify(PROGRAMM)}, "3"], {`,
    '    encoding: "utf8",',
    "  });",
    '  assert.equal(lauf.stdout, "6");',
    "});",
    "",
  ].join("\n");
}

const SKRIPT_DATEIEN = {
  [SKRIPT]: SKRIPT_INHALT,
  [SKRIPT_TEST]: testDatei("../../scripts/zaehlen.mjs", "zählt", ZAEHLT),
};

test("ausmisten-skripte: ein gelöschter Test, der ein Skript unter scripts/ importiert, ist messbar und wird rot", async (context) => {
  const ergebnis = await messeUndMelde(
    context,
    { weg: [SKRIPT_TEST] },
    { dateien: SKRIPT_DATEIEN },
  );
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.ok(ergebnis.gelesen.dateien.includes(SKRIPT), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(
    ergebnis.melden.ausgabe,
    /Mutant auf dem Branch nicht mehr getötet: scripts\/zaehlen\.mjs:/,
  );
});

test("ausmisten-skripte: ein doppelter Test eines Werkzeugs unter tools/ lässt sich löschen", async (context) => {
  const dateien = {
    [WERKZEUG]: SKRIPT_INHALT,
    [SKRIPT_TEST]: testDatei("../../tools/zaehlen/summe.mjs", "zählt", ZAEHLT),
    [SKRIPT_ZWEIT]: testDatei("../../tools/zaehlen/summe.mjs", "zählt noch einmal", ZAEHLT),
  };
  const ergebnis = await messeUndMelde(context, { weg: [SKRIPT_ZWEIT] }, { dateien });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.ok(ergebnis.gelesen.dateien.includes(WERKZEUG), ergebnis.basis.ausgabe);
  assert.ok(Object.values(ergebnis.gelesen.mutanten).includes("Killed"), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
});

test("ausmisten-skripte: ein Skript, das ein gelöschter Test nur als Programm startet, bleibt nicht messbar", async (context) => {
  const dateien = {
    [PROGRAMM]: PROGRAMM_INHALT,
    [PROGRAMM_TEST]: programmTest("doppelt über das Programm"),
  };
  const stand = await plane(context, { weg: [PROGRAMM_TEST] }, dateien);
  assert.equal(stand.planen.status, EXIT_ROT, stand.planen.ausgabe);
  assert.match(stand.planen.ausgabe, /Nicht messbar:/);
  assert.ok(
    stand.planen.ausgabe.includes(
      `${PROGRAMM_TEST}: prüft tools/ oder scripts/ (${PROGRAMM_TEST})`,
    ),
    stand.planen.ausgabe,
  );
});
