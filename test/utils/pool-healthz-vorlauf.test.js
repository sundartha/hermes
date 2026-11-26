import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test } from "node:test";
import express from "express";

import { registerPublicRoutes } from "../../src/app.js";

import { ueberwacheClients } from "../../src/utils/pg-pool.js";
import { mitRoutenServer } from "../anrufe/routen-server.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_FEHLER = 500;
const CONFIG = { server: { deployedCommit: "b8c0ffee", webDistDir: "kein-web" } };

function mitHealthz({ config = CONFIG, healthzOptionen }, aufruf) {
  const router = express.Router();
  registerPublicRoutes({ app: router, config, store: { poolZustand: () => null }, healthzOptionen });
  return mitRoutenServer(router, aufruf);
}

function poolMitClients() {
  const pool = new EventEmitter();
  const client = () => new EventEmitter();
  return { pool, client };
}

test("Pool-Hoerer: ein Verbindungsfehler wird mit Pool-Namen gemeldet und nach dem Zurueckgeben nicht mehr gehoert", () => {
  const protokoll = mock.method(console, "error", () => {});
  try {
    const { pool, client } = poolMitClients();
    ueberwacheClients(pool, "haupt");
    const verbindung = client();
    pool.emit("acquire", verbindung);
    assert.equal(verbindung.listenerCount("error"), 1);
    verbindung.emit("error", new Error("abgerissen"));
    assert.deepEqual(protokoll.mock.calls.map((aufruf) => aufruf.arguments), [
      ["[pool:haupt] Verbindungsfehler: abgerissen"],
    ]);
    pool.emit("release", undefined, verbindung);
    assert.equal(verbindung.listenerCount("error"), 0);
  } finally {
    protokoll.mock.restore();
  }
});

test("Pool-Hoerer: eine Rueckgabe ohne vorherige Ausgabe wirft nicht", () => {
  const { pool, client } = poolMitClients();
  ueberwacheClients(pool, "haupt");
  const fremd = client();
  fremd.on("error", () => {});
  assert.doesNotThrow(() => pool.emit("release", undefined, fremd));
  assert.equal(fremd.listenerCount("error"), 1);
});

test("Healthz: ein Fehler der Zeitplan-Abfrage wird zum Serverfehler statt zum haengenden Aufruf", async () => {
  const protokoll = mock.method(console, "error", () => {});
  try {
    const healthzOptionen = { zeitplaene: () => Promise.reject(new Error("zeitplan kaputt")) };
    const status = await mitHealthz({ healthzOptionen }, async (basis) => (await abrufMitFrist(`${basis}/healthz`)).status);
    assert.equal(status, HTTP_FEHLER);
  } finally {
    protokoll.mock.restore();
  }
});

test("Healthz: ohne Zeitplaene und Warnungen kommt nur ok, Commit und Instanz", async () => {
  const config = { server: CONFIG.server, telemetry: { telemetryInstanceId: "inst-1" } };
  const antwort = await mitHealthz({ config }, async (basis) => {
    const res = await abrufMitFrist(`${basis}/healthz`);
    return { status: res.status, koerper: await res.json() };
  });
  assert.deepEqual(antwort, { status: HTTP_OK, koerper: { ok: true, commit: "b8c0ffee", instanz: "inst-1" } });
});

test("Healthz: die Fruehwarnung nennt beide Zaehler als Zahl und erscheint im Koerper", async () => {
  const protokoll = mock.method(console, "error", () => {});
  try {
    const healthzOptionen = {
      zeitplaene: () => Promise.resolve(["wartung"]),
      fruehwarnung: () => ({ webhooksAbgewiesen: 3, anrufeUeberHoechstdauer: 2 }),
    };
    const koerper = await mitHealthz({ healthzOptionen }, async (basis) => (await abrufMitFrist(`${basis}/healthz`)).json());
    assert.deepEqual(koerper, {
      ok: true,
      commit: "b8c0ffee",
      zeitplaeneUeberfaellig: 1,
      webhooksAbgewiesen: 3,
      anrufeUeberHoechstdauer: 2,
    });
    const zeilen = protokoll.mock.calls.map((aufruf) => aufruf.arguments[0]);
    assert.deepEqual(zeilen, [
      "[fruehwarnung] webhooksAbgewiesen=3 anrufeUeberHoechstdauer=2",
      "[zeitplan] Herzschlag überfällig: wartung",
    ]);
  } finally {
    protokoll.mock.restore();
  }
});
