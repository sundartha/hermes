import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { tenantToolToken } from "../src/elevenlabs/tenant-tool-token.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { seedCall, seedState, startServer, waitForLog } from "./helpers.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const LOOKUP_PATH = "/webhooks/elevenlabs/lookup";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "iel-b6-werkzeug-geheim";
const SPAWN_MAX_DAUER_S = 600;

const INBOUND_CALL_ID = "call_b6_inbound";
const INBOUND_CONV_ID = "conv_b6_inbound";
const OUTBOUND_CALL_ID = "call_b6_outbound";
const OUTBOUND_CONV_ID = "conv_b6_outbound";
const QUESTION = "Darf ich den Termin zusagen?";
const QUERY = "opening hours of the town hall";

const WERKZEUG_ENV = Object.freeze({
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  LOOKUP_ENABLED: "true",
  EXA_API_KEY: "exa-test-key",
});

const OUTBOUND_TENANT_TOKEN = tenantToolToken({ secret: TOOL_TOKEN, tenantId: BOOTSTRAP_TENANT_ID });

function werkzeugSeed() {
  const jetzt = new Date().toISOString();
  const aktiv = { status: "active", maxDurationS: SPAWN_MAX_DAUER_S, answeredAt: jetzt, startedAt: jetzt };
  return seedState({
    settings: { allowSummaries: false },
    calls: [
      seedCall({
        ...aktiv,
        id: INBOUND_CALL_ID,
        direction: "inbound",
        provider: "telnyx",
        costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
        elevenlabsConversationId: INBOUND_CONV_ID,
        elBoundAt: jetzt,
      }),
      seedCall({ ...aktiv, id: OUTBOUND_CALL_ID, elevenlabsConversationId: OUTBOUND_CONV_ID }),
    ],
    profiles: { [BOOTSTRAP_TENANT_ID]: { allowLookup: true, allowConsult: true, maxCallsPerHour: null } },
  });
}

async function mitWerkzeugServer(tenantTokenRequired, run) {
  const srv = await startServer({
    env: { ...WERKZEUG_ENV, ELEVENLABS_TENANT_TOKEN_REQUIRED: String(tenantTokenRequired) },
    seed: werkzeugSeed(),
  });
  try {
    await run(srv);
  } finally {
    await srv.stop();
  }
}

const werkzeugAufruf = (srv, pfad, body) =>
  fetch(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/json", [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
    body: JSON.stringify(body),
  });

async function assertInboundGesperrt(srv, logGrund) {
  const consult = await werkzeugAufruf(srv, CONSULT_PATH, { conversation_id: INBOUND_CONV_ID, question: QUESTION, tenant_token: "" });
  const lookup = await werkzeugAufruf(srv, LOOKUP_PATH, { conversation_id: INBOUND_CONV_ID, query: QUERY, tenant_token: "" });
  assert.equal(consult.status, HTTP_NOT_FOUND);
  assert.equal(lookup.status, HTTP_NOT_FOUND);
  await waitForLog(srv, new RegExp(`\\[el-consult\\] abgelehnt grund=${logGrund} call=${INBOUND_CALL_ID}`));
  await waitForLog(srv, new RegExp(`\\[el-lookup\\] abgelehnt grund=${logGrund} call=${INBOUND_CALL_ID}`));
}

async function assertOutboundErreichtNutzlast(srv) {
  const consult = await werkzeugAufruf(srv, CONSULT_PATH, { conversation_id: OUTBOUND_CONV_ID, tenant_token: OUTBOUND_TENANT_TOKEN });
  const lookup = await werkzeugAufruf(srv, LOOKUP_PATH, { conversation_id: OUTBOUND_CONV_ID, tenant_token: OUTBOUND_TENANT_TOKEN });
  assert.equal(consult.status, HTTP_BAD_REQUEST);
  assert.deepEqual(await consult.json(), { error: "keine_frage" });
  assert.equal(lookup.status, HTTP_BAD_REQUEST);
  assert.deepEqual(await lookup.json(), { error: "keine_anfrage" });
}

test("IEL-B6-30: scharfer Schalter - Inbound mit tenant_token \"\" -> 404 an Stufe 2 (mandant_fehlt); Positiv-Kontrolle 400", async () => {
  await mitWerkzeugServer(true, async (srv) => {
    await assertInboundGesperrt(srv, "mandant_fehlt");
    await assertOutboundErreichtNutzlast(srv);
  });
});

test("IEL-B6-31: Uebergangs-Schalter - Inbound mit tenant_token \"\" -> 404 an der Richtung (kanal_nicht_freigegeben); Positiv-Kontrolle 400", async () => {
  await mitWerkzeugServer(false, async (srv) => {
    await assertInboundGesperrt(srv, "kanal_nicht_freigegeben");
    await assertOutboundErreichtNutzlast(srv);
  });
});
