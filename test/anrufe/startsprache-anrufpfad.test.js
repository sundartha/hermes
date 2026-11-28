import assert from "node:assert/strict";
import { test } from "node:test";

import { planProfileFor } from "../../src/plans.ts";
import { mcpPost, readToolResult, seedState, startIdp, startServer, toolCall } from "../helpers.js";
import { initInhaltFuer, vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "t_startsprache";
const SUB = "sub-startsprache";
const SENDER = "+4915110000092";
const PEER = "+4915112340092";
const ZIEL_OHNE_LANDESSPRACHE = "+819012345678";
const GESPEICHERT = "fr";
const VORSPANN_ENV = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_RESULT_POLL_MS: "150",
});

function seed() {
  return seedState({
    tenants: [{ id: TENANT, idpSubject: SUB, status: "active", ownerName: "Kunde", kycLevel: "card", defaultLanguage: GESPEICHERT }],
    profiles: { [TENANT]: planProfileFor("business") },
    numbers: [
      {
        id: `num_${TENANT}`,
        e164: SENDER,
        tenantId: TENANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: "phnum_h2t1_1",
      },
    ],
  });
}

async function mitServer(lauf) {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, MULTI_TENANT: "true", ...VORSPANN_ENV, ...vorspannMandantenUmgebung([TENANT]) },
    seed: seed(),
  });
  const toMcp = async (body) => readToolResult(await mcpPost(`${srv.localUrl}/mcp`, await idp.sign({ sub: SUB }), body));
  try {
    await lauf({ srv, toMcp });
  } finally {
    await srv.stop();
    await idp.close();
  }
}

async function anrufStarten({ srv, toMcp }, { sprache, ziel = PEER } = {}) {
  const eingabe = { to: ziel, objective: "Termin vereinbaren", ...(sprache === undefined ? {} : { language: sprache }) };
  const result = await toMcp(toolCall("place_call", eingabe));
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return initInhaltFuer(srv, { callId: result.structuredContent.call_id });
}

test("SA-1: place_call ohne language startet auf Deutsch, egal was fuer Mandant und Nummer gespeichert ist", async () => {
  await mitServer(async ({ srv, toMcp }) => {
    const inhalt = await anrufStarten({ srv, toMcp });
    assert.equal(inhalt.conversation_config_override.agent.language, "de");
    assert.match(inhalt.dynamic_variables.eroeffnung_gesagt, /KI-Assistent/);
  });
});

test("SA-3: ohne language und ohne Landessprache des Ziels sprechen Anbietersprache und Offenlegung Deutsch", async () => {
  await mitServer(async ({ srv, toMcp }) => {
    const inhalt = await anrufStarten({ srv, toMcp }, { ziel: ZIEL_OHNE_LANDESSPRACHE });
    assert.equal(inhalt.conversation_config_override.agent.language, "de");
    assert.match(inhalt.dynamic_variables.eroeffnung_gesagt, /KI-Assistent/);
  });
});

test("SA-2: place_call mit language es startet in der Anbietersprache es", async () => {
  await mitServer(async ({ srv, toMcp }) => {
    const inhalt = await anrufStarten({ srv, toMcp }, { sprache: "es" });
    assert.equal(inhalt.conversation_config_override.agent.language, "es");
    const { calls } = srv.readStore();
    assert.equal(calls.at(-1).language, "es");
  });
});
