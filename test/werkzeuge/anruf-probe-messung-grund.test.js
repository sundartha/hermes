import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { probeLaufen } from "../../scripts/anruf-probe/wiederholung.mjs";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer-wirft.mjs", import.meta.url));
const ZIEL = "+12722205602";

const uhr = { jetzt: () => Date.parse("2026-11-17T10:00:00.000Z"), warte: async () => {} };

function werfer(meldung) {
  return async () => {
    throw new Error(meldung);
  };
}

async function zweitGrund(meldung) {
  const ergebnis = await probeLaufen({ messen: werfer(meldung), uhr });
  assert.equal(ergebnis.ausgang, "rot");
  assert.deepEqual(ergebnis.zweit.gerissen, ["messung"]);
  return ergebnis.zweit.grund;
}

test("Messung wirft in beiden Versuchen: rot mit Grund im Ergebnis", async () => {
  const ergebnis = await probeLaufen({ messen: werfer("Verbindung abgelehnt"), uhr });
  assert.equal(ergebnis.ausgang, "rot");
  assert.deepEqual(ergebnis.zweit.gerissen, ["messung"]);
  assert.equal(ergebnis.zweit.grund, "Verbindung abgelehnt");
  assert.equal(ergebnis.erst.grund, "Verbindung abgelehnt");
});

const BEREINIGT = [
  ["Nummer und Ziffern ab 4 werden ersetzt", "Token abc123 an +491701234567 abgelehnt", "Token abc123 an +*** abgelehnt"],
  ["genau 3 Ziffern bleiben", "Code 123 falsch", "Code 123 falsch"],
  ["genau 4 Ziffern werden ersetzt", "Code 1234 falsch", "Code *** falsch"],
  ["Adresse mit :// entfällt", "Fehler bei https://geheim.example/pfad?x=1 aufgetreten", "Fehler bei *** aufgetreten"],
  ["120 Zeichen bleiben", "a".repeat(120), "a".repeat(120)],
  ["121 Zeichen werden auf 120 gekürzt", "a".repeat(121), "a".repeat(120)],
];

for (const [name, meldung, erwartet] of BEREINIGT) {
  test(`Messung-Grund: ${name}`, async () => {
    assert.equal(await zweitGrund(meldung), erwartet);
  });
}

test("Messung-Grund: Ausnahme ohne Text gibt keinen Grund", async () => {
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

test("Probe: wirft der Anrufer, lautet die Ausgabe Probe rot: messung grund=...", async () => {
  const { code, ausgabe } = await probeStarten({ fehler: "Verbindung abgelehnt" });
  assert.equal(code, 1);
  assert.match(ausgabe, /^Probe rot: messung grund=Verbindung abgelehnt$/m);
});

test("Probe: wirft der Anrufer ohne Text, steht kein grund in der Ausgabe", async () => {
  const { code, ausgabe } = await probeStarten({ fehler: "" });
  assert.equal(code, 1);
  assert.match(ausgabe, /^Probe rot: messung$/m);
});
