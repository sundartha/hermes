import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ANRUFE_LAUFEND_PATH,
  DEPLOY_TOKEN_MIN_LENGTH,
  laufendeAnrufe,
  makeInternAnrufeLaufendRoutes,
} from "../src/routes/intern-anrufe-laufend.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";
import { classifyCallTime } from "../src/store/state-ops.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { mitRoutenServer } from "./anrufe/routen-server.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const RICHTIGES_TOKEN = "r".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const FALSCHES_TOKEN = "f".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const KURZES_TOKEN = "k".repeat(DEPLOY_TOKEN_MIN_LENGTH - 1);
const NUMMER_ANRUFER = "+4915112345678";
const NUMMER_ZIEL = "+493012345678";
const ZWEI_MINUTEN_MS = 120_000;
const FUENF_MINUTEN_MS = 300_000;
const SECHS_MINUTEN_MS = 360_000;
const DREI_STUNDEN_MS = 10_800_000;
const EIGENE_HOECHSTDAUER_S = 60;
const FESTE_UHR_MS = Date.parse("2026-10-04T12:00:00.000Z");
const ERWARTET_LAUFEND = 2;
const ABGELEHNT = Object.freeze({ error: "unauthorized" });
const KEIN_ZWISCHENSPEICHER = "no-store";
const AUTH_FEHLER_ZEILE = "auth_failed";
const FASSADEN_TEIL = Object.freeze({ classifyCallTime, MAX_CALL_DURATION_CAP_S });

function vor(abstandMs, bezugMs) {
  return new Date(bezugMs - abstandMs).toISOString();
}

function anrufe(bezugMs) {
  const anruf = (id, felder) => ({ id, from: NUMMER_ANRUFER, to: NUMMER_ZIEL, ...felder });
  return [
    anruf("call_p15_frisch", { status: "active", startedAt: vor(ZWEI_MINUTEN_MS, bezugMs) }),
    anruf("call_p15_angenommen", {
      status: "active",
      startedAt: vor(SECHS_MINUTEN_MS, bezugMs),
      answeredAt: vor(FUENF_MINUTEN_MS, bezugMs),
    }),
    anruf("call_p15_zombie", { status: "active", startedAt: vor(DREI_STUNDEN_MS, bezugMs) }),
    anruf("call_p15_eigene_grenze", {
      status: "active",
      startedAt: vor(FUENF_MINUTEN_MS, bezugMs),
      maxDurationS: EIGENE_HOECHSTDAUER_S,
    }),
    anruf("call_p15_beendet", { status: "completed", startedAt: vor(ZWEI_MINUTEN_MS, bezugMs) }),
    anruf("call_p15_gescheitert", { status: "failed", startedAt: vor(ZWEI_MINUTEN_MS, bezugMs) }),
    anruf("call_p15_abgebrochen", { status: "cancelled", startedAt: vor(ZWEI_MINUTEN_MS, bezugMs) }),
  ];
}

function speicherMit(calls) {
  return { ...FASSADEN_TEIL, load: () => ({ calls }) };
}

function routeMit(deployToken, calls = []) {
  return makeInternAnrufeLaufendRoutes({
    config: { auth: { deployToken } },
    store: speicherMit(calls),
  });
}

function aufrufen(router, authorization) {
  const headers = authorization === undefined ? {} : { authorization };
  return mitRoutenServer(router, async (basis) => {
    const antwort = await abrufMitFrist(`${basis}${ANRUFE_LAUFEND_PATH}`, { headers });
    return {
      status: antwort.status,
      kopf: { "cache-control": antwort.headers.get("cache-control") },
      koerper: await antwort.json(),
    };
  });
}

async function mitMitschnitt(aufruf) {
  const zeilen = [];
  const original = console.log;
  console.log = (...teile) => zeilen.push(teile.join(" "));
  try {
    return { ergebnis: await aufruf(), zeilen };
  } finally {
    console.log = original;
  }
}

async function abgelehnt(router, authorization) {
  return (await mitMitschnitt(() => aufrufen(router, authorization))).ergebnis;
}

test("Paket 15: ohne konfiguriertes Deploy-Token lehnt der Endpunkt jeden Aufruf mit 401 ab", async () => {
  const router = routeMit("", anrufe(Date.now()));
  for (const authorization of [undefined, "", "Bearer ", `Bearer ${RICHTIGES_TOKEN}`]) {
    const antwort = await abgelehnt(router, authorization);
    assert.equal(antwort.status, HTTP_UNAUTHORIZED, `Authorization ${JSON.stringify(authorization)}`);
    assert.deepEqual(antwort.koerper, ABGELEHNT);
    assert.deepEqual(antwort.kopf, { "cache-control": KEIN_ZWISCHENSPEICHER });
  }
});

test("Paket 15: ein falsches Token bekommt dieselbe 401-Antwort wie ein fehlendes", async () => {
  const ohneKonfiguration = await abgelehnt(routeMit(""), undefined);
  const router = routeMit(RICHTIGES_TOKEN, anrufe(Date.now()));
  const falscheKoepfe = [
    `Bearer ${FALSCHES_TOKEN}`,
    RICHTIGES_TOKEN,
    `Basic ${RICHTIGES_TOKEN}`,
    undefined,
  ];
  for (const authorization of falscheKoepfe) {
    assert.deepEqual(await abgelehnt(router, authorization), ohneKonfiguration, `Authorization ${authorization}`);
  }
  assert.equal(ohneKonfiguration.status, HTTP_UNAUTHORIZED);
});

test("Paket 15: ein konfiguriertes Token unter 32 Zeichen lehnt auch den passenden Aufruf ab", async () => {
  const antwort = await abgelehnt(routeMit(KURZES_TOKEN, anrufe(Date.now())), `Bearer ${KURZES_TOKEN}`);
  assert.equal(antwort.status, HTTP_UNAUTHORIZED);
  assert.deepEqual(antwort.koerper, ABGELEHNT);
});

test("Paket 15: das richtige Token liefert nur das Feld laufend mit der Zahl laufender Anrufe", async () => {
  const router = routeMit(RICHTIGES_TOKEN, anrufe(Date.now()));
  const { ergebnis, zeilen } = await mitMitschnitt(() => aufrufen(router, `Bearer ${RICHTIGES_TOKEN}`));
  assert.equal(ergebnis.status, HTTP_OK);
  assert.deepEqual(ergebnis.koerper, { laufend: ERWARTET_LAUFEND });
  assert.deepEqual(Object.keys(ergebnis.koerper), ["laufend"]);
  assert.deepEqual(zeilen, []);
});

test("Paket 15: gezaehlt werden nur aktive Anrufe innerhalb ihrer Hoechstdauer", () => {
  const alle = anrufe(FESTE_UHR_MS);
  const zaehlen = (calls) => laufendeAnrufe(speicherMit(calls), FESTE_UHR_MS);
  const nur = (id) => zaehlen(alle.filter((anruf) => anruf.id === id));
  assert.equal(zaehlen(alle), ERWARTET_LAUFEND);
  assert.equal(zaehlen([]), 0);
  assert.equal(nur("call_p15_frisch"), 1);
  assert.equal(nur("call_p15_angenommen"), 1);
  assert.equal(nur("call_p15_zombie"), 0);
  assert.equal(nur("call_p15_eigene_grenze"), 0);
  assert.equal(nur("call_p15_beendet"), 0);
  assert.equal(nur("call_p15_gescheitert"), 0);
  assert.equal(nur("call_p15_abgebrochen"), 0);
});

test("Paket 15: die Speicher-Fassade reicht classifyCallTime und MAX_CALL_DURATION_CAP_S an den Endpunkt weiter", async (kontext) => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "intern-anrufe-laufend-"));
  kontext.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const { config } = await import("../src/config.js");
  config.server.dataDir = ordner;
  const fassade = await import("../src/store.js");
  assert.equal(fassade.classifyCallTime, classifyCallTime);
  assert.equal(fassade.MAX_CALL_DURATION_CAP_S, MAX_CALL_DURATION_CAP_S);
});

test("Paket 15: jede Antwort des Endpunkts verbietet das Zwischenspeichern", async () => {
  const router = routeMit(RICHTIGES_TOKEN, anrufe(Date.now()));
  const erlaubt = await aufrufen(router, `Bearer ${RICHTIGES_TOKEN}`);
  const verweigert = await abgelehnt(router, `Bearer ${FALSCHES_TOKEN}`);
  const unkonfiguriert = await abgelehnt(routeMit(""), undefined);
  assert.equal(erlaubt.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
  assert.equal(verweigert.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
  assert.equal(unkonfiguriert.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
});

test("Paket 15: Antwort und Log enthalten weder Token noch Nummern noch Anruf-Kennungen", async () => {
  const calls = anrufe(Date.now());
  const router = routeMit(RICHTIGES_TOKEN, calls);
  const verweigert = await mitMitschnitt(() => aufrufen(router, `Bearer ${FALSCHES_TOKEN}`));
  const erlaubt = await mitMitschnitt(() => aufrufen(router, `Bearer ${RICHTIGES_TOKEN}`));
  const text = JSON.stringify([verweigert, erlaubt]);
  const verboten = [RICHTIGES_TOKEN, FALSCHES_TOKEN, NUMMER_ANRUFER, NUMMER_ZIEL, ...calls.map(({ id }) => id)];
  assert.deepEqual(verboten.filter((wert) => text.includes(wert)), []);
  assert.equal(verweigert.zeilen.filter((zeile) => zeile.includes(AUTH_FEHLER_ZEILE)).length, 1);
  assert.match(verweigert.zeilen[0], /grund=deploy_token$/);
  assert.deepEqual(erlaubt.zeilen, []);
});
