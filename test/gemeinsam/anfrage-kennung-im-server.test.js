import { test } from "node:test";
import assert from "node:assert/strict";

import { placeCall, postTelnyxIncoming, seedState, seedWithTelnyxNumber, startServer, waitForLog } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KENNUNG_HEADER = "x-request-id";
const FREMDE_KENNUNG = "von-aussen-1234567890";
const MIT_KENNUNG_IN_LOGS = Object.freeze({ LOG_REQUEST_ID: "true" });

async function ladeKonfigurationMit(wert, lade) {
  const gemerkt = process.env.LOG_REQUEST_ID;
  try {
    if (wert === undefined) delete process.env.LOG_REQUEST_ID;
    else process.env.LOG_REQUEST_ID = wert;
    return await lade();
  } finally {
    if (gemerkt === undefined) delete process.env.LOG_REQUEST_ID;
    else process.env.LOG_REQUEST_ID = gemerkt;
  }
}

async function mitServer(optionen, lauf) {
  const srv = await startServer(optionen);
  try {
    return await lauf(srv);
  } finally {
    await srv.stop();
  }
}

test("Anfrage-ID: jede Antwort traegt X-Request-Id, zwei Anfragen haben zwei verschiedene", async () => {
  await mitServer({}, async (srv) => {
    const erste = await abrufMitFrist(`${srv.localUrl}/healthz`);
    const zweite = await abrufMitFrist(`${srv.localUrl}/healthz`);
    assert.match(erste.headers.get(KENNUNG_HEADER), UUID);
    assert.match(zweite.headers.get(KENNUNG_HEADER), UUID);
    assert.notEqual(erste.headers.get(KENNUNG_HEADER), zweite.headers.get(KENNUNG_HEADER));
  });
});

test("Anfrage-ID: auch eine Antwort auf einen unbekannten Pfad traegt sie", async () => {
  await mitServer({}, async (srv) => {
    const antwort = await abrufMitFrist(`${srv.localUrl}/gibt-es-nicht`);
    assert.equal(antwort.status, 404);
    assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
  });
});

test("Anfrage-ID: eine vom Aufrufer mitgeschickte X-Request-Id wird nicht uebernommen", async () => {
  await mitServer({}, async (srv) => {
    const antwort = await abrufMitFrist(`${srv.localUrl}/healthz`, { headers: { [KENNUNG_HEADER]: FREMDE_KENNUNG } });
    assert.notEqual(antwort.headers.get(KENNUNG_HEADER), FREMDE_KENNUNG);
    assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
  });
});

test("Anfrage-ID: mit Schalter steht dieselbe ID vor der Antwortzeile des Webhooks", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: MIT_KENNUNG_IN_LOGS };
  await mitServer(optionen, async (srv) => {
    const antwort = await postTelnyxIncoming(srv, { callSid: "CAkennung" });
    const kennung = antwort.headers.get(KENNUNG_HEADER);
    await waitForLog(srv, /^rid=\S+ \[voice-antwort\] weg=\/voice\/incoming ms=\d+ status=\d+ ende=beendet$/m);
    const zeile = srv.stdout.match(/^rid=(\S+) \[voice-antwort\] weg=\/voice\/incoming/m);
    assert.match(kennung, UUID);
    assert.equal(zeile[1], kennung);
  });
});

test("Anfrage-ID: mit Schalter tragen Logzeilen waehrend der Anfrage die ID, die Startzeilen nicht", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }), env: MIT_KENNUNG_IN_LOGS };
  await mitServer(optionen, async (srv) => {
    await postTelnyxIncoming(srv, { callSid: "CAstart" });
    await waitForLog(srv, /^rid=[0-9a-f-]{36} \[voice-antwort\]/m);
    const startZeilen = srv.stdout.split("\n").filter((zeile) => zeile.includes("laeuft auf http"));
    assert.equal(startZeilen.length, 1);
    assert.ok(!startZeilen[0].startsWith("rid="));
  });
});

test("Anfrage-ID: ohne Schalter bleiben alle Logzeilen unveraendert", async () => {
  const optionen = { seed: seedWithTelnyxNumber({ language: "de" }) };
  await mitServer(optionen, async (srv) => {
    const antwort = await postTelnyxIncoming(srv, { callSid: "CAohneschalter" });
    assert.match(antwort.headers.get(KENNUNG_HEADER), UUID);
    await waitForLog(srv, /^\[voice-antwort\] weg=\/voice\/incoming/m);
    assert.ok(!srv.stdout.includes("rid="));
  });
});

test("Anfrage-ID: maschinenlesbare [metrics]-Zeilen bleiben auch mit Schalter unveraendert", async () => {
  const seed = seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", firstName: "Jonas", ownerName: "Jonas Beispiel", country: "DE", defaultLanguage: "de" }],
  });
  const env = { ...MIT_KENNUNG_IN_LOGS, METRICS_ENABLED: "true", ALLOWED_COUNTRY_CODES: "+49" };
  await mitServer({ env, seed }, async (srv) => {
    const antwort = await placeCall(srv, "+12025550143");
    assert.equal(antwort.status, 403);
    await waitForLog(srv, /^\[metrics\] call_denied \{.*\}$/m);
    assert.ok(!srv.stdout.split("\n").some((zeile) => zeile.includes("[metrics]") && zeile.includes("rid=")));
  });
});

test("Anfrage-ID: LOG_REQUEST_ID ungesetzt ist aus, ohne dass der Start verweigert wird", async () => {
  const frisch = await ladeKonfigurationMit(undefined, () => import("../../src/config.js?anfrage-kennung-ungesetzt"));
  assert.strictEqual(frisch.config.metrics.logRequestId, false);
  assert.ok(!frisch.configFatalErrors().some((befund) => befund.includes("LOG_REQUEST_ID")));
});

test("Anfrage-ID: LOG_REQUEST_ID=true schaltet die ID in den Logzeilen an", async () => {
  const frisch = await ladeKonfigurationMit("true", () => import("../../src/config.js?anfrage-kennung-an"));
  assert.strictEqual(frisch.config.metrics.logRequestId, true);
});

test("Anfrage-ID: ein ungueltiger LOG_REQUEST_ID-Wert bleibt aus und wird beim Start benannt", async () => {
  const frisch = await ladeKonfigurationMit("vielleicht", () => import("../../src/config.js?anfrage-kennung-ungueltig"));
  assert.strictEqual(frisch.config.metrics.logRequestId, false);
  assert.ok(frisch.configFatalErrors().some((befund) => befund.includes("LOG_REQUEST_ID")));
});
