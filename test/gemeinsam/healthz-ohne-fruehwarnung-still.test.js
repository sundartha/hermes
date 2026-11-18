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
  } finally {
    fehlerlog.mock.restore();
  }
});
