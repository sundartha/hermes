import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { registerPublicRoutes } from "../../src/app.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { mitRoutenServer } from "../anrufe/routen-server.js";

const HTTP_OK = 200;
const CONFIG = { server: { deployedCommit: "b8c0ffee", webDistDir: "kein-web" } };

test("Healthz ohne gelieferte Frühwarnung bleibt still und meldet keine Frühwarnfelder", async () => {
  const fehlerlog = mock.method(console, "error", () => {});
  try {
    const router = express.Router();
    registerPublicRoutes({ app: router, config: CONFIG, store: {}, healthzOptionen: {} });
    const antwort = await mitRoutenServer(router, async (basis) => {
      const roh = await abrufMitFrist(`${basis}/healthz`);
      return { status: roh.status, koerper: await roh.json() };
    });
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(antwort.koerper, { ok: true, commit: "b8c0ffee" });
    const zeilen = fehlerlog.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
    assert.equal(zeilen.filter((zeile) => zeile.includes("[fruehwarnung]")).length, 0);
    assert.equal(zeilen.filter((zeile) => zeile.includes("[zeitplan]")).length, 0);
  } finally {
    fehlerlog.mock.restore();
  }
});

test("Healthz mit überfälligem Zeitplan loggt die Zeitplan-Zeile und meldet die Anzahl", async () => {
  const fehlerlog = mock.method(console, "error", () => {});
  try {
    const router = express.Router();
    registerPublicRoutes({ app: router, config: CONFIG, store: {}, healthzOptionen: { zeitplaene: async () => ["x"] } });
    const antwort = await mitRoutenServer(router, async (basis) => {
      const roh = await abrufMitFrist(`${basis}/healthz`);
      return { status: roh.status, koerper: await roh.json() };
    });
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(antwort.koerper, { ok: true, commit: "b8c0ffee", zeitplaeneUeberfaellig: 1 });
    const zeilen = fehlerlog.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
    assert.equal(zeilen.filter((zeile) => zeile.includes("[zeitplan]")).length, 1);
  } finally {
    fehlerlog.mock.restore();
  }
});
