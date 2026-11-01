import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STATUS_PATH,
  STATUS_TOKEN_MIN_LENGTH,
  makeInternStatusRoutes,
} from "../../src/routes/intern-status.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { mitRoutenServer } from "../anrufe/routen-server.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVICE_UNAVAILABLE = 503;
const SCHLUESSEL = "s".repeat(STATUS_TOKEN_MIN_LENGTH);
const DEPLOY_TOKEN = "d".repeat(STATUS_TOKEN_MIN_LENGTH);
const ZU_KURZ = "s".repeat(STATUS_TOKEN_MIN_LENGTH - 1);
const COMMIT = "b2c0ffee";
const KURZE_FRIST_MS = 5;
const FEHLERDETAIL = "verbindung_b2_geheim_kaputt";
const KEIN_ZWISCHENSPEICHER = "no-store";
const ABGELEHNT = Object.freeze({ error: "unauthorized" });

function konfiguration(statusToken = SCHLUESSEL) {
  return { auth: { statusToken, deployToken: DEPLOY_TOKEN }, server: { deployedCommit: COMMIT } };
}

function attrappenSpeicher({ verbindung = () => Promise.resolve() } = {}) {
  const attrappe = { probenAufrufe: 0 };
  attrappe.pruefeVerbindung = () => {
    attrappe.probenAufrufe += 1;
    return verbindung();
  };
  return attrappe;
}

function nieFertig() {
  return new Promise(() => {});
}

async function statusAbrufen(basis, authorization = `Bearer ${SCHLUESSEL}`) {
  const headers = authorization === null ? {} : { authorization };
  const antwort = await abrufMitFrist(`${basis}${STATUS_PATH}`, { headers });
  return {
    status: antwort.status,
    kopf: antwort.headers.get("cache-control"),
    text: await antwort.text(),
  };
}

function mitStatusroute({ store, config = konfiguration() }, aufruf) {
  return mitRoutenServer(
    makeInternStatusRoutes({ config, store, datenbankFristMs: KURZE_FRIST_MS }),
    aufruf,
  );
}

async function stumm(arbeit) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  try {
    return await arbeit();
  } finally {
    Object.assign(console, { log, warn, error });
  }
}

test("B2-1: gesund -> 200 mit datenbank und commit, no-store", async () => {
  const store = attrappenSpeicher();
  const antwort = await mitStatusroute({ store }, (basis) => statusAbrufen(basis));
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(antwort.kopf, KEIN_ZWISCHENSPEICHER);
  assert.deepEqual(JSON.parse(antwort.text), { datenbank: true, commit: COMMIT });
});

test("B2-2: Datenbank wirft, sofort oder asynchron -> 503, Antwort ohne Fehlertext", async () => {
  const wirfSofort = () => {
    throw new Error(FEHLERDETAIL);
  };
  const wirftSpaeter = () => Promise.reject(new Error(FEHLERDETAIL));
  for (const verbindung of [wirftSpaeter, wirfSofort]) {
    const store = attrappenSpeicher({ verbindung });
    const antwort = await mitStatusroute({ store }, (basis) => statusAbrufen(basis));
    assert.equal(antwort.status, HTTP_SERVICE_UNAVAILABLE);
    assert.equal(antwort.kopf, KEIN_ZWISCHENSPEICHER);
    assert.deepEqual(JSON.parse(antwort.text), { datenbank: false, commit: COMMIT });
    assert.equal(antwort.text.includes(FEHLERDETAIL), false);
  }
});

test("B2-3: Datenbank antwortet nicht in der Frist -> 503", async () => {
  const store = attrappenSpeicher({ verbindung: nieFertig });
  const antwort = await mitStatusroute({ store }, (basis) => statusAbrufen(basis));
  assert.equal(antwort.status, HTTP_SERVICE_UNAVAILABLE);
  assert.deepEqual(JSON.parse(antwort.text), { datenbank: false, commit: COMMIT });
});

test("B2-5: ohne Schluessel, falscher Schluessel oder Deploy-Token -> 401 konstant, Speicher nicht gefragt", async () => {
  const store = attrappenSpeicher();
  const faelle = [
    null,
    `Bearer ${"x".repeat(STATUS_TOKEN_MIN_LENGTH)}`,
    `Bearer ${DEPLOY_TOKEN}`,
    SCHLUESSEL,
  ];
  const antworten = await stumm(() =>
    mitStatusroute({ store }, (basis) =>
      Promise.all(faelle.map((fall) => statusAbrufen(basis, fall))),
    ),
  );
  for (const antwort of antworten) {
    assert.equal(antwort.status, HTTP_UNAUTHORIZED);
    assert.equal(antwort.kopf, KEIN_ZWISCHENSPEICHER);
    assert.deepEqual(JSON.parse(antwort.text), ABGELEHNT);
  }
  assert.equal(store.probenAufrufe, 0);
});

test("B2-6: Schluessel leer oder zu kurz -> jeder Aufruf 401", async () => {
  for (const statusToken of ["", ZU_KURZ, null]) {
    const store = attrappenSpeicher();
    const antwort = await stumm(() =>
      mitStatusroute({ store, config: konfiguration(statusToken) }, (basis) =>
        statusAbrufen(basis, `Bearer ${statusToken}`),
      ),
    );
    assert.equal(antwort.status, HTTP_UNAUTHORIZED);
    assert.deepEqual(JSON.parse(antwort.text), ABGELEHNT);
    assert.equal(store.probenAufrufe, 0);
  }
});

test("B2-7: haengende Datenbankprobe wird geteilt, nicht je Abruf neu gestartet", async () => {
  const store = attrappenSpeicher({ verbindung: nieFertig });
  const antworten = await mitStatusroute({ store }, async (basis) => [
    await statusAbrufen(basis),
    await statusAbrufen(basis),
    await statusAbrufen(basis),
  ]);
  assert.deepEqual(
    antworten.map(({ status }) => status),
    [HTTP_SERVICE_UNAVAILABLE, HTTP_SERVICE_UNAVAILABLE, HTTP_SERVICE_UNAVAILABLE],
  );
  assert.equal(store.probenAufrufe, 1);
});

test("B2-8: nach gescheiterter Probe startet der naechste Abruf eine neue", async () => {
  let versuch = 0;
  const store = attrappenSpeicher({
    verbindung: () => {
      versuch += 1;
      return versuch === 1 ? Promise.reject(new Error(FEHLERDETAIL)) : Promise.resolve();
    },
  });
  const antworten = await mitStatusroute({ store }, async (basis) => [
    await statusAbrufen(basis),
    await statusAbrufen(basis),
  ]);
  assert.deepEqual(
    antworten.map(({ status }) => status),
    [HTTP_SERVICE_UNAVAILABLE, HTTP_OK],
  );
  assert.equal(store.probenAufrufe, 2);
});
