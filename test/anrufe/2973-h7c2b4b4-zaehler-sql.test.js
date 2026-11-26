import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFE_LAUFEND_PATH, makeInternAnrufeLaufendRoutes } from "../../src/routes/intern-anrufe-laufend.js";
import { MAX_CALL_DURATION_CAP_S } from "../../src/begriffe/anrufe.ts";
import { classifyCallTime } from "../../src/store.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { H7C2B4B4_DEPLOY_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";
import { mitRoutenServer } from "./routen-server.js";

const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const ABSENDER = "+4930555000440";
const ZIEL = "+4915112349944";
const WEITERE_TEILE = { classifyCallTime, MAX_CALL_DURATION_CAP_S };

function mitAusfall(runner) {
  const schalter = { aus: false };
  return {
    schalter,
    runner: { withClient: (fn) => (schalter.aus ? Promise.reject(new Error("Datenbank weg")) : runner.withClient(fn)) },
  };
}

async function zweiInstanzen(runnerFuerB = (runner) => runner) {
  const { store: ersterStore, runner } = await makePgTestStore();
  const b = Object.assign(makePgStore(runnerFuerB(runner)), WEITERE_TEILE);
  await b.init();
  return { a: ersterStore, b };
}

async function legeAnrufAn(store, ueber = {}) {
  const call = store.createCall({
    direction: "outbound",
    from: ABSENDER,
    to: ZIEL,
    goal: "Test",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
  });
  Object.assign(call, { status: "active", startedAt: new Date().toISOString(), ...ueber });
  await store.persistCall(call.id);
  return call;
}

function zaehlerAbfragen(store) {
  const router = makeInternAnrufeLaufendRoutes({ config: { auth: { deployToken: H7C2B4B4_DEPLOY_TOKEN } }, store });
  return mitRoutenServer(router, async (basis) => {
    const antwort = await abrufMitFrist(`${basis}${ANRUFE_LAUFEND_PATH}`, {
      headers: { authorization: `Bearer ${H7C2B4B4_DEPLOY_TOKEN}` },
    });
    return { status: antwort.status, koerper: await antwort.json() };
  });
}

test("H7c2b4b4-1: B zählt über GET /intern/anrufe-laufend einen laufenden Anruf, den nur A angelegt hat", async () => {
  const { a, b } = await zweiInstanzen();
  await legeAnrufAn(a);
  const antwort = await zaehlerAbfragen(b);
  assert.equal(antwort.status, HTTP_OK);
  assert.deepEqual(antwort.koerper, { laufend: 1 });
});

test("H7c2b4b4-2: ein beendeter Anruf von A zählt auf B nicht", async () => {
  const { a, b } = await zweiInstanzen();
  await legeAnrufAn(a, { status: "completed", endedAt: new Date().toISOString() });
  const antwort = await zaehlerAbfragen(b);
  assert.equal(antwort.status, HTTP_OK);
  assert.deepEqual(antwort.koerper, { laufend: 0 });
});

test("H7c2b4b4-3: ist die Datenbank nicht lesbar, antwortet B mit 500 und nie mit laufend 0", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  let ausfall = null;
  const { a, b } = await zweiInstanzen((runner) => {
    ausfall = mitAusfall(runner);
    return ausfall.runner;
  });
  const call = await legeAnrufAn(a);
  ausfall.schalter.aus = true;
  const antwort = await zaehlerAbfragen(b);
  assert.equal(antwort.status, HTTP_SERVER_ERROR);
  assert.deepEqual(antwort.koerper, { error: "intern" });
  assert.equal(zeilen.filter((zeile) => zeile.startsWith("[anrufe-laufend] nicht lesbar: ")).length, 1);
  const text = JSON.stringify([antwort, zeilen]);
  const verboten = [call.id, ABSENDER, ZIEL, H7C2B4B4_DEPLOY_TOKEN];
  assert.deepEqual(verboten.filter((wert) => text.includes(wert)), []);
});
