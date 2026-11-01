import assert from "node:assert/strict";
import { test } from "node:test";

import { main } from "../../tools/uebernahme/schatten-vergleich.mjs";
import { DATEI_A, DATEI_B, REPOSITORY, berichtText, schein } from "./uebernahme-hilfen.js";
import { zipMitEinerDatei } from "./pruefer/zip.mjs";

const LAUF_ID = 31;
const ERSTES_ARTEFAKT = 3101;
const ZWEITES_ARTEFAKT = 3102;

function vorhersage(dateien) {
  return JSON.stringify({
    art: "ci",
    teil: 1,
    dateien: dateien.map(([datei, uebernehmbar]) => ({
      datei,
      uebernehmbar,
      ...(uebernehmbar && { erwartet: { bestanden: true } }),
    })),
  });
}

function laufRouten({ vorhergesagt, frisch }) {
  const artefakte = [];
  const routen = new Map();
  const lege = (id, name, { datei, inhalt }) => {
    artefakte.push({ id, name });
    routen.set(`GET /repos/${REPOSITORY}/actions/artifacts/${id}/zip`, zipMitEinerDatei(datei, inhalt));
  };
  if (vorhergesagt) lege(ERSTES_ARTEFAKT, "uebernahme-schatten-teil-1", { datei: "uebernahme-schatten.json", inhalt: vorhergesagt });
  if (frisch) lege(ZWEITES_ARTEFAKT, "testlaufzeit-teil-1", { datei: "dateien.jsonl", inhalt: frisch });
  routen.set(`GET /repos/${REPOSITORY}/actions/runs/${LAUF_ID}/artifacts`, { total_count: artefakte.length, artifacts: artefakte });
  return routen;
}

async function vergleich(context, szenario) {
  const { github } = await schein(context, laufRouten(szenario));
  const ausgabe = [];
  context.mock.method(console, "log", (text) => ausgabe.push(text));
  const status = await main(["--lauf", String(LAUF_ID)], github);
  return { status, text: ausgabe.join("\n") };
}

test("stimmt das frische Ergebnis mit der Vorhersage überein, endet der Vergleich mit Exit 0", async (context) => {
  const { status, text } = await vergleich(context, {
    vorhergesagt: vorhersage([[DATEI_A, true], [DATEI_B, true]]),
    frisch: berichtText([[DATEI_A, true], [DATEI_B, true]]),
  });
  assert.equal(status, 0);
  assert.match(text, /übernehmbar 2, gleich 2, abweichend 0 \[\]/);
});

test("weicht eine Datei ab, nennt der Vergleich sie und endet mit Exit 1", async (context) => {
  const { status, text } = await vergleich(context, {
    vorhergesagt: vorhersage([[DATEI_A, true], [DATEI_B, true]]),
    frisch: berichtText([[DATEI_A, true], [DATEI_B, false]]),
  });
  assert.equal(status, 1);
  assert.match(text, new RegExp(`übernehmbar 2, gleich 1, abweichend 1 \\[${DATEI_B}\\]`));
});

test("eine übernehmbar vorhergesagte Datei ohne frisches Ergebnis weicht ab", async (context) => {
  const { status, text } = await vergleich(context, {
    vorhergesagt: vorhersage([[DATEI_A, true]]),
    frisch: berichtText([[DATEI_B, true]]),
  });
  assert.equal(status, 1);
  assert.match(text, new RegExp(`abweichend 1 \\[${DATEI_A}\\]`));
});

test("nicht übernehmbare Dateien zählen nicht als Abweichung", async (context) => {
  const { status, text } = await vergleich(context, {
    vorhergesagt: vorhersage([[DATEI_A, false], [DATEI_B, true]]),
    frisch: berichtText([[DATEI_A, false], [DATEI_B, true]]),
  });
  assert.equal(status, 0);
  assert.match(text, /übernehmbar 1, gleich 1, abweichend 0/);
});

test("ohne Vorhersage im Lauf endet der Vergleich mit Exit 1, statt Übereinstimmung zu behaupten", async (context) => {
  const { status } = await vergleich(context, { frisch: berichtText([[DATEI_A, true]]) });
  assert.equal(status, 1);
});

test("ohne Lauf-Nummer endet der Vergleich mit dem Aufruffehler", async (context) => {
  const { github } = await schein(context, new Map());
  context.mock.method(console, "error", () => {});
  assert.equal(await main([], github), 2);
});
