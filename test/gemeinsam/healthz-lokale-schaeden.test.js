import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { registerPublicRoutes } from "../../src/app.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";
import { mitRoutenServer } from "../anrufe/routen-server.js";

const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const CONFIG = { server: { deployedCommit: "b8c0ffee", webDistDir: "kein-web" } };
const TAKT_MS = 500;
const TAKTE_JE_FENSTER = 20;
const GRENZE_MS = 2000;
const FENSTER_FOLGE = 6;
const POOL_STAU_MS = 300_000;
const KURZ = Object.freeze({
  taktMs: 4,
  taktJeFenster: 25,
  loopGrenzeMs: 30,
  loopFensterFolge: 2,
  poolStauMs: 1000,
});
const BLOCKADE_MS = 60;
const RUNDEN = 8;
const ERHOLUNG_MS = 40;

function blockiere(ms) {
  const ende = performance.now() + ms;
  while (performance.now() < ende) continue;
}

async function mitBlockaden(runden) {
  for (let runde = 0; runde < runden; runde += 1) {
    blockiere(BLOCKADE_MS);
    await echtWarten(ERHOLUNG_MS);
  }
}

async function mitHealthz({ poolZustand, healthzOptionen }, aufruf) {
  const router = express.Router();
  registerPublicRoutes({ app: router, config: CONFIG, store: { poolZustand }, healthzOptionen });
  return mitRoutenServer(router, (basis) =>
    aufruf(async () => {
      const antwort = await abrufMitFrist(`${basis}/healthz`);
      return { status: antwort.status, koerper: await antwort.json() };
    }),
  );
}

function simulierteUhr(t) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let zeit = 0;
  return {
    uhr: () => zeit,
    fenster: (verzugMs) => {
      for (let takt = 0; takt < TAKTE_JE_FENSTER; takt += 1) {
        zeit += TAKT_MS + (takt === 0 ? verzugMs : 0);
        t.mock.timers.tick(TAKT_MS);
      }
    },
    vor: (ms) => {
      zeit += ms;
    },
  };
}

function wiederholt(anzahl, aufgabe) {
  for (let nummer = 0; nummer < anzahl; nummer += 1) aufgabe();
}

test("Healthz: ohne Schaden antwortet die Route 200 mit ok und Commit", async () => {
  const ergebnis = await mitHealthz({}, (hole) => hole());
  assert.equal(ergebnis.status, HTTP_OK);
  assert.deepEqual(ergebnis.koerper, { ok: true, commit: "b8c0ffee" });
});

test("Healthz: sechs Fenster mit mehr als 2 s Verzug hintereinander -> 503 mit Schaden event-loop, fuenf nicht", async (t) => {
  const { uhr, fenster } = simulierteUhr(t);
  await mitHealthz({ healthzOptionen: { uhr } }, async (hole) => {
    wiederholt(FENSTER_FOLGE - 1, () => fenster(GRENZE_MS + 1));
    assert.equal((await hole()).status, HTTP_OK);
    fenster(GRENZE_MS + 1);
    const krank = await hole();
    assert.equal(krank.status, HTTP_SERVICE_UNAVAILABLE);
    assert.deepEqual(krank.koerper, { ok: false, schaden: "event-loop", commit: "b8c0ffee" });
  });
});

test("Healthz: genau 2 s Verzug ist noch gesund", async (t) => {
  const { uhr, fenster } = simulierteUhr(t);
  await mitHealthz({ healthzOptionen: { uhr } }, async (hole) => {
    wiederholt(FENSTER_FOLGE + 1, () => fenster(GRENZE_MS));
    assert.equal((await hole()).status, HTTP_OK);
  });
});

test("Healthz: ein ruhiges Fenster unterbricht die Folge, der Verzug zaehlt auch bei nur einem langsamen Takt", async (t) => {
  const { uhr, fenster } = simulierteUhr(t);
  await mitHealthz({ healthzOptionen: { uhr } }, async (hole) => {
    wiederholt(FENSTER_FOLGE - 1, () => fenster(GRENZE_MS + 1));
    fenster(0);
    wiederholt(FENSTER_FOLGE - 1, () => fenster(GRENZE_MS + 1));
    assert.equal((await hole()).status, HTTP_OK);
  });
});

test("Healthz: Pool-Stau erst nach 300 s -> 503 mit Schaden pool, ein leerer Stau setzt die Zeit zurueck", async (t) => {
  const { uhr, vor } = simulierteUhr(t);
  let wartend = 2;
  const poolZustand = () => ({ wartend, offen: 10 });
  await mitHealthz({ poolZustand, healthzOptionen: { uhr } }, async (hole) => {
    assert.equal((await hole()).status, HTTP_OK);
    vor(POOL_STAU_MS - 1);
    assert.equal((await hole()).status, HTTP_OK);
    vor(1);
    const gestaut = await hole();
    assert.equal(gestaut.status, HTTP_SERVICE_UNAVAILABLE);
    assert.deepEqual(gestaut.koerper, { ok: false, schaden: "pool", commit: "b8c0ffee" });
    wartend = 0;
    assert.equal((await hole()).status, HTTP_OK);
    wartend = 1;
    assert.equal((await hole()).status, HTTP_OK);
    vor(POOL_STAU_MS - 1);
    assert.equal((await hole()).status, HTTP_OK);
  });
});

test("Healthz: bei Event-Loop und Pool zugleich nennt die Antwort den Event-Loop", async (t) => {
  const { uhr, fenster, vor } = simulierteUhr(t);
  await mitHealthz({ poolZustand: () => ({ wartend: 1, offen: 10 }), healthzOptionen: { uhr } }, async (hole) => {
    assert.equal((await hole()).status, HTTP_OK);
    wiederholt(FENSTER_FOLGE, () => fenster(GRENZE_MS + 1));
    vor(POOL_STAU_MS);
    assert.equal((await hole()).koerper.schaden, "event-loop");
  });
});

test("Healthz: ohne Pool (json-Speicher) bleibt es auch nach langer Zeit bei 200", async (t) => {
  const { uhr, vor } = simulierteUhr(t);
  await mitHealthz({ poolZustand: () => null, healthzOptionen: { uhr } }, async (hole) => {
    vor(POOL_STAU_MS * 2);
    assert.equal((await hole()).status, HTTP_OK);
  });
});

test("Healthz: der echte Event-Loop, dauerhaft blockiert -> 503, ein einzelner Ausreisser nicht", async () => {
  await mitHealthz({ healthzOptionen: { schwellen: KURZ } }, async (hole) => {
    await mitBlockaden(1);
    assert.equal((await hole()).status, HTTP_OK);
    await mitBlockaden(RUNDEN);
    assert.equal((await hole()).status, HTTP_SERVICE_UNAVAILABLE);
  });
});
