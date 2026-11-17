import assert from "node:assert/strict";
import { test } from "node:test";

import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import * as ops from "../../src/store/state-ops.js";
import { terminateAndBillCall } from "../../src/telephony/call-termination.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { CONVERSATION_FAILED_UNVERIFIED_ORIGINATION } from "../fixtures/elevenlabs-conversations.js";
import { storeOpsFacade, waitUntil, withFetch } from "../helpers.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const MANDANT = "t_abfrage_schreiben";
const HTTP_OK = 200;
const FRIST_MS = 120_000 + 30_000;
const EVENTS_SCHREIBEN = "frist-geschrieben";
const FEHLER_ZEILE = "[fristen] Abfrage-Frist schreiben fehlgeschlagen:";

function aufbau({ schreiben, mitSchreiber = true } = {}) {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, { direction: "outbound", from: "+491700000000", to: "+491701111111", goal: "Termin", tenantId: MANDANT });
  call.elevenlabsConversationId = CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.conversation_id;
  const anker = new Date(Date.now() - 5000).toISOString();
  call.startedAt = anker;
  call.answeredAt = anker;
  const ereignisse = [];
  const store = storeOpsFacade(state);
  if (mitSchreiber)
    store.setzeAbfrageFrist = async (frist) => {
      ereignisse.push({ art: "frist-beginn", frist, jetzt: Date.now() });
      await schreiben?.(frist);
      ereignisse.push({ art: EVENTS_SCHREIBEN });
    };
  let abgerechnet = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: ACCOUNT }),
    terminateAndBillCall,
    billThunk: () => () => {
      abgerechnet = true;
    },
    finishCall: () => {},
  });
  const fetchImpl = async (_url, init) => {
    ereignisse.push({ art: init.method });
    return init.method === "GET"
      ? { ok: true, status: HTTP_OK, json: async () => CONVERSATION_FAILED_UNVERIFIED_ORIGINATION }
      : { ok: true, status: HTTP_OK };
  };
  return { call, el, ereignisse, fetchImpl, abgerechnet: () => abgerechnet };
}

const arten = (ereignisse) => ereignisse.map((ereignis) => ereignis.art);

test("Abfrage schreibt vor jedem Abruf die Frist: Anruf und Mandant der Zeile, jetzt plus Abruf-Frist plus Uebernahmezeit, und der Abruf wartet darauf", async () => {
  const geoeffnet = Promise.withResolvers();
  const { call, el, ereignisse, fetchImpl, abgerechnet } = aufbau({ schreiben: () => geoeffnet.promise });
  const vor = Date.now();
  await withFetch(fetchImpl, async () => {
    el.rearmActiveConversationPolls();
    await waitUntil(() => arten(ereignisse).includes("frist-beginn"));
    await new Promise((erfuellen) => setImmediate(erfuellen));
    assert.deepEqual(arten(ereignisse), ["frist-beginn"]);
    geoeffnet.resolve();
    await waitUntil(abgerechnet);
  });
  const nach = Date.now();
  assert.deepEqual(arten(ereignisse).slice(0, 3), ["frist-beginn", EVENTS_SCHREIBEN, "GET"]);
  const { frist } = ereignisse[0];
  assert.equal(frist.callId, call.id);
  assert.equal(frist.tenantId, MANDANT);
  const faellig = Date.parse(frist.faelligAt);
  assert.ok(faellig >= vor + FRIST_MS && faellig <= nach + FRIST_MS, frist.faelligAt);
});

test("Abfrage schreiben scheitert: der Fehler steht im Log und der Abruf laeuft trotzdem", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { call, el, ereignisse, fetchImpl, abgerechnet } = aufbau({
    schreiben: async () => {
      throw new Error("schreiben verweigert");
    },
  });
  await withFetch(fetchImpl, async () => {
    el.rearmActiveConversationPolls();
    await waitUntil(abgerechnet);
  });
  assert.ok(arten(ereignisse).includes("GET"));
  assert.ok(zeilen.includes(`${FEHLER_ZEILE} ${call.id} Error: schreiben verweigert`), zeilen.join("\n"));
});

test("Abfrage ohne schreibenden Speicher: der Abruf laeuft, der Fehler steht im Log", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { call, el, ereignisse, fetchImpl, abgerechnet } = aufbau({ mitSchreiber: false });
  await withFetch(fetchImpl, async () => {
    el.rearmActiveConversationPolls();
    await waitUntil(abgerechnet);
  });
  assert.ok(arten(ereignisse).includes("GET"));
  assert.ok(zeilen.some((zeile) => zeile.startsWith(`${FEHLER_ZEILE} ${call.id} `)), zeilen.join("\n"));
});

test("Abfrage ohne Frist-Schreiben bei beendetem Anruf: nichts wird geschrieben und nichts abgerufen", async () => {
  const { call, el, ereignisse, fetchImpl } = aufbau();
  call.status = "completed";
  await withFetch(fetchImpl, async () => {
    await el.abfrageDurchLauf(call.id);
    await new Promise((erfuellen) => setImmediate(erfuellen));
  });
  assert.deepEqual(ereignisse, []);
});

test("Abfrage durch den Lauf: ein Anruf mit Gespraech startet genau eine Kette (Frist, Abruf, Abrechnung), ein Anruf ohne Gespraech und ein unbekannter nicht", async () => {
  const { call, el, ereignisse, fetchImpl, abgerechnet } = aufbau();
  await withFetch(fetchImpl, async () => {
    await el.abfrageDurchLauf("call_unbekannt");
    call.elevenlabsConversationId = null;
    await el.abfrageDurchLauf(call.id);
    assert.deepEqual(ereignisse, []);
    call.elevenlabsConversationId = CONVERSATION_FAILED_UNVERIFIED_ORIGINATION.conversation_id;
    await el.abfrageDurchLauf(call.id);
    await waitUntil(abgerechnet);
  });
  assert.deepEqual(arten(ereignisse).filter((art) => art === "GET"), ["GET"]);
});

test("Abfrage durch den Lauf: laeuft in diesem Prozess schon eine Kette fuer den Anruf, startet der Lauf keine zweite", async () => {
  const haengt = Promise.withResolvers();
  const { call, el, ereignisse, fetchImpl, abgerechnet } = aufbau({ schreiben: () => haengt.promise });
  await withFetch(fetchImpl, async () => {
    el.rearmActiveConversationPolls();
    await waitUntil(() => arten(ereignisse).includes("frist-beginn"));
    await el.abfrageDurchLauf(call.id);
    await new Promise((erfuellen) => setImmediate(erfuellen));
    assert.deepEqual(arten(ereignisse), ["frist-beginn"]);
    haengt.resolve();
    await waitUntil(abgerechnet);
  });
  assert.equal(arten(ereignisse).filter((art) => art === "GET").length, 1);
  assert.equal(arten(ereignisse).filter((art) => art === "frist-beginn").length, 1);
});

test("Abfrage durch den Lauf: nach dem Ende der Kette darf der Lauf den Anruf wieder abfragen", async () => {
  const { call, el, ereignisse, fetchImpl, abgerechnet } = aufbau();
  await withFetch(fetchImpl, async () => {
    el.rearmActiveConversationPolls();
    await waitUntil(abgerechnet);
    call.status = "active";
    await el.abfrageDurchLauf(call.id);
    await waitUntil(() => arten(ereignisse).filter((art) => art === "frist-beginn").length === 2);
    call.status = "completed";
  });
});
