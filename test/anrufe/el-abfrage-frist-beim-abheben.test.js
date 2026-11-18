import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import { tenantToolToken } from "../../src/elevenlabs/tenant-tool-token.ts";
import * as ops from "../../src/store/state-ops.js";
import { billThunk, terminateAndBillCall } from "../../src/telephony/call-termination.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { storeOpsFacade, withFetch } from "../helpers.js";

const HTTP_OK = 200;
const POLL_MS = 600000;
const REQUEST_TIMEOUT_MS = 120000;
const UEBERNAHME_MS = 30000;
const TOLERANZ_MS = 20000;
const CONV_ID = "conv_frist_beim_abheben";
const ZIEL = "+491701111111";
const GEHEIMNIS = "frist-beim-abheben-geheimnis";

const antwort = (daten) => new Response(JSON.stringify(daten), { status: HTTP_OK, headers: { "content-type": "application/json" } });

function anbieterFetch() {
  return async (url) => {
    if (String(url).includes("/v1/convai/conversations?")) return antwort({ conversations: [{ conversation_id: CONV_ID }], has_more: false });
    return antwort({
      conversation_initiation_client_data: {
        dynamic_variables: { callee: ZIEL, tenant_token: tenantToolToken({ secret: GEHEIMNIS, tenantId: BOOTSTRAP_TENANT_ID }) },
      },
    });
  };
}

test("Abfrage-Frist: beim Abheben nach unklarem Start traegt der Anruf die Frist schon vor dem ersten Abfrage-Takt", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, {
    direction: "outbound",
    from: "+491700000000",
    to: ZIEL,
    goal: "Termin vereinbaren",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.startedAt = new Date().toISOString();
  const fristen = [];
  const store = {
    ...storeOpsFacade(state),
    recordElevenlabsConversationId: (id, konversation) => ops.recordElevenlabsConversationId(state, id, konversation),
    markAnswered: async (id) => {
      ops.getCall(state, id).answeredAt = new Date().toISOString();
    },
    setzeAbfrageFrist: async (anfrage) => {
      fristen.push(anfrage);
    },
    anrufstartMarker: { lies: async () => new Date().toISOString() },
  };
  const config = withConfigNamespaces({
    elevenLabsToolToken: GEHEIMNIS,
    elevenLabsOutbound: { apiKey: "test-key", apiBase: "https://el.test", resultPollMs: POLL_MS, anrufstartWartefristMs: 0 },
  });
  const outbound = makeElevenLabsOutbound({ store, config, terminateAndBillCall, billThunk, finishCall: () => {} });
  const auftrag = outbound.macheAnrufstartAuftrag({
    starte: async () => {},
    sperren: { eingefroren: () => false, pausiert: () => false, abgebrochen: () => false },
    beendeOhneWahl: async () => {},
    armeTimer: () => {},
    jetztMs: () => Date.now(),
  });
  const vorher = Date.now();
  await withFetch(anbieterFetch(), () => auftrag({ payload: { callId: call.id } }));
  assert.equal(fristen.length, 1);
  assert.equal(fristen[0].callId, call.id);
  assert.equal(fristen[0].tenantId, BOOTSTRAP_TENANT_ID);
  const erwartet = vorher + REQUEST_TIMEOUT_MS + POLL_MS + UEBERNAHME_MS;
  assert.ok(Math.abs(Date.parse(fristen[0].faelligAt) - erwartet) < TOLERANZ_MS, fristen[0].faelligAt);
});
