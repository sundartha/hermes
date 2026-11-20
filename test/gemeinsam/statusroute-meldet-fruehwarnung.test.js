import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedCall } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { logBis } from "./log-bis.mjs";
import { bearer, SCHLUESSEL, STATUS_PATH } from "./statusroute-hilfe.mjs";

const HTTP_OK = 200;
const MS_PER_MINUTE = 60_000;
const LAUFZEIT_S = 1800;
const ENV = { HERMES_STATUS_TOKEN: SCHLUESSEL, SKIP_TWILIO_SIGNATURE_CHECK: "false" };

function aktiverAnruf(id, alterMinuten) {
  const start = new Date(Date.now() - alterMinuten * MS_PER_MINUTE).toISOString();
  return seedCall({ id, maxDurationS: LAUFZEIT_S, startedAt: start, answeredAt: start });
}

async function status(server) {
  const antwort = await abrufMitFrist(`${server.localUrl}${STATUS_PATH}`, { headers: { authorization: bearer(SCHLUESSEL) } });
  assert.equal(antwort.status, HTTP_OK);
  return antwort.json();
}

async function healthz(server) {
  const antwort = await abrufMitFrist(`${server.localUrl}/healthz`);
  assert.equal(antwort.status, HTTP_OK);
  return antwort.json();
}

async function fremderWebhook(server) {
  const antwort = await abrufMitFrist(`${server.localUrl}/voice/incoming`, {
    method: "POST",
    body: new URLSearchParams({ CallSid: "CAfremd", From: "+4915112345678", To: "+4915112345679" }),
  });
  assert.equal(antwort.status, 403);
}

async function mitServer(optionen, arbeit) {
  const server = await startServer({ env: ENV, ...optionen });
  try {
    return await arbeit(server);
  } finally {
    await server.stop();
  }
}

test("Status zaehlt abgewiesene Webhooks: Start 0, jeder 403 zaehlt einen", () =>
  mitServer({}, async (server) => {
    assert.equal((await status(server)).webhooksAbgewiesen, 0);
    await fremderWebhook(server);
    assert.equal((await status(server)).webhooksAbgewiesen, 1);
    await fremderWebhook(server);
    assert.equal((await status(server)).webhooksAbgewiesen, 2);
    assert.equal((await status(server)).webhooksAbgewiesen, 2);
  }));

test("Status zaehlt einen aktiven Anruf von 21 Minuten als ueber der Hoechstdauer", () =>
  mitServer({ seed: { calls: [aktiverAnruf("call_alt", 21)] } }, async (server) => {
    assert.equal((await status(server)).anrufeUeberHoechstdauer, 1);
  }));

test("Status zaehlt einen aktiven Anruf von 19 Minuten nicht", () =>
  mitServer({ seed: { calls: [aktiverAnruf("call_jung", 19)] } }, async (server) => {
    assert.equal((await status(server)).anrufeUeberHoechstdauer, 0);
  }));

test("Status zaehlt einen beendeten Anruf von 21 Minuten nicht", () =>
  mitServer(
    { seed: { calls: [{ ...aktiverAnruf("call_fertig", 21), status: "completed", endedAt: new Date().toISOString() }] } },
    async (server) => {
      assert.equal((await status(server)).anrufeUeberHoechstdauer, 0);
    },
  ));

test("Healthz bleibt bei 0 und 0 unveraendert", () =>
  mitServer({}, async (server) => {
    const koerper = await healthz(server);
    assert.deepEqual(Object.keys(koerper).sort(), ["commit", "ok"]);
    assert.equal(koerper.ok, true);
    assert.equal(server.stdout.includes("[fruehwarnung]"), false);
  }));

test("Healthz nennt abgewiesene Webhooks und loggt die Fruehwarnung", () =>
  mitServer({}, async (server) => {
    await fremderWebhook(server);
    const koerper = await healthz(server);
    assert.equal(koerper.webhooksAbgewiesen, 1);
    assert.equal("anrufeUeberHoechstdauer" in koerper, false);
    await logBis(server, "[fruehwarnung] webhooksAbgewiesen=1 anrufeUeberHoechstdauer=0");
  }));

test("Healthz nennt Anrufe ueber der Hoechstdauer und loggt die Fruehwarnung", () =>
  mitServer({ seed: { calls: [aktiverAnruf("call_alt", 21)] } }, async (server) => {
    const koerper = await healthz(server);
    assert.equal(koerper.anrufeUeberHoechstdauer, 1);
    assert.equal("webhooksAbgewiesen" in koerper, false);
    await logBis(server, "[fruehwarnung] webhooksAbgewiesen=0 anrufeUeberHoechstdauer=1");
  }));
