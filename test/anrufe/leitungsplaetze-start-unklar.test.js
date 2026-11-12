import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeLeitungsplaetze } from "../../src/store.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeCallRoutes } from "../../src/routes/api-calls.js";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { terminateAndBillCall, billThunk } from "../../src/telephony/call-termination.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_UNAVAILABLE = 503;
const TENANT = "T";
const HOECHSTDAUER_S = 60;
const START_MS = 1_800_000_000_000;
const LANGE_DAUER_S = 100000;
const NUTZABLE_TELNYX_PLAETZE = 90;
const ZIEL_ERSTER = "+491711234501";
const ZIEL_ZWEITER = "+491711234502";

const config = withConfigNamespaces({
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

function anbieterFehler(providerStatus) {
  const fehler = new Error("Anbieter-Attrappe");
  if (typeof providerStatus === "object") fehler.cause = providerStatus;
  else if (providerStatus) fehler.providerStatus = providerStatus;
  return fehler;
}

async function starteRoute(leitungsplaetze, providerStatus) {
  const { store } = await makePgTestStore();
  const callIds = [];
  const { finishCall } = makeCallFinish({
    store,
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: async () => null,
    planSummarySms: () => ({ send: false, reason: null }),
    audit: () => {},
    metrics: { logCallCapacity: () => {} },
    leitungsplaetze,
  });
  const outboundGates = [
    {
      name: "test",
      run(ctx) {
        Object.assign(ctx, {
          tenantId: TENANT,
          fromNumber: "+491700000000",
          outboundProvider: "telnyx",
          reserveCents: 0,
          maxDur: HOECHSTDAUER_S,
          requestedBy: "test",
        });
        return null;
      },
    },
  ];
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      leitungsplaetze,
      config,
      audit: () => {},
      outboundGates,
      callQuotaDenial: () => null,
      voiceControl: () => ({
        originateCall: async ({ url }) => {
          callIds.push(new URL(url).searchParams.get("callId"));
          throw anbieterFehler(providerStatus);
        },
      }),
      originateElevenLabsCall: async () => {},
      terminateAndBillCall,
      hangUpAction: () => null,
      billThunk,
      finishCall,
      arm: { armMaxDurationTimer: () => {}, armReserveReleaseTimer: () => {} },
      tenant: { requestTenant: () => TENANT, requireTenant: () => TENANT, tenantOwnsCall: () => true },
      consultDelivery: { waitForEvent: async () => ({}) },
      internalIdentity: () => null,
      OWNER_ID: "owner",
    }),
  );
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/calls`;
  const post = async (to) => {
    const res = await abrufMitFrist(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, objective: "Termin vereinbaren", max_duration_s: HOECHSTDAUER_S }),
    });
    return res.status;
  };
  return { post, store, callIds, stop: () => new Promise((resolve) => server.close(resolve)) };
}

async function fuelleBisAufLetztenPlatz(leitungsplaetze) {
  for (let index = 1; index < NUTZABLE_TELNYX_PLAETZE; index += 1) {
    await leitungsplaetze.belegenAusgehend({ callId: `vorbelegt_${index}`, weg: "telnyx", maxDauerS: LANGE_DAUER_S });
  }
}

function umgebung() {
  process.env.PRECALL_BRIEFING_ENABLED = "false";
  process.env.ASSISTANT_CONTEXT_ENABLED = "false";
  process.env.IN_CALL_CONSULT_ENABLED = "false";
  process.env.CONSULT_ENABLED = "false";
  process.env.METRICS_ENABLED = "false";
}

const FAELLE = [
  { name: "5xx", status: 500, antwort: 502, grund: "result-unknown:start-500", frei: false },
  { name: "keine Antwort (Zeitueberschreitung)", status: undefined, antwort: 500, grund: "result-unknown:start-no-status", frei: false },
  { name: "Verbindung abgelehnt", status: { code: "ECONNREFUSED" }, antwort: 500, grund: "not-placed:start-refused", frei: true },
  { name: "Name nicht aufloesbar", status: { code: "ENOTFOUND" }, antwort: 500, grund: "not-placed:start-refused", frei: true },
  { name: "gesperrter Port", status: { message: "bad port" }, antwort: 500, grund: "not-placed:start-refused", frei: true },
  { name: "Verbindung zurueckgesetzt", status: { code: "ECONNRESET" }, antwort: 500, grund: "result-unknown:start-no-status", frei: false },
  { name: "anderer Ursachentext", status: { message: "bad port number" }, antwort: 500, grund: "result-unknown:start-no-status", frei: false },
  { name: "400", status: 400, antwort: 502, grund: "not-placed:start-400", frei: true },
  { name: "422", status: 422, antwort: 502, grund: "not-placed:start-422", frei: true },
  { name: "429", status: 429, antwort: 502, grund: "at-capacity:start-429", frei: true },
];

for (const fall of FAELLE) {
  test(`Start-Fehler ${fall.name}: Platz ${fall.frei ? "sofort frei" : "bleibt belegt"}, Antwort ${fall.antwort}`, async () => {
    umgebung();
    const leitungsplaetze = makeLeitungsplaetze({ jetztMs: () => START_MS });
    const srv = await starteRoute(leitungsplaetze, fall.status);
    try {
      await fuelleBisAufLetztenPlatz(leitungsplaetze);
      const erster = await srv.post(ZIEL_ERSTER);
      assert.equal(erster, fall.antwort, "Antwort an den Kunden");
      const gescheitert = srv.store.getCall(srv.callIds[0]);
      assert.equal(gescheitert.status, "failed");
      assert.equal(gescheitert.failureReason, fall.grund);
      const zweiter = await srv.post(ZIEL_ZWEITER);
      assert.equal(zweiter, fall.frei ? fall.antwort : HTTP_UNAVAILABLE);
    } finally {
      await srv.stop();
    }
  });
}
