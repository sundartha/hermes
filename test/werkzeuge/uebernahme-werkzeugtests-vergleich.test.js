import assert from "node:assert/strict";
import { test } from "node:test";

import { main } from "../../tools/uebernahme/schatten-vergleich.mjs";
import { zipMitEinerDatei } from "./pruefer/zip.mjs";
import { DATEI_A, DATEI_B, REPOSITORY, berichtText, schein } from "./uebernahme-hilfen.js";

const CI_LAUF = 41;
const PRUEFLEITER_LAUF = 42;

function laufRouten(laufId, { artefakt, datei, ergebnisse }) {
  const id = laufId * 10;
  return new Map([
    [`GET /repos/${REPOSITORY}/actions/runs/${laufId}/artifacts`, { total_count: 1, artifacts: [{ id, name: artefakt }] }],
    [`GET /repos/${REPOSITORY}/actions/artifacts/${id}/zip`, zipMitEinerDatei(datei, berichtText(ergebnisse))],
  ]);
}

async function vergleich(context, { ci, pruefleiter }) {
  const routen = new Map([
    ...laufRouten(CI_LAUF, { artefakt: "testlaufzeit-teil-1", datei: "dateien.jsonl", ergebnisse: ci }),
    ...laufRouten(PRUEFLEITER_LAUF, { artefakt: "werkzeugteil-1", datei: "werkzeugteil-1.jsonl", ergebnisse: pruefleiter }),
  ]);
  const { github } = await schein(context, routen);
  const ausgabe = [];
  context.mock.method(console, "log", (text) => ausgabe.push(text));
  const status = await main(["--lauf", String(CI_LAUF), "--pruefleiter", String(PRUEFLEITER_LAUF)], github);
  return { status, text: ausgabe.join("\n") };
}

test("fahren CI und Prüfleiter dieselben Werkzeugtests mit demselben Ergebnis, endet der Vergleich mit Exit 0", async (context) => {
  const { status, text } = await vergleich(context, {
    ci: [[DATEI_A, true], [DATEI_B, true]],
    pruefleiter: [[DATEI_B, true]],
  });
  assert.equal(status, 0);
  assert.match(text, /Werkzeug-Testdateien 1, gleich 1, abweichend 0/);
});

test("ein anderes Ergebnis oder eine fehlende Datei in der CI macht den Vergleich rot und wird genannt", async (context) => {
  const { status, text } = await vergleich(context, {
    ci: [[DATEI_A, true], [DATEI_B, false]],
    pruefleiter: [[DATEI_B, true], ["test/werkzeuge/c.test.js", true]],
  });
  assert.equal(status, 1);
  assert.match(text, new RegExp(`abweichend 2 \\[${DATEI_B}, test/werkzeuge/c.test.js\\]`));
});

test("ein Prüfleiter-Lauf ohne Werkzeug-Berichte gilt nicht als Übereinstimmung", async (context) => {
  const { status } = await vergleich(context, { ci: [[DATEI_A, true]], pruefleiter: [] });
  assert.equal(status, 1);
});
