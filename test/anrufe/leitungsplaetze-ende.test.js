import assert from "node:assert/strict";
import test from "node:test";

import express from "express";
import { makeLeitungsplaetze } from "../../src/store.js";
import { makeCallRoutes } from "../../src/routes/api-calls.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { CONVERSATION_DONE_WITH_ANALYSIS, CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const AUFTRAG = "Tisch fuer zwei reservieren (Ende-Regeln)";
const EL_PLAETZE_NUTZBAR = 4;
const TELNYX_AUSGEHEND_GRENZE = 90;
const ANRUFE_PRO_KUNDE = 2;
const KUNDEN_TELNYX = TELNYX_AUSGEHEND_GRENZE / ANRUFE_PRO_KUNDE;
const KONVERSATION_PFAD = "/v1/convai/conversations/";

const kundeVon = (index) => `t_le_${index}`;
const absenderVon = (index) => `+1202555${String(2000 + index).padStart(4, "0")}`;
const zielVon = (nummer) => `+1202555${String(5000 + nummer).padStart(4, "0")}`;

function seedKunden(anzahl) {
  const indizes = Array.from({ length: anzahl }, (_, index) => index);
  return seedState({
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: "en",
    })),
    numbers: indizes.map((index) => ({
      id: `num_le_${index}`,
      e164: absenderVon(index),
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_le_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

async function rufeAn(srv, index, ziel) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: ziel, objective: AUFTRAG }),
  });
  return { status: res.status };
}

async function startePlaetze(srv, anzahl, kundeJeAnruf) {
  for (let nummer = 1; nummer <= anzahl; nummer += 1) {
    const antwort = await rufeAn(srv, kundeJeAnruf(nummer), zielVon(nummer));
    assert.equal(antwort.status, HTTP_OK, `Anruf ${nummer} muss angenommen werden`);
  }
}

function starteElAnbieter() {
  const fertig = new Set();
  let gestartet = 0;
  return starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      if (!req.url.startsWith(KONVERSATION_PFAD)) {
        gestartet += 1;
        return res.end(JSON.stringify({ success: true, conversation_id: `conv_le_${gestartet}`, sip_call_id: "sip_le" }));
      }
      const id = req.url.slice(KONVERSATION_PFAD.length);
      const vorlage = fertig.has(id) ? CONVERSATION_DONE_WITH_ANALYSIS : CONVERSATION_IN_PROGRESS;
      res.end(JSON.stringify({ ...vorlage, conversation_id: id }));
    });
  }).then((attrappe) => ({ ...attrappe, melde: (id) => fertig.add(id) }));
}

test("Ende: ein abgeholtes ElevenLabs-Ergebnis gibt den Platz frei, ein noch laufendes Gespraech nicht", async () => {
  const anbieter = await starteElAnbieter();
  const srv = await startServer({
    env: {
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_AGENT_ID: "agent_le",
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_le",
      ELEVENLABS_API_KEY: "el-le-schluessel",
      ELEVENLABS_RESULT_POLL_MS: "100",
      ELEVENLABS_API_BASE: anbieter.url,
    },
    seed: seedKunden(EL_PLAETZE_NUTZBAR + 1),
  });
  try {
    await startePlaetze(srv, EL_PLAETZE_NUTZBAR, (nummer) => nummer - 1);
    assert.equal((await rufeAn(srv, EL_PLAETZE_NUTZBAR, zielVon(900))).status, HTTP_UNAVAILABLE);
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= EL_PLAETZE_NUTZBAR);
    anbieter.melde(stand.calls[0].elevenlabsConversationId);
    await waitForStoreState(srv, (s) => s.calls[0].status === "completed" && Boolean(s.calls[0].billedAt));
    assert.equal((await rufeAn(srv, EL_PLAETZE_NUTZBAR, zielVon(901))).status, HTTP_OK);
    assert.equal((await rufeAn(srv, EL_PLAETZE_NUTZBAR, zielVon(902))).status, HTTP_UNAVAILABLE);
  } finally {
    await srv.stop();
    await anbieter.close();
  }
});

async function mitTelnyxAnbieter(lauf) {
  const srv = await startServer({ env: { FAKE_ORIGINATE: "true" }, seed: seedKunden(KUNDEN_TELNYX + 1) });
  try {
    await startePlaetze(srv, TELNYX_AUSGEHEND_GRENZE, (nummer) => Math.floor((nummer - 1) / ANRUFE_PRO_KUNDE));
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= TELNYX_AUSGEHEND_GRENZE);
    return await lauf({ srv, erster: stand.calls[0] });
  } finally {
    await srv.stop();
  }
}

async function brichAb(srv, anruf) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls/${anruf.id}/cancel`, {
    method: "POST",
    headers: { "X-Internal-Tenant": anruf.tenantId },
  });
  assert.equal(antwort.status, HTTP_OK);
  await waitForStoreState(srv, (s) => s.calls[0].status === "cancelled" && Boolean(s.calls[0].billedAt));
}

test("Ende: ein mit cancel_call beendeter Telnyx-Anruf gibt den Platz frei", async () => {
  await mitTelnyxAnbieter(async ({ srv, erster }) => {
    assert.equal((await rufeAn(srv, KUNDEN_TELNYX, zielVon(900))).status, HTTP_UNAVAILABLE);
    await brichAb(srv, erster);
    assert.equal((await rufeAn(srv, KUNDEN_TELNYX, zielVon(901))).status, HTTP_OK);
    assert.equal((await rufeAn(srv, KUNDEN_TELNYX, zielVon(902))).status, HTTP_UNAVAILABLE);
  });
});

const NUTZBARE_TELNYX_PLAETZE = 90;
const BUDGET_ALT = { PRECALL_BRIEFING_ENABLED: "false", ASSISTANT_CONTEXT_ENABLED: "false", IN_CALL_CONSULT_ENABLED: "false", CONSULT_ENABLED: "false", METRICS_ENABLED: "false" };

const routenConfig = withConfigNamespaces({
  outboundFrozen: false,
  assistantContextEnabled: false,
  paymentEnabled: false,
  platformSpendCapCents: 800,
  allowedCountryCodes: ["+49"],
  maxCallsPerHour: 100,
  perTargetWindowMs: 3600000,
  perTargetCallCap: 100,
  multiTenant: false,
  diagnosticRetentionDays: 0,
  ownerSelfCallEnabled: false,
  ownerSelfCallTenantIds: [],
  elevenLabsOutbound: { enabled: false },
  telnyxAssistant: { enabled: false },
  voiceEngine: "budget",
  publicUrl: "http://127.0.0.1:1",
});

const torFuerKunde = {
  name: "test",
  run(ctx) {
    Object.assign(ctx, { tenantId: "T", fromNumber: "+491700000000", outboundProvider: "telnyx", reserveCents: 0, maxDur: 60, requestedBy: "test" });
    return null;
  },
};

async function starteAbbruchRoute({ auflegenScheitert }) {
  Object.assign(process.env, BUDGET_ALT);
  const { store } = await makePgTestStore();
  const leitungsplaetze = makeLeitungsplaetze();
  const voiceControl = () => ({
    originateCall: async () => ({ sid: "sid_ende" }),
    endCall: async () => {
      if (auflegenScheitert) throw new Error("Anbieter lehnt Auflegen ab");
    },
  });
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      leitungsplaetze,
      config: routenConfig,
      audit: () => {},
      outboundGates: [torFuerKunde],
      callQuotaDenial: () => null,
      voiceControl,
      originateElevenLabsCall: async () => {},
      terminateAndBillCall: async ({ hangUp, onHangUpError }) => {
        try {
          await hangUp?.();
        } catch (fehler) {
          onHangUpError(fehler);
        }
      },
      hangUpAction: (steuerung, anruf, kennung) => (kennung ? () => steuerung(anruf.provider).endCall(kennung) : null),
      billThunk: () => () => {},
      finishCall: () => {},
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => "T", requireTenant: () => "T", tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/calls`;
  const post = (to) =>
    abrufMitFrist(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, objective: AUFTRAG, max_duration_s: 60 }),
    });
  return { leitungsplaetze, post, abbrechen: (id) => abrufMitFrist(`${url}/${id}/cancel`, { method: "POST" }), stop: () => new Promise((r) => server.close(r)) };
}

async function mitAbbruchRoute(auflegenScheitert, lauf) {
  const route = await starteAbbruchRoute({ auflegenScheitert });
  try {
    for (let index = 1; index < NUTZBARE_TELNYX_PLAETZE; index += 1)
      await route.leitungsplaetze.belegenAusgehend({ callId: `vorbelegt_${index}`, tenantId: "x", weg: "telnyx", maxDauerS: 100000 });
    const erster = await route.post("+491711234501");
    assert.equal(erster.status, HTTP_OK);
    await lauf({ route, anrufId: (await erster.json()).callId });
  } finally {
    await route.stop();
  }
}

test("Ende: scheitert das Auflegen nach cancel_call beim Anbieter, bleibt der Platz bis zum Ablauf belegt", async () => {
  await mitAbbruchRoute(true, async ({ route, anrufId }) => {
    assert.equal((await route.abbrechen(anrufId)).status, HTTP_OK);
    assert.equal((await route.post("+491711234502")).status, HTTP_UNAVAILABLE);
  });
});

test("Ende: nimmt der Anbieter das Auflegen nach cancel_call an, ist der Platz sofort frei", async () => {
  await mitAbbruchRoute(false, async ({ route, anrufId }) => {
    assert.equal((await route.abbrechen(anrufId)).status, HTTP_OK);
    assert.equal((await route.post("+491711234502")).status, HTTP_OK);
  });
});
