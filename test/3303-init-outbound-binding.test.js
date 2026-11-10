import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../src/elevenlabs/inbound-sip-uri.js";
import { ELEVENLABS_INIT_PATH, INIT_ANTWORT, INIT_TOKEN_HEADER } from "../src/routes/webhooks-elevenlabs-init.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, seedCall, startServer } from "./helpers.js";
import { INBOUND_FROM, INBOUND_TO, elInboundInitSpawnEnv, spawnSeedWartenderElCall } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const AGENT_ID = "agent_3303";
const TOOL_TOKEN = "el-tool-token-3303";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const OWNER_NAME = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;
const ABSENDER = "+15005550006";
const ANGERUFENER = "+491737250000";
const OBJECTIVE = "Termin vereinbaren";
const PLATZHALTER_ZEILE = "Ich rufe an wegen {{x}}.";
const PLATZHALTER_HASH = createHash("sha256").update(PLATZHALTER_ZEILE, "utf8").digest("hex");
const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";
const DISCLOSURE_DE = `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${OWNER_NAME}.`;
const OWNER_OPENING_DE = `Hallo ${OWNER_TEST_FIRST_NAME}, hier ist dein KI-Assistent.`;
const TOKEN_BREITE = 32;
const DYNAMIC_VARIABLES_KEYS = "background callee callee_relation callee_timezone constraints consult_available eroeffnung inbound_situation lookup_available mandate objective opening_line owner_name owner_timezone tenant_token today voicemail_line".split(" ");
const CONSULT_ENV = { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true", IN_CALL_CONSULT_ENABLED: "true", EL_CONSULT_ANSWER_MS: "1500" };

const bindungsToken = (nummer) => String(nummer).padStart(TOKEN_BREITE, "0");
const ausgehenderAnruf = (nummer, extra = {}) =>
  seedCall({
    id: `call_3303_${nummer}`,
    direction: "outbound",
    from: ABSENDER,
    to: ANGERUFENER,
    goal: OBJECTIVE,
    answeredAt: new Date().toISOString(),
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    streamToken: bindungsToken(nummer),
    ...extra,
  });

const seedMitInbound = (outboundCalls) => {
  const inbound = spawnSeedWartenderElCall({ callId: "call_3303_inbound", bindungsToken: bindungsToken(0), answeredVorS: 2 });
  return { ...inbound, calls: [...inbound.calls, ...outboundCalls] };
};

const postJson = ({ srv, path, headers, body }) =>
  abrufMitFrist(`${srv.localUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

let konversation = 0;
async function init(srv, call, extra = {}) {
  konversation += 1;
  const conversationId = `conv_3303_${konversation}`;
  const sipHeaders = { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken };
  const body = { agent_id: AGENT_ID, conversation_id: conversationId, called_number: call.from, sip_headers: sipHeaders, ...extra };
  const antwort = await postJson({ srv, path: ELEVENLABS_INIT_PATH, headers: { [INIT_TOKEN_HEADER]: INIT_TOKEN }, body });
  const text = await antwort.text();
  return { status: antwort.status, text, json: text ? JSON.parse(text) : null, conversationId };
}

const eroeffnungVon = ({ json }) => json.conversation_config_override.agent.first_message;

const CALLS = {
  gleicheSprache: ausgehenderAnruf(1),
  andereSprache: ausgehenderAnruf(2, { language: "en" }),
  eigenerAnruf: ausgehenderAnruf(3, { calleeIsOwner: true }),
  verletzend: ausgehenderAnruf(4, { language: "en", openingLine: PLATZHALTER_ZEILE, openingLineSha256: PLATZHALTER_HASH }),
  ohneNummer: ausgehenderAnruf(5),
  zielnummer: ausgehenderAnruf(6),
  fremdeNummer: ausgehenderAnruf(7),
  formatiert: ausgehenderAnruf(8),
  konformerZwilling: ausgehenderAnruf(9, { language: "en" }),
  consult: ausgehenderAnruf(10),
};

test("3303-Init-Outbound-Binding am echten Server", async (ctx) => {
  const srv = await startServer({
    env: { ...CONSULT_ENV, ...elInboundInitSpawnEnv(AGENT_ID), ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN },
    seed: seedMitInbound(Object.values(CALLS)),
  });
  try {
    await ctx.test("K2c(i): gleiche Sprache -> alle Variablen des Anrufstarts, inbound_situation leer, kein first_message", async () => {
      const antwort = await init(srv, CALLS.gleicheSprache);
      assert.equal(antwort.status, HTTP_OK, antwort.text);
      const { type, dynamic_variables: variablen, conversation_config_override: override } = antwort.json;
      assert.equal(type, "conversation_initiation_client_data");
      assert.deepEqual(Object.keys(variablen).sort(), DYNAMIC_VARIABLES_KEYS);
      assert.equal(variablen.inbound_situation, "");
      assert.equal(variablen.objective, OBJECTIVE);
      assert.equal(variablen.callee, ANGERUFENER);
      assert.equal(variablen.owner_name, OWNER_NAME);
      assert.ok(variablen.tenant_token);
      assert.equal(override.agent.language, "de");
      assert.equal(override.agent.first_message, undefined);
    });
    await ctx.test("K2c(ii): andere Sprache -> first_message beginnt mit dem Pflichtsatz der Offenlegungssprache", async () => {
      const antwort = await init(srv, CALLS.andereSprache);
      assert.equal(antwort.status, HTTP_OK, antwort.text);
      assert.ok(eroeffnungVon(antwort).startsWith(DISCLOSURE_DE), eroeffnungVon(antwort));
    });
    await ctx.test("K2c(iii): calleeIsOwner -> Owner-Eroeffnung", async () => {
      const antwort = await init(srv, CALLS.eigenerAnruf);
      assert.equal(antwort.status, HTTP_OK, antwort.text);
      assert.ok(eroeffnungVon(antwort).startsWith(OWNER_OPENING_DE), eroeffnungVon(antwort));
    });
    await ctx.test("K2d: Offenlegungspruefung verletzt -> 500 intern ohne Eroeffnung und ohne Bindung (Zwilling K2c(ii) -> 200)", async () => {
      const antwort = await init(srv, CALLS.verletzend);
      assert.equal(antwort.status, HTTP_SERVER_ERROR);
      assert.equal(antwort.text, JSON.stringify(INIT_ANTWORT.INTERN));
      assert.ok(!srv.stdout.includes(`gebunden call=${CALLS.verletzend.id}`));
      const zwilling = await init(srv, CALLS.konformerZwilling);
      assert.equal(zwilling.status, HTTP_OK, zwilling.text);
      assert.ok(eroeffnungVon(zwilling).startsWith(DISCLOSURE_DE));
    });
    await ctx.test("K8: Outbound nur mit called_number = call.from; Inbound unveraendert", async () => {
      for (const [call, extra] of [
        [CALLS.ohneNummer, { called_number: undefined }],
        [CALLS.zielnummer, { called_number: ANGERUFENER }],
        [CALLS.fremdeNummer, { called_number: "+491709999999" }],
      ]) {
        const antwort = await init(srv, call, extra);
        assert.equal(antwort.status, HTTP_NOT_FOUND, JSON.stringify(extra));
        assert.equal(antwort.text, JSON.stringify(INIT_ANTWORT.KEIN_ANRUF));
      }
      const formatiert = await init(srv, CALLS.formatiert, { called_number: "+1 500-555-0006" });
      assert.equal(formatiert.status, HTTP_OK, formatiert.text);

      const inbound = { id: "call_3303_inbound", from: INBOUND_FROM, to: INBOUND_TO, streamToken: bindungsToken(0) };
      assert.equal((await init(srv, inbound, { called_number: inbound.from })).status, HTTP_NOT_FOUND);
      const inboundOhne = await init(srv, inbound, { called_number: undefined });
      assert.equal(inboundOhne.status, HTTP_OK, inboundOhne.text);
    });
    await ctx.test("K9: tenant_token der Init-Antwort wird am Consult-Webhook angenommen, ein falsches abgelehnt", async () => {
      const antwort = await init(srv, CALLS.consult);
      assert.equal(antwort.status, HTTP_OK, antwort.text);
      const headers = { "x-hermes-tool-token": TOOL_TOKEN };
      const consult = (tenantToken) =>
        postJson({ srv, path: "/webhooks/elevenlabs/consult", headers, body: { conversation_id: antwort.conversationId, question: QUESTION, tenant_token: tenantToken } });
      const angenommen = await consult(antwort.json.dynamic_variables.tenant_token);
      assert.ok(angenommen.ok, `2xx erwartet, war ${angenommen.status}`);
      assert.equal((await consult("falsches-tenant-token")).status, HTTP_NOT_FOUND);
    });
  } finally {
    await srv.stop();
  }
});
