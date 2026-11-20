import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import express from "express";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
process.env.IN_CALL_CONSULT_ENABLED = "true";

const { config } = await import("../../src/config.js");
const { KOSTENPROFIL } = await import("../../src/billing/kostenarten.js");
const { makeElevenLabsWebhookRoutes } = await import("../../src/routes/webhooks-elevenlabs.ts");
const { H7C2B4B2_WERKZEUG_TOKEN, H7C2B4B2_BINDUNGS_TOKEN } = await import("../gemeinsam/erfundene-geheimnisse.js");
const { abrufMitFrist } = await import("../gemeinsam/antwortfrist.mjs");
const { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore, nutzungAuffrischenVon } = await import("../pg-helpers.js");

const HTTP_OK = 200;
const KONVERSATION = "conv_5271_consult";
const ABSENDER = "+4930555000330";
const ZIEL = "+4915112349941";

config.voice.elevenLabsToolToken = H7C2B4B2_WERKZEUG_TOKEN;

function schreibtNachDerAktivenAbfrage(runner, schreibe) {
  const zustand = { aktiveGelesen: false, geschrieben: false };
  return {
    zustand,
    withClient: async (fn) => {
      if (zustand.aktiveGelesen && !zustand.geschrieben) {
        zustand.geschrieben = true;
        await schreibe();
      }
      return runner.withClient((client) =>
        fn({
          query: async (text, werte) => {
            const antwort = await client.query(text, werte);
            if (String(text).includes("status = 'active'")) zustand.aktiveGelesen = true;
            return antwort;
          },
        }),
      );
    },
  };
}

async function mitServer(router, lauf) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = http.createServer(app);
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  try {
    return await lauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((fertig) => server.close(fertig));
  }
}

test("5271-4: der Consult-Webhook antwortet 200, wenn der Anruf zwischen den beiden Abfragen als active geschrieben wird", async () => {
  const { runner } = await makePgTestStore();
  const hook = { schreibe: async () => {} };
  const huelle = schreibtNachDerAktivenAbfrage(runner, () => hook.schreibe());
  const a = makePgStore(huelle);
  await a.init();
  const call = a.createCall({
    direction: "outbound",
    from: ABSENDER,
    to: ZIEL,
    goal: "Test",
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: "telnyx",
  });
  Object.assign(call, {
    status: "active",
    elevenlabsConversationId: KONVERSATION,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: "2026-01-01T00:00:00.000Z",
    streamToken: H7C2B4B2_BINDUNGS_TOKEN,
  });
  await a.drainFlushes();
  await runner.withClient(async (client) => {
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    await client.query("DELETE FROM call WHERE id = $1", [call.id]);
  });
  Object.assign(huelle.zustand, { aktiveGelesen: false, geschrieben: false });
  hook.schreibe = async () => {
    await a.persistCall(call.id);
  };
  const gefragt = [];
  const store = Object.assign(Object.create(a), {
    resolveProfile: () => ({ allowConsult: true, allowLookup: true }),
    nutzungAuffrischen: (tenantId) => nutzungAuffrischenVon(a.load(), tenantId),
  });
  const router = makeElevenLabsWebhookRoutes({
    store,
    config,
    consultSlots: { withOpenSlot: async (_id, _mandant, run) => ({ granted: true, value: await run() }) },
    onConsultRaised: async (anfrage) => {
      gefragt.push(anfrage.callId);
      return { kind: "answered", facts: ["Ja, passt."] };
    },
    auditFor: () => () => {},
  });
  await mitServer(router, async (url) => {
    const antwort = await abrufMitFrist(`${url}/webhooks/elevenlabs/consult`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hermes-tool-token": H7C2B4B2_WERKZEUG_TOKEN },
      body: JSON.stringify({ conversation_id: KONVERSATION, question: "Passt Donnerstag?" }),
    });
    assert.equal(antwort.status, HTTP_OK);
    assert.equal((await antwort.json()).status, "answered");
  });
  assert.deepEqual(gefragt, [call.id]);
});
