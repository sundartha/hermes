import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { appOhneAbhaengigkeiten } from "./app-ohne-abhaengigkeiten.js";

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const POOL_STAU_MS = 300_000;
const DATENORDNER = fs.mkdtempSync(path.join(os.tmpdir(), "healthz-app-"));

const { config } = await import("../../src/config.js");
Object.assign(config.server, { dataDir: DATENORDNER, webDistDir: path.join(DATENORDNER, "web") });
const speicher = await import("../../src/store.js");

after(() => fs.rmSync(DATENORDNER, { recursive: true, force: true }));

async function healthzDerApp(t, zusatz) {
  const basis = await appOhneAbhaengigkeiten(t, { config, audit: () => {}, ...zusatz });
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
