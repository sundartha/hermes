import assert from "node:assert/strict";
import { test } from "node:test";

import express from "express";

import { registerPublicRoutes } from "../../src/app.js";
import { mitRoutenServer } from "../anrufe/routen-server.js";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { logBis } from "./log-bis.mjs";

const HTTP_OK = 200;
const ENV = { SKIP_TWILIO_SIGNATURE_CHECK: "false" };
const ZEILE_EINS = "[fruehwarnung] webhooksAbgewiesen=1 anrufeUeberHoechstdauer=0";
const ZEILE_ZWEI = "[fruehwarnung] webhooksAbgewiesen=2 anrufeUeberHoechstdauer=0";

function zeilen(server, text) {
  return server.stdout.split(text).length - 1;
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

test("Zwei Healthz nach einem 403 loggen die Fruehwarnung genau einmal, ein weiterer 403 eine zweite Zeile", () =>
  mitServer({}, async (server) => {
    await fremderWebhook(server);
    assert.equal((await healthz(server)).webhooksAbgewiesen, 1);
    assert.equal((await healthz(server)).webhooksAbgewiesen, 1);
    await fremderWebhook(server);
    assert.equal((await healthz(server)).webhooksAbgewiesen, 2);
    await logBis(server, ZEILE_ZWEI);
    assert.equal(zeilen(server, ZEILE_EINS), 1);
    assert.equal(zeilen(server, ZEILE_ZWEI), 1);
  }));

test("Aendert sich nur anrufeUeberHoechstdauer, erscheint eine neue Zeile", async (t) => {
  const zustand = { webhooksAbgewiesen: 1, anrufeUeberHoechstdauer: 0 };
  const fehlerlog = t.mock.method(console, "error", () => {});
  const router = express.Router();
  registerPublicRoutes({
    app: router,
    config: { server: { deployedCommit: "b8c0ffee", webDistDir: "kein-web" } },
    store: {},
    healthzOptionen: { fruehwarnung: () => zustand },
  });
  await mitRoutenServer(router, async (basis) => {
    await abrufMitFrist(`${basis}/healthz`);
    await abrufMitFrist(`${basis}/healthz`);
    zustand.anrufeUeberHoechstdauer = 1;
    await abrufMitFrist(`${basis}/healthz`);
    await abrufMitFrist(`${basis}/healthz`);
  });
  const zeilen = fehlerlog.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
  assert.deepEqual(
    zeilen.filter((zeile) => zeile.startsWith("[fruehwarnung]")),
    [ZEILE_EINS, "[fruehwarnung] webhooksAbgewiesen=1 anrufeUeberHoechstdauer=1"],
  );
});
