import assert from "node:assert/strict";
import { before, test } from "node:test";

import express from "express";
import { schalteNebenkanaeleAb, seedState, tempDataDir } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT = "T";
const HTTP_SERVICE_UNAVAILABLE = 503;
const RESERVE_CENTS = 60;

let makeCallRoutes;
let speicher;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  speicher = await import("../../src/store.js");
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.js"));
});

const config = () =>
  withConfigNamespaces({
    outboundFrozen: false,
    assistantContextEnabled: false,
    paymentEnabled: false,
    multiTenant: false,
    diagnosticRetentionDays: 0,
    ownerSelfCallEnabled: false,
    ownerSelfCallTenantIds: [],
    elevenLabsOutbound: { enabled: false },
    telnyxAssistant: { enabled: false },
    voiceEngine: "budget",
    publicUrl: "http://127.0.0.1:1",
  });

const freieGates = [
  {
    name: "freie-fahrt",
    run: (ctx) => {
      Object.assign(ctx, {
        tenantId: TENANT,
        context: {},
        outboundProvider: "telnyx",
        fromNumber: "+491700000000",
        requestedBy: "test",
        maxDur: 60,
        reserveCents: RESERVE_CENTS,
      });
      return null;
    },
  },
];

test("Scheitert das Anlegen des Anrufs, gibt POST /api/calls die Datenbank-Reserve dieses Anrufs und Mandanten frei", async () => {
  const cfg = config();
  const freigaben = [];
  const wahlversuche = [];
  const budgetReservierung = {
    reservieren: async () => ({ reserviert: true }),
    freigeben: async (angabe) => {
      freigaben.push(angabe);
    },
  };
  const store = {
    ...speicher,
    createCall: () => {
      throw new Error("Anruf nicht anlegbar");
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      leitungsplaetze: speicher.makeLeitungsplaetze(),
      budgetReservierung,
      config: cfg,
      audit: () => {},
      outboundGates: freieGates,
      voiceControl: () => ({ originateCall: async () => wahlversuche.push("telnyx") }),
      originateElevenLabsCall: async () => wahlversuche.push("elevenlabs"),
      terminateAndBillCall: async () => {},
      hangUpAction: () => null,
      billThunk: () => () => {},
      finishCall: () => {},
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
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "+491711234567", objective: "Termin vereinbaren" }),
    });
    assert.equal(res.status, HTTP_SERVICE_UNAVAILABLE);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.deepEqual(wahlversuche, []);
  assert.equal(freigaben.length, 1);
  assert.equal(freigaben[0].tenantId, TENANT);
  assert.match(freigaben[0].callId, /^call_/);
});
