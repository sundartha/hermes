import assert from "node:assert/strict";
import { test } from "node:test";

import { testlaufGleichzeitig } from "../../tools/testwirkung/testlauf.mjs";
import { passingTest, probeDirectory } from "./probe-repo.js";

const LAUFZEILE_LANG = "Testwirkung: dauer 1 Dateien 1 Tests 660 s";
const LAUFZEILE_KURZ = "Testwirkung: dauer 1 Dateien 1 Tests 60 s";
const MS_JE_MINUTE = 60_000;
const MINUTEN_DES_LANGEN_LAUFS = 11;
const DAUER_UEBER_ZEHN_MINUTEN = MINUTEN_DES_LANGEN_LAUFS * MS_JE_MINUTE;

async function laufMitDauer(context, dauer) {
  const verzeichnis = probeDirectory(context, {
    "package.json": '{ "type": "module" }\n',
    "test/kurz.test.js": passingTest("läuft"),
  });
  const zeitpunkte = [0, dauer];
  const uhr = context.mock.method(Date, "now", () => zeitpunkte.shift() ?? dauer);
  const ausgabe = context.mock.method(console, "log", () => {});
  const gelaufen = await testlaufGleichzeitig({ name: "dauer", dateien: ["test/kurz.test.js"], muster: [], vorspann: [], verzeichnis });
  uhr.mock.restore();
  ausgabe.mock.restore();
  return { gelaufen, meldungen: ausgabe.mock.calls.map(({ arguments: [text] }) => text) };
}

test("testwirkung: ein Testlauf über zehn Minuten wird gemeldet und liefert trotzdem seine Ergebnisse", async (context) => {
  const { gelaufen, meldungen } = await laufMitDauer(context, DAUER_UEBER_ZEHN_MINUTEN);
  assert.deepEqual(gelaufen.map(({ name, bestanden }) => [name, bestanden]), [["läuft", true]]);
  assert.deepEqual(meldungen, ["Hinweis: Ein Testlauf dauerte 11 Minuten, länger als 10.", LAUFZEILE_LANG]);
});

test("testwirkung: ein kurzer Testlauf meldet keine Dauer", async (context) => {
  const { gelaufen, meldungen } = await laufMitDauer(context, MS_JE_MINUTE);
  assert.equal(gelaufen.length, 1);
  assert.deepEqual(meldungen, [LAUFZEILE_KURZ]);
});
