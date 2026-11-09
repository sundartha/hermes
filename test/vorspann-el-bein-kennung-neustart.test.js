import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";
import { makeVorspannAblauf } from "../src/elevenlabs/vorspann-ablauf.js";
import { hangUpAction } from "../src/telephony/call-termination.js";
import { CALL_CONTROL_EREIGNIS } from "../src/telephony/call-control-ereignis.js";

const EL_KENNUNG = "cc_el_kennung-neustart";
const CALLEE_KENNUNG = "cc_callee_kennung-neustart";
const FRIST_MS = 3_600_000;
const SPALTE_ABFRAGE = "SELECT el_call_control_id FROM call WHERE id = $1";

const neuerAnruf = (store) =>
  store.createCall({ direction: "outbound", from: "+4915100000101", to: "+4915100000102", tenantId: BOOTSTRAP_TENANT_ID });

const neuLaden = async (store) => {
  await store.drainFlushes();
  await store.init();
};

const spaltenwert = async (db, callId) => (await db.query(SPALTE_ABFRAGE, [callId])).rows[0].el_call_control_id;

function telnyxAttrappe() {
  const aufgelegt = [];
  return {
    aufgelegt,
    dialCallControl: async ({ commandId }) => ({ callControlId: commandId.endsWith("-el") ? EL_KENNUNG : CALLEE_KENNUNG }),
    playbackStart: async () => {},
    endCallViaCallControl: async (bein) => {
      aufgelegt.push(bein);
    },
  };
}

function vorspannAblauf(store, steuerung) {
  return makeVorspannAblauf({
    voiceControl: () => steuerung,
    store,
    config: {
      telephony: { telnyxCallControlAppId: "app_kennung" },
      server: { publicUrl: "https://agent.test" },
      voice: { elevenLabsOutbound: { vorspannWiedergabeFristMs: FRIST_MS, bridgeStartDeadlineMs: FRIST_MS } },
    },
    ttsStore: { put: () => "token", release: () => {} },
    inboundBridges: new Map(),
    ausgehendGesperrt: async () => false,
    terminateAndBillCall: async () => {},
    awaitAndPersistInboundElResult: async () => {},
    billThunk: () => async () => {},
    finishCall: async () => {},
  });
}

test("EL-Bein-Kennung: ein Anruf mit EL-Bein-Kennung kommt nach Speichern und Neuladen mit derselben Kennung zurueck", async () => {
  const { store } = await makePgTestStore();
  const angelegt = neuerAnruf(store);
  store.getCall(angelegt.id).elCallControlId = EL_KENNUNG;
  await store.save();

  await neuLaden(store);

  assert.equal(store.getCall(angelegt.id).elCallControlId, EL_KENNUNG);
});

test("EL-Bein-Kennung: nach der Wahl des EL-Beins im Vorspann-Ablauf und einem Neustart legt die Beendigung beide Beine auf", async () => {
  const { store } = await makePgTestStore();
  const steuerung = telnyxAttrappe();
  const ablauf = vorspannAblauf(store, steuerung);
  const angelegt = neuerAnruf(store);
  const call = store.getCall(angelegt.id);
  const { callControlId } = await ablauf.waehle({ call, vorspann: { audio: Buffer.alloc(1), text: "Hallo" } });
  call.callControlId = callControlId;
  await store.save();

  await ablauf.behandle({
    call,
    ereignis: { ereignis: CALL_CONTROL_EREIGNIS.ABGEHOBEN, callControlId },
    zugang: { username: "benutzer", password: "kennwort" },
  });
  await neuLaden(store);

  const geladen = store.getCall(angelegt.id);
  assert.equal(geladen.elCallControlId, EL_KENNUNG);
  steuerung.aufgelegt.length = 0;
  await hangUpAction(() => steuerung, geladen)();
  assert.deepEqual([...steuerung.aufgelegt].sort(), [CALLEE_KENNUNG, EL_KENNUNG].sort());
});

test("EL-Bein-Kennung: ein Anruf ohne EL-Bein hat nach dem Neuladen null und eine leere Spalte", async () => {
  const { store, db } = await makePgTestStore();
  const angelegt = neuerAnruf(store);
  await store.save();

  await neuLaden(store);

  assert.equal(store.getCall(angelegt.id).elCallControlId, null);
  assert.equal(await spaltenwert(db, angelegt.id), null);
});

test("EL-Bein-Kennung: ein Speichern mit aelterem Stand ohne Kennung loescht die gespeicherte Kennung nicht", async () => {
  const { store, db } = await makePgTestStore();
  const angelegt = neuerAnruf(store);
  const call = store.getCall(angelegt.id);
  call.elCallControlId = EL_KENNUNG;
  await store.save();
  await store.drainFlushes();
  assert.equal(await spaltenwert(db, angelegt.id), EL_KENNUNG);

  delete call.elCallControlId;
  call.summary = "aelterer Stand speichert erneut";
  await store.save();
  await store.drainFlushes();

  assert.equal(await spaltenwert(db, angelegt.id), EL_KENNUNG);
});
