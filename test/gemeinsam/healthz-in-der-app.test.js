import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { abrufMitFrist } from "./antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const POOL_STAU_MS = 300_000;
const DATENORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "healthz-app-"));
const ABHAENGIGKEITEN = [
  "callFinish lifecycle provisioning ttsStore directiveSynth voiceRender messaging",
  "elevenLabsOutbound inboundBridges consultDelivery durableAuditFor",
].flatMap((zeile) => zeile.split(" "));

const { config } = await import("../../src/config.js");
Object.assign(config.server, { dataDir: DATENORDNER, webDistDir: path.join(DATENORDNER, "web") });
const speicher = await import("../../src/store.js");
const { buildApp } = await import("../../src/app.js");

after(() => fs.rmSync(DATENORDNER, { recursive: true, force: true }));

const standIn = new Proxy(function standIn() {}, {
  get: (_ziel, schluessel) => (schluessel === "then" ? undefined : standIn),
  apply: () => standIn,
});

async function healthzDerApp(t, zusatz) {
  const abhaengigkeiten = {
    ...Object.fromEntries(ABHAENGIGKEITEN.map((name) => [name, standIn])),
    config,
    audit: () => {},
    ...zusatz,
  };
  const { app } = await buildApp(abhaengigkeiten);
  const server = await new Promise((fertig) => {
    const lauscht = app.listen(0, "127.0.0.1", () => fertig(lauscht));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const basis = `http://127.0.0.1:${server.address().port}`;
  const abfrage = async () => (await abrufMitFrist(`${basis}/healthz`)).status;
  return abfrage;
}

test("Healthz in der App: der json-Speicher meldet keinen Pool, /healthz bleibt 200", async (t) => {
  const abfrage = await healthzDerApp(t, { store: speicher });
  assert.equal(speicher.poolZustand(), null);
  assert.equal(await abfrage(), HTTP_OK);
});

test("Healthz in der App: ein Pool, der 300 s lang Anfragen stauen laesst, macht /healthz zu 503", async (t) => {
  let zeit = 0;
  const store = { ...speicher, poolZustand: () => ({ wartend: 3, offen: 10 }) };
  const abfrage = await healthzDerApp(t, { store, healthzOptionen: { uhr: () => zeit } });
  assert.equal(await abfrage(), HTTP_OK);
  zeit += POOL_STAU_MS;
  assert.equal(await abfrage(), HTTP_SERVICE_UNAVAILABLE);
});
