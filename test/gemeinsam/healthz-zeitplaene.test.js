import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { registerPublicRoutes } from "../../src/app.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { mitRoutenServer } from "../anrufe/routen-server.js";

const HTTP_OK = 200;
const CONFIG = { server: { deployedCommit: "b8c0ffee", webDistDir: "kein-web" } };

async function healthz(healthzOptionen) {
  const router = express.Router();
  registerPublicRoutes({ app: router, config: CONFIG, store: {}, healthzOptionen });
  return mitRoutenServer(router, async (basis) => {
    const antwort = await abrufMitFrist(`${basis}/healthz`);
    return { status: antwort.status, koerper: await antwort.json() };
  });
}

test("Healthz-Zeitpläne: ohne überfällige Zeitpläne bleibt die Antwort unverändert", async () => {
  const antwort = await healthz({ zeitplaene: async () => [] });
  assert.equal(antwort.status, HTTP_OK);
  assert.deepEqual(antwort.koerper, { ok: true, commit: "b8c0ffee" });
});

test("Healthz-Zeitpläne: überfällige Zeitpläne erscheinen als Zahl, ohne Namen, und der Dienst bleibt erreichbar", async () => {
  const antwort = await healthz({ zeitplaene: async () => ["aufbewahrung", "sweep"] });
  assert.equal(antwort.status, HTTP_OK);
  assert.deepEqual(antwort.koerper, { ok: true, commit: "b8c0ffee", zeitplaeneUeberfaellig: 2 });
});
