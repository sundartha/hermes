import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { H7C2B4B2_BINDUNGS_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";

const ABSENDER = "+4930555000630";
const ZIEL = "+4915112349630";
const KONVERSATION = "conv_6303_erste";
const JETZT_ISO = new Date("2026-01-01T00:00:00.000Z").toISOString();

async function zeileLesen(runner, callId) {
  return runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    const { rows } = await client.query("SELECT elevenlabs_conversation_id, el_bound_at FROM call WHERE id = $1", [callId]);
    return {
      konversation: rows[0].elevenlabs_conversation_id,
      gebunden: rows[0].el_bound_at ? rows[0].el_bound_at.toISOString() : null,
    };
  });
}

async function wartenderAnruf() {
  const { store: erste, runner } = await makePgTestStore();
  const call = erste.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  Object.assign(call, {
    elevenlabsConversationId: null,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: JETZT_ISO,
    streamToken: H7C2B4B2_BINDUNGS_TOKEN,
  });
  await erste.persistCall(call.id);
  return { runner, callId: call.id };
}

function runnerMitGehaltenerBestaetigung(runner) {
  let halten = false;
  let freigeben = () => {};
  const tor = new Promise((fertig) => {
    freigeben = fertig;
  });
  return {
    runner: {
      withClient: async (arbeit) => {
        if (!halten) return runner.withClient(arbeit);
        halten = false;
        const ergebnis = await runner.withClient(arbeit);
        await tor;
        return ergebnis;
      },
    },
    haltenAb: () => {
      halten = true;
    },
    freigeben: () => freigeben(),
  };
}

test("Ein Flush zwischen dem Schreiben und der Bestaetigung der Konversation setzt die Spalte nicht auf leer zurueck", async () => {
  const { runner, callId } = await wartenderAnruf();
  const gebremst = runnerMitGehaltenerBestaetigung(runner);
  const store = makePgStore(gebremst.runner);
  await store.init();
  assert.ok(store.getCall(callId) ?? (await store.attachActiveCall(callId)));
  gebremst.haltenAb();
  const bindung = store.bindInboundElConversation(callId, { conversationId: KONVERSATION, nowIso: JETZT_ISO });
  store.save();
  await store.drainFlushes();
  gebremst.freigeben();
  assert.equal(await bindung.dauerhaft, true);
  await store.drainFlushes();
  assert.deepEqual(await zeileLesen(runner, callId), { konversation: KONVERSATION, gebunden: JETZT_ISO });
});

test("Eine im Speicher gesetzte Konversation kommt beim naechsten Flush in die leere Spalte", async () => {
  const { runner, callId } = await wartenderAnruf();
  const store = makePgStore(runner);
  await store.init();
  assert.ok(store.getCall(callId) ?? (await store.attachActiveCall(callId)));
  store.recordElevenlabsConversationId(callId, KONVERSATION);
  await store.drainFlushes();
  assert.equal((await zeileLesen(runner, callId)).konversation, KONVERSATION);
});

test("Ein Flush mit veraltetem Spiegel ersetzt eine gebundene Konversation und ihre Bindungszeit in der Datenbank nicht", async () => {
  const { runner, callId } = await wartenderAnruf();
  const veraltet = makePgStore(runner);
  await veraltet.init();
  assert.ok(veraltet.getCall(callId) ?? (await veraltet.attachActiveCall(callId)));
  const bindende = makePgStore(runner);
  await bindende.init();
  assert.ok(bindende.getCall(callId) ?? (await bindende.attachActiveCall(callId)));
  assert.equal(await bindende.bindInboundElConversation(callId, { conversationId: KONVERSATION, nowIso: JETZT_ISO }).dauerhaft, true);
  veraltet.recordElevenlabsConversationId(callId, "conv_6303_fremde");
  await veraltet.drainFlushes();
  assert.deepEqual(await zeileLesen(runner, callId), { konversation: KONVERSATION, gebunden: JETZT_ISO });
});
