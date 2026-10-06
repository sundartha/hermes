import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ANRUFE_LAUFEND_PATH,
  DEPLOY_TOKEN_MIN_LENGTH,
  anrufeLaufendHandler,
  laufendeAnrufe,
} from "../src/routes/intern-anrufe-laufend.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";
import { classifyCallTime } from "../src/store/state-ops.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const RICHTIGES_TOKEN = "r".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const FALSCHES_TOKEN = "f".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const KURZES_TOKEN = "k".repeat(DEPLOY_TOKEN_MIN_LENGTH - 1);
const AUFRUFER_IP = "203.0.113.15";
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

function handlerMit(deployToken, calls = []) {
  return anrufeLaufendHandler({
    config: { auth: { deployToken } },
    store: speicherMit(calls),
  });
}

function aufrufen(handler, authorization) {
  const antwort = { status: HTTP_OK, kopf: {}, koerper: undefined };
  const res = {
    set(name, wert) {
      antwort.kopf[name.toLowerCase()] = wert;
      return res;
    },
    status(code) {
      antwort.status = code;
      return res;
    },
    json(koerper) {
      antwort.koerper = koerper;
      return res;
    },
  };
  const headers = authorization === undefined ? {} : { authorization };
  handler({ headers, path: ANRUFE_LAUFEND_PATH, ip: AUFRUFER_IP }, res);
  return antwort;
}

function mitMitschnitt(aufruf) {
  const zeilen = [];
  const original = console.log;
  console.log = (...teile) => zeilen.push(teile.join(" "));
  try {
    return { ergebnis: aufruf(), zeilen };
  } finally {
    console.log = original;
  }
}

function abgelehnt(handler, authorization) {
  return mitMitschnitt(() => aufrufen(handler, authorization)).ergebnis;
}

test("Paket 15: ohne konfiguriertes Deploy-Token lehnt der Endpunkt jeden Aufruf mit 401 ab", () => {
  const handler = handlerMit("", anrufe(Date.now()));
  for (const authorization of [undefined, "", "Bearer ", `Bearer ${RICHTIGES_TOKEN}`]) {
    const antwort = abgelehnt(handler, authorization);
    assert.equal(antwort.status, HTTP_UNAUTHORIZED, `Authorization ${JSON.stringify(authorization)}`);
    assert.deepEqual(antwort.koerper, ABGELEHNT);
    assert.deepEqual(antwort.kopf, { "cache-control": KEIN_ZWISCHENSPEICHER });
  }
});

test("Paket 15: ein falsches Token bekommt dieselbe 401-Antwort wie ein fehlendes", () => {
  const ohneKonfiguration = abgelehnt(handlerMit(""), undefined);
  const handler = handlerMit(RICHTIGES_TOKEN, anrufe(Date.now()));
  const falscheKoepfe = [
    `Bearer ${FALSCHES_TOKEN}`,
    RICHTIGES_TOKEN,
    `Basic ${RICHTIGES_TOKEN}`,
    undefined,
  ];
  for (const authorization of falscheKoepfe) {
    assert.deepEqual(abgelehnt(handler, authorization), ohneKonfiguration, `Authorization ${authorization}`);
  }
  assert.equal(ohneKonfiguration.status, HTTP_UNAUTHORIZED);
});

test("Paket 15: ein konfiguriertes Token unter 32 Zeichen lehnt auch den passenden Aufruf ab", () => {
  const antwort = abgelehnt(handlerMit(KURZES_TOKEN, anrufe(Date.now())), `Bearer ${KURZES_TOKEN}`);
  assert.equal(antwort.status, HTTP_UNAUTHORIZED);
  assert.deepEqual(antwort.koerper, ABGELEHNT);
});

test("Paket 15: das richtige Token liefert nur das Feld laufend mit der Zahl laufender Anrufe", () => {
  const handler = handlerMit(RICHTIGES_TOKEN, anrufe(Date.now()));
  const { ergebnis, zeilen } = mitMitschnitt(() => aufrufen(handler, `Bearer ${RICHTIGES_TOKEN}`));
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

test("Paket 15: jede Antwort des Endpunkts verbietet das Zwischenspeichern", () => {
  const handler = handlerMit(RICHTIGES_TOKEN, anrufe(Date.now()));
  const erlaubt = aufrufen(handler, `Bearer ${RICHTIGES_TOKEN}`);
  const verweigert = abgelehnt(handler, `Bearer ${FALSCHES_TOKEN}`);
  const unkonfiguriert = abgelehnt(handlerMit(""), undefined);
  assert.equal(erlaubt.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
  assert.equal(verweigert.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
  assert.equal(unkonfiguriert.kopf["cache-control"], KEIN_ZWISCHENSPEICHER);
});

test("Paket 15: Antwort und Log enthalten weder Token noch Nummern noch Anruf-Kennungen", () => {
  const calls = anrufe(Date.now());
  const handler = handlerMit(RICHTIGES_TOKEN, calls);
  const verweigert = mitMitschnitt(() => aufrufen(handler, `Bearer ${FALSCHES_TOKEN}`));
  const erlaubt = mitMitschnitt(() => aufrufen(handler, `Bearer ${RICHTIGES_TOKEN}`));
  const text = JSON.stringify([verweigert, erlaubt]);
  const verboten = [RICHTIGES_TOKEN, FALSCHES_TOKEN, NUMMER_ANRUFER, NUMMER_ZIEL, ...calls.map(({ id }) => id)];
  assert.deepEqual(verboten.filter((wert) => text.includes(wert)), []);
  assert.equal(verweigert.zeilen.filter((zeile) => zeile.includes(AUTH_FEHLER_ZEILE)).length, 1);
  assert.match(verweigert.zeilen[0], /grund=deploy_token$/);
  assert.deepEqual(erlaubt.zeilen, []);
});
