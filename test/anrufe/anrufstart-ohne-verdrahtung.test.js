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

async function wahlOhneAnrufstart() {
  const zeilen = [];
  const original = console.error;
  console.error = (...teile) => zeilen.push(teile.join(" "));
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      ...vorspannDiAttrappe(),
      erzeugeVorspann: undefined,
      store: { ...speicher, numberRecordByE164: () => ({ providerAgentPhoneNumberId: "phnum_verdrahtung" }) },
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
    await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "+491711234567", objective: "Termin vereinbaren" }),
    });
  } finally {
    console.error = original;
    await new Promise((resolve) => server.close(resolve));
  }
  return zeilen;
}

test("Ausgehend: ohne verdrahteten Anrufstart nennt die Fehlerzeile genau diesen Grund", async () => {
  const zeilen = await wahlOhneAnrufstart();
  const zeile = zeilen.find((text) => text.startsWith("[place_call] originate fehlgeschlagen call=call_"));
  assert.ok(zeile, zeilen.join("\n"));
  assert.ok(
    zeile.endsWith(": Der Anrufstart ist nicht verdrahtet (deps.erzeugeVorspann fehlt)"),
    zeile,
  );
});
