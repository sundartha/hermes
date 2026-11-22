import assert from "node:assert/strict";
import { test } from "node:test";

import { makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import * as speicher from "../../src/store.js";
import { BOOTSTRAP_TENANT_ID, legeMandantAn, makePgStore, makePgTestStore } from "../pg-helpers.js";

const MANDANTEN = ["t_5433_a", "t_5433_b"];
const ABSENDER = "+4930555000433";
const ZIEL = "+4915112345433";
const MANDANTEN_TOKEN = "token-5433";
const FEST_MS = Date.parse("2026-11-19T10:00:00.500Z");
const MARKER_VOR_MS = 600000;
const ANZAHL = 50;
const MANDANTEN_GESAMT = MANDANTEN.length + 1;
const KENNUNGEN = Array.from({ length: ANZAHL }, (_wert, nr) => `conv_5433_${nr}`);

const gespraech = { conversation_initiation_client_data: { dynamic_variables: { callee: ZIEL, tenant_token: MANDANTEN_TOKEN } } };

function zaehlend(runner, schalter) {
  const zaehler = { verbindungen: 0, abfragen: 0 };
  return {
    zaehler,
    runner: {
      ...runner,
      withClient: (arbeit) => {
        if (schalter?.aus) return Promise.reject(new Error("Datenbank weg"));
        zaehler.verbindungen += 1;
        return runner.withClient((client) =>
          arbeit({
            query: (...args) => {
              zaehler.abfragen += 1;
              return client.query(...args);
            },
          }),
        );
      },
    },
  };
}

async function legeAnrufAn(store, tenantId, kennung) {
  const call = store.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId, provider: "telnyx" });
  if (kennung) call.elevenlabsConversationId = kennung;
  await store.persistCall(call.id);
  return call;
}

async function aufbau(schalter) {
  const { store: b, runner } = await makePgTestStore();
  for (const id of MANDANTEN) await legeMandantAn(b, id);
  const messend = zaehlend(runner, schalter);
  const leser = makePgStore(messend.runner);
  await leser.init();
  const call = await legeAnrufAn(b, BOOTSTRAP_TENANT_ID);
  const marker = speicher.makePostgresAnrufstartMarker(runner);
  await marker.setze({ callId: call.id, tenantId: call.tenantId, jetztIso: new Date(FEST_MS - MARKER_VOR_MS).toISOString() });
  const spur = { festgehalten: [], beendet: [], gestartet: [], geholt: [] };
  const auftrag = makeAnrufstartAuftrag({
    store: {
      leseCall: (id) => b.leseCall(id),
      anderesAnrufMitKonversation: (id, kennung) => leser.anderesAnrufMitKonversation(id, kennung),
      anrufstartMarker: marker,
    },
    starte: async (angelegt) => {
      spur.gestartet.push(angelegt.id);
    },
    anbieterGespraeche: {
      liste: async () => ({ conversations: KENNUNGEN.map((id) => ({ conversation_id: id })), has_more: false }),
      hole: async (id) => {
        spur.geholt.push(id);
        return id === KENNUNGEN[0] ? gespraech : null;
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
  return { b, call, spur, zaehler: messend.zaehler, leser, laufe: () => auftrag({ payload: { callId: call.id } }) };
}

test("5433-a: 50 Kennungen bei 3 Mandanten brauchen eine Verbindung und hoechstens 7 Abfragen", async () => {
  const { spur, zaehler, laufe } = await aufbau();
  zaehler.verbindungen = 0;
  zaehler.abfragen = 0;
  assert.equal(await laufe(), "abgeglichen");
  assert.equal(zaehler.verbindungen, 1);
  assert.ok(zaehler.abfragen <= 1 + 2 * MANDANTEN_GESAMT, `Abfragen: ${zaehler.abfragen}`);
  assert.equal(spur.geholt.length, ANZAHL);
});

test("5433-b: Eine Kennung, die ein Anruf eines anderen Mandanten fuehrt, gilt als belegt, die uebrigen werden abgefragt", async () => {
  const { b, spur, laufe } = await aufbau();
  await legeAnrufAn(b, MANDANTEN[1], KENNUNGEN[7]);
  await laufe();
  assert.equal(spur.geholt.includes(KENNUNGEN[7]), false);
  assert.deepEqual(spur.geholt.toSorted(), KENNUNGEN.filter((id) => id !== KENNUNGEN[7]).toSorted());
});

test("5433-c: Ein Lesefehler macht alle Kennungen belegt: nichts wird abgefragt oder gebunden", async (t) => {
  t.mock.method(console, "error", () => {});
  const schalter = { aus: false };
  const { call, spur, laufe } = await aufbau(schalter);
  schalter.aus = true;
  assert.equal(await laufe(), "unklar");
  assert.deepEqual(spur.geholt, []);
  assert.deepEqual(spur.festgehalten, []);
  assert.deepEqual(spur.beendet, [call.id]);
});

test("5433-d: Die Kennung des eigenen Anrufs gilt nicht als belegt, die eines anderen schon", async () => {
  const { b, call, leser } = await aufbau();
  const eigener = await legeAnrufAn(b, MANDANTEN[0], KENNUNGEN[1]);
  assert.equal(await leser.anderesAnrufMitKonversation(eigener.id, KENNUNGEN[1]), false);
  assert.equal(await leser.anderesAnrufMitKonversation(call.id, KENNUNGEN[1]), true);
  assert.equal(await leser.anderesAnrufMitKonversation(call.id, KENNUNGEN[2]), false);
});
