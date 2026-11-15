import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { makeInternStatusRoutes } from "../../src/routes/intern-status.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { bearer, konfiguration, SCHLUESSEL, STATUS_PATH, mitStatusroute, FALSCHER_SCHLUESSEL } from "./statusroute-hilfe.mjs";

const KOPF = "x-hermes-anrufe";
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;

function speicher() {
  return { pruefeVerbindung: async () => undefined, letzterFlushGelungen: async () => true };
}

function einstellung({ eingefroren, attrappe } = {}) {
  const config = konfiguration();
  if (eingefroren !== undefined) config.safety = { outboundFrozen: eingefroren };
  if (attrappe !== undefined) config.voice = { anbieterAttrappe: attrappe };
  return { config, speicher: speicher() };
}

async function lage(optionen, authorization = bearer(SCHLUESSEL)) {
  const { config, speicher: ablage } = einstellung(optionen);
  const { ergebnis } = await mitStatusroute({ speicher: ablage, makeInternStatusRoutes }, { config }, async (basis) => {
    const antwort = await abrufMitFrist(`${basis}${STATUS_PATH}`, { headers: { authorization } });
    return { status: antwort.status, wert: antwort.headers.get(KOPF) };
  });
  return ergebnis;
}

const FAELLE = [
  ["Standardwerte ohne Sperre und mit Anbieter-Adresse von ElevenLabs", { eingefroren: false, attrappe: false }, "echt"],
  ["Konfiguration ohne Angaben gilt als echt", {}, "echt"],
  ["Anbieter-Adresse zeigt auf eine Attrappe", { eingefroren: false, attrappe: true }, "attrappe"],
  ["Kill-Switch gesetzt gilt vor der Attrappe", { eingefroren: true, attrappe: true }, "gesperrt"],
  ["Kill-Switch gesetzt, echte Adresse", { eingefroren: true, attrappe: false }, "gesperrt"],
];

for (const [name, eingabe, erwartet] of FAELLE) {
  test(`Statusroute meldet die Anruflage im Kopf: ${name}`, async () => {
    const antwort = await lage(eingabe);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(antwort.wert, erwartet);
  });
}

test("Statusroute meldet die Anruflage nicht an Abrufe mit falschem Schluessel", async () => {
  const antwort = await lage({ eingefroren: true }, bearer(FALSCHER_SCHLUESSEL));
  assert.equal(antwort.status, HTTP_UNAUTHORIZED);
  assert.equal(antwort.wert, null);
});

const ENV_FAELLE = [
  ["ohne Adresse", { ELEVENLABS_API_BASE: "" }, "echt"],
  ["Standardadresse von ElevenLabs mit Schraegstrich am Ende", { ELEVENLABS_API_BASE: "https://api.elevenlabs.io/" }, "echt"],
  ["nur ElevenLabs auf eigener Adresse, Telnyx echt", { ELEVENLABS_API_BASE: "http://127.0.0.1:9", TELNYX_API_BASE: "" }, "echt"],
  ["nur Telnyx auf eigener Adresse, ElevenLabs echt", { TELNYX_API_BASE: "http://127.0.0.1:9", ELEVENLABS_API_BASE: "" }, "echt"],
  ["Standardadresse von Telnyx mit Schraegstrich, ElevenLabs eigene Adresse", { TELNYX_API_BASE: "https://api.telnyx.com/", ELEVENLABS_API_BASE: "http://127.0.0.1:9" }, "echt"],
  ["beide Anbieter auf eigenen Adressen", { ELEVENLABS_API_BASE: "http://127.0.0.1:9", TELNYX_API_BASE: "http://127.0.0.1:9" }, "attrappe"],
  ["OUTBOUND_FROZEN gesetzt", { ELEVENLABS_API_BASE: "http://127.0.0.1:9", TELNYX_API_BASE: "http://127.0.0.1:9", OUTBOUND_FROZEN: "true" }, "gesperrt"],
];

for (const [name, zusatz, erwartet] of ENV_FAELLE) {
  test(`Statusroute am laufenden Server meldet die Anruflage aus der Umgebung: ${name}`, async () => {
    const server = await startServer({ env: { HERMES_STATUS_TOKEN: SCHLUESSEL, ...zusatz } });
    try {
      const antwort = await abrufMitFrist(`${server.localUrl}${STATUS_PATH}`, { headers: { authorization: bearer(SCHLUESSEL) } });
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(antwort.headers.get(KOPF), erwartet);
    } finally {
      await server.stop();
    }
  });
}
