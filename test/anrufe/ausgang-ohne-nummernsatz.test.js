import assert from "node:assert/strict";
import { before, test } from "node:test";

import express from "express";
import { schalteNebenkanaeleAb, seedState, tempDataDir } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannDiAttrappe } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "T";
const RESERVE_CENTS = 60;

let makeCallRoutes;
let speicher;

before(async () => {
  schalteNebenkanaeleAb();
  process.env.DATA_DIR = tempDataDir(seedState({}));
  speicher = await import("../../src/store.js");
  ({ makeCallRoutes } = await import("../../src/routes/api-calls.ts"));
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

async function wahlOhneNummernsatz(schalter = { ueberTelnyx: true, vorspann: true }) {
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...vorspannDiAttrappe(),
      erzeugeVorspann: undefined,
      store: { ...speicher, numberRecordByE164: () => undefined },
      leitungsplaetze: speicher.makeLeitungsplaetze(),
      budgetReservierung: { reservieren: async () => ({ reserviert: true }), freigeben: async () => {} },
      config: withConfigNamespaces({
        outboundFrozen: false,
        paymentEnabled: false,
        multiTenant: false,
        diagnosticRetentionDays: 0,
        ownerSelfCallEnabled: false,
        ownerSelfCallTenantIds: [],
        publicUrl: "http://127.0.0.1:1",
        telnyxElevenLabs: { voiceId: "" },
        elevenLabsOutbound: schalter,
        telnyxCallControlAppId: "cc_app_verdrahtung",
        elevenLabsInbound: {
          scope: "allowlist",
          tenantIds: [TENANT],
          sipUser: "sip-user-verdrahtung",
          sipPassword: "p".repeat(40),
          initWebhookToken: "t".repeat(40),
        },
      }),
      audit: () => {},
      outboundGates: freieGates,
      callQuotaDenial: async () => null,
      voiceControl: () => ({}),
      terminateAndBillCall: async ({ persistEnd }) => {
        await persistEnd();
      },
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
    const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "+491711234567", objective: "Termin vereinbaren" }),
    });
    return { status: antwort.status, koerper: await antwort.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Ausgehend: ohne Nummernsatz zur Absendernummer bricht der Anruf mit 409 keine_eigene_registrierung ab", async () => {
  const ergebnis = await wahlOhneNummernsatz();
  assert.equal(ergebnis.status, 409);
  assert.equal(ergebnis.koerper.grund, "keine_eigene_registrierung");
});
