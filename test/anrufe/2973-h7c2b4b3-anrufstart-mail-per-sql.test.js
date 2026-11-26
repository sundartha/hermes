import assert from "node:assert/strict";
import { test } from "node:test";

import { makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import * as speicher from "../../src/store.js";
import { BOOTSTRAP_TENANT_ID, legeMandantAn, makePgStore, makePgTestStore } from "../pg-helpers.js";

const FREMD = "t_h7c2b4b3_fremd";
const KONVERSATION = "conv_h7c2b4b3";
const ANDERE_KONVERSATION = "conv_h7c2b4b3_andere";
const ABSENDER = "+4930555000430";
const ZIEL = "+4915112349943";
const MANDANTEN_TOKEN = "token-h7c2b4b3";
const MS_JE_SEKUNDE = 1000;
const FEST_MS = Date.parse("2026-11-19T10:00:00.500Z");
const MARKER_VOR_MS = 600 * MS_JE_SEKUNDE;

async function zweiInstanzen() {
  const { store: b, runner } = await makePgTestStore();
  const a = makePgStore(runner);
  await a.init();
  await legeMandantAn(b, FREMD);
  return { a, b, runner };
}

function mitAusfall(runner) {
  const schalter = { aus: false };
  return {
    schalter,
    runner: { withClient: (fn) => (schalter.aus ? Promise.reject(new Error("Datenbank weg")) : runner.withClient(fn)) },
  };
}

async function legeAnrufAn(store, { tenantId = BOOTSTRAP_TENANT_ID, ueber = {} }) {
  const call = store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId, provider: "telnyx" });
  Object.assign(call, ueber);
  await store.persistCall(call.id);
  return call;
}

const gespraech = { conversation_initiation_client_data: { dynamic_variables: { callee: ZIEL, tenant_token: MANDANTEN_TOKEN } } };

async function startAuftrag({ b, runner, doppelStore = b, kennungen = [KONVERSATION] }) {
  const call = await legeAnrufAn(b, {});
  const marker = speicher.makePostgresAnrufstartMarker(runner);
  await marker.setze({ callId: call.id, tenantId: call.tenantId, jetztIso: new Date(FEST_MS - MARKER_VOR_MS).toISOString() });
  const spur = { festgehalten: [], beendet: [], gestartet: [], geholt: [] };
  const auftrag = makeAnrufstartAuftrag({
    store: {
      leseCall: (id) => b.leseCall(id),
      anderesAnrufMitKonversation: (id, kennung) => doppelStore.anderesAnrufMitKonversation(id, kennung),
      anrufstartMarker: marker,
    },
    starte: async (angelegt) => {
      spur.gestartet.push(angelegt.id);
    },
    anbieterGespraeche: {
      liste: async () => ({ conversations: kennungen.map((id) => ({ conversation_id: id })), has_more: false }),
      hole: async (id) => {
        spur.geholt.push(id);
        return gespraech;
      },
    },
    haltAnrufStartFest: (angelegt, id) => spur.festgehalten.push([angelegt.id, id]),
    beendeStartUnklar: async (id) => {
      spur.beendet.push(id);
    },
    sperren: { eingefroren: () => false, pausiert: () => false, abgebrochen: () => false },
    beendeOhneWahl: async () => {},
    armeTimer: () => {},
    mandantenToken: () => MANDANTEN_TOKEN,
    jetztMs: () => FEST_MS,
  });
  return { call, spur, laufe: () => auftrag({ payload: { callId: call.id } }) };
}

test("H7c2b4b3-1: Ein Gespraech, das A schon an einen anderen Anruf desselben Mandanten gebunden hat, gilt auf B als belegt, es wird nicht zweimal gebunden", async () => {
  const { a, b, runner } = await zweiInstanzen();
  const { call, spur, laufe } = await startAuftrag({ b, runner });
  await legeAnrufAn(a, { ueber: { elevenlabsConversationId: KONVERSATION } });
  assert.equal(await laufe(), "unklar");
  assert.deepEqual(spur.festgehalten, []);
  assert.deepEqual(spur.beendet, [call.id]);
  assert.deepEqual(spur.geholt, []);
});

test("H7c2b4b3-2: Ein Gespraech, das A an einen Anruf eines anderen Mandanten gebunden hat, gilt auf B ebenfalls als belegt", async () => {
  const { a, b, runner } = await zweiInstanzen();
  const { spur, laufe } = await startAuftrag({ b, runner });
  await legeAnrufAn(a, { tenantId: FREMD, ueber: { elevenlabsConversationId: KONVERSATION } });
  assert.equal(await laufe(), "unklar");
  assert.deepEqual(spur.festgehalten, []);
});

test("H7c2b4b3-3: Ein freies Gespraech und das Gespraech des eigenen Anrufs gelten nicht als belegt und werden festgehalten", async () => {
  const { a, b, runner } = await zweiInstanzen();
  const frei = await startAuftrag({ b, runner });
  assert.equal(await frei.laufe(), "abgeglichen");
  assert.deepEqual(frei.spur.festgehalten, [[frei.call.id, KONVERSATION]]);
  const gebunden = await legeAnrufAn(a, { ueber: { elevenlabsConversationId: KONVERSATION } });
  assert.equal(await b.anderesAnrufMitKonversation(gebunden.id, KONVERSATION), false);
  assert.equal(await b.anderesAnrufMitKonversation(frei.call.id, KONVERSATION), true);
  const nurHier = b.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  nurHier.elevenlabsConversationId = ANDERE_KONVERSATION;
  assert.equal(await b.anderesAnrufMitKonversation(nurHier.id, ANDERE_KONVERSATION), false);
  assert.equal(await b.anderesAnrufMitKonversation(gebunden.id, ANDERE_KONVERSATION), true);
});

test("H7c2b4b3-4: Ein Anruf nur im eigenen Spiegel von B mit demselben Gespraech gilt als belegt", async () => {
  const { b, runner } = await zweiInstanzen();
  const { spur, laufe } = await startAuftrag({ b, runner });
  const nurHier = b.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  nurHier.elevenlabsConversationId = KONVERSATION;
  assert.equal(await laufe(), "unklar");
  assert.deepEqual(spur.festgehalten, []);
});

test("H7c2b4b3-5: Ist die Datenbank bei der Doppel-Pruefung nicht lesbar, gilt das Gespraech als belegt: keine zweite Bindung, nichts wird gestartet", async (t) => {
  t.mock.method(console, "error", () => {});
  const { b, runner } = await zweiInstanzen();
  const ausfall = mitAusfall(runner);
  const bAus = makePgStore(ausfall.runner);
  await bAus.init();
  const { call, spur, laufe } = await startAuftrag({ b, runner, doppelStore: bAus });
  ausfall.schalter.aus = true;
  assert.equal(await laufe(), "unklar");
  assert.deepEqual(spur.festgehalten, []);
  assert.deepEqual(spur.gestartet, []);
  assert.deepEqual(spur.geholt, []);
  assert.deepEqual(spur.beendet, [call.id]);
});

test("H7c2b4b3-8: Anrufe des Mandanten kommen aus der Datenbank, auch von A, ohne die eines anderen Mandanten", async () => {
  const { a, b } = await zweiInstanzen();
  const eigenA = await legeAnrufAn(a, {});
  const gespeichert = await legeAnrufAn(b, {});
  await legeAnrufAn(a, { tenantId: FREMD });
  const nurHier = b.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  b.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: FREMD, provider: "telnyx" });
  const ids = (await b.anrufeDesMandanten(BOOTSTRAP_TENANT_ID)).map((call) => call.id);
  assert.deepEqual(ids.toSorted(), [eigenA.id, gespeichert.id, nurHier.id].toSorted());
});
