import assert from "node:assert/strict";
import { test } from "node:test";

import express from "express";
import { startServer } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeLeitungsplaetze } from "../../src/store.js";
import { makeCallRoutes } from "../../src/routes/api-calls.ts";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { initInhaltFuer, vorspannDiAttrappe, vorspannSeedNummer } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const TENANT = "T";
const ABSENDER = "+491700000000";
const ZIEL = "+491711234567";
const LANG = 32;
const SCHALTER_AN = {
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
};
const OFFENLEGUNG = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel. Das Gespräch wird für meinen Auftraggeber zusammengefasst.";
const WEG_SPUR = "/v2/calls";
const SPRACHSYNTHESE_SPUR = "/v1/text-to-speech/";

const anrufBody = () => JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren", language: "en" });
const post = (url) =>
  abrufMitFrist(`${url}/api/calls`, { method: "POST", headers: { "content-type": "application/json" }, body: anrufBody() });

test("Fahrzeug Server: mit allen drei Schaltern waehlt POST /api/calls ueber die Attrappe und der Anruf hat eine callControlId", async () => {
  const srv = await startServer({ env: SCHALTER_AN });
  try {
    const antwort = await post(srv.localUrl);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    const call = srv.readStore().calls.find((eintrag) => eintrag.id === callId);
    assert.equal(call.callControlId, `cc_callee_${callId}`);
    assert.ok(srv.vorspannAttrappe.pfade.includes(WEG_SPUR), "gewaehlt ueber den Call-Control-Pfad");
    assert.ok(srv.vorspannAttrappe.pfade.some((pfad) => pfad.startsWith(SPRACHSYNTHESE_SPUR)), "Vorspann synthetisiert");
  } finally {
    await srv.stop();
  }
});

test("Fahrzeug Routen: makeCallRoutes mit der Vorspann-Attrappe waehlt nur ueber die Attrappe und speichert die callControlId", async () => {
  const attrappe = vorspannDiAttrappe();
  const { store } = await makePgTestStore();
  await legeMandantAn(store, TENANT);
  store.load().numbers.push(vorspannSeedNummer({ tenantId: TENANT, nummer: ABSENDER }));
  const versuche = [];
  const app = express();
  app.use(express.json());
  app.use(
    makeCallRoutes({
      store,
      leitungsplaetze: makeLeitungsplaetze(),
      config: withConfigNamespaces({
        outboundFrozen: false,
        assistantContextEnabled: false,
        paymentEnabled: false,
        multiTenant: false,
        diagnosticRetentionDays: 0,
        ownerSelfCallEnabled: false,
        ownerSelfCallTenantIds: [],
        elevenLabsOutbound: { enabled: true, ueberTelnyx: true, vorspann: true },
        elevenLabsInbound: {
          scope: "allowlist",
          tenantIds: [TENANT],
          sipUser: "fahrzeug-sip",
          sipPassword: "p".repeat(LANG),
          initWebhookToken: "t".repeat(LANG),
        },
        telnyxCallControlAppId: "cc-app-fahrzeug",
        telnyxElevenLabs: { voiceId: "" },
        telnyxAssistant: { enabled: false },
        voiceEngine: "budget",
        publicUrl: "http://127.0.0.1:1",
      }),
      audit: () => {},
      outboundGates: [
        {
          name: "freie-fahrt",
          run: (ctx) => {
            Object.assign(ctx, { tenantId: TENANT, context: {}, outboundProvider: "telnyx", fromNumber: ABSENDER, requestedBy: "test", maxDur: 60, reserveCents: 0 });
            return null;
          },
        },
      ],
      callQuotaDenial: () => null,
      voiceControl: () => ({ originateCall: async () => versuche.push("telnyx") }),
      originateElevenLabsCall: async () => versuche.push("elevenlabs"),
      ...attrappe,
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
    const antwort = await post(`http://127.0.0.1:${server.address().port}`);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    assert.deepEqual(attrappe.gewaehlt, [callId]);
    const { calls } = store.load();
    assert.equal(calls.find((eintrag) => eintrag.id === callId).callControlId, `cc_callee_${callId}`);
    assert.deepEqual(versuche, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Fahrzeug Init: initInhaltFuer liefert fuer einen Vorspann-Anruf first_message leer und eroeffnung_gesagt beginnt mit dem Offenlegungssatz", async () => {
  const srv = await startServer({ env: SCHALTER_AN });
  try {
    const antwort = await post(srv.localUrl);
    const { callId } = await antwort.json();
    const inhalt = await initInhaltFuer(srv, { callId });
    assert.equal(inhalt.conversation_config_override.agent.first_message, "");
    assert.ok(inhalt.dynamic_variables.eroeffnung_gesagt.startsWith(OFFENLEGUNG), inhalt.dynamic_variables.eroeffnung_gesagt);
  } finally {
    await srv.stop();
  }
});
