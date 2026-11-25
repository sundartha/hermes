import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { probeLaufen } from "../../scripts/anruf-probe/wiederholung.mjs";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer-wirft.mjs", import.meta.url));
const ZIEL = "+12722205602";

const uhr = { jetzt: () => Date.parse("2026-11-17T10:00:00.000Z"), warte: async () => {} };

function werfer(meldung, felder = {}) {
  return async () => {
    throw Object.assign(new Error(meldung), felder);
  };
}

async function zweitGrund(meldung, felder) {
  const ergebnis = await probeLaufen({ messen: werfer(meldung, felder), uhr });
  assert.equal(ergebnis.ausgang, "rot");
  assert.deepEqual(ergebnis.zweit.gerissen, ["messung"]);
  return ergebnis.zweit.grund;
}

test("Messung wirft in beiden Versuchen: rot mit Grund im Ergebnis", async () => {
  const ergebnis = await probeLaufen({ messen: werfer("x", { code: "ECONNREFUSED" }), uhr });
  assert.equal(ergebnis.ausgang, "rot");
  assert.deepEqual(ergebnis.zweit.gerissen, ["messung"]);
  assert.equal(ergebnis.zweit.grund, "ECONNREFUSED");
  assert.equal(ergebnis.erst.grund, "ECONNREFUSED");
});

const GRUENDE = [
  ["Fehlercode geht durch", "egal", { code: "ECONNREFUSED" }, "ECONNREFUSED"],
  ["Code der Ursache geht durch", "egal", { cause: { code: "ENOTFOUND" } }, "ENOTFOUND"],
  ["Code mit Ziffern fällt auf den Namen zurück", "egal", { code: "E1234" }, "Error"],
  ["Code ohne Text fällt auf den Namen zurück", "egal", { code: 500 }, "Error"],
  ["Name mit Ziffern ergibt unbekannt", "egal", { name: "Fehler42" }, "unbekannt"],
  ["Freitext der Meldung wird nie übernommen", `Bearer ${PROBE_STAGING_TEST_TOKEN} ungültig`, {}, "Error"],
  ["getrennte Nummer in der Meldung wird nie übernommen", "an +1 272 220 5602 abgelehnt", {}, "Error"],
  ["Adresse in der Meldung wird nie übernommen", "bei https://geheim.example/pfad?x=1", {}, "Error"],
  ["60 Zeichen bleiben", "egal", { code: "A".repeat(60) }, "A".repeat(60)],
  ["61 Zeichen werden auf 60 gekürzt", "egal", { code: "A".repeat(61) }, "A".repeat(60)],
];

for (const [name, meldung, felder, erwartet] of GRUENDE) {
  test(`Messung-Grund: ${name}`, async () => {
    assert.equal(await zweitGrund(meldung, felder), erwartet);
  });
}

test("Messung-Grund: Ausnahme null gibt keinen Grund", async () => {
  const ergebnis = await probeLaufen({
    messen: async () => {
      throw null;
    },
    uhr,
  });
  assert.deepEqual(ergebnis.zweit.gerissen, ["messung"]);
  assert.equal("grund" in ergebnis.zweit, false);
});

test("Messung-Grund: Messung null ohne Ausnahme bleibt ohne Grund", async () => {
  const ergebnis = await probeLaufen({ messen: async () => null, uhr });
  assert.deepEqual(ergebnis.zweit.gerissen, ["messung"]);
  assert.equal("grund" in ergebnis.zweit, false);
});

function probeStarten(fall) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "d".repeat(40),
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FALL: JSON.stringify({ eigeneNummer: ZIEL, stand: { erstversuche: 0, anrufe: 0 }, ...fall }),
  };
  const kind = spawn("node", ["scripts/anruf-probe/probe.mjs"], { env });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

test("Probe: wirft der Anrufer, lautet die Ausgabe Probe rot: messung grund=<Code>", async () => {
  const { code, ausgabe } = await probeStarten({ fehler: "Verbindung abgelehnt", felder: { code: "ECONNREFUSED" } });
  assert.equal(code, 1);
  assert.match(ausgabe, /^Probe rot: messung grund=ECONNREFUSED$/m);
  assert.doesNotMatch(ausgabe, /Verbindung abgelehnt/);
});

test("Probe: Meldung mit Token erscheint nie in der Ausgabe", async () => {
  const { ausgabe } = await probeStarten({ fehler: `Bearer ${PROBE_STAGING_TEST_TOKEN}` });
  assert.match(ausgabe, /^Probe rot: messung grund=Error$/m);
  const ohneMaske = ausgabe.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::"));
  assert.equal(ohneMaske.join("\n").includes(PROBE_STAGING_TEST_TOKEN), false);
});
