import assert from "node:assert/strict";
import { test } from "node:test";

import { planProfileFor } from "../../src/plans.ts";
import {
  mcpPost,
  readToolResult,
  seedState,
  startIdp,
  startServer,
  toolCall,
  EL_OUTBOUND_BOOT_ENV,
} from "../helpers.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const TENANT = "t_sf_mcp";
const SUB = "sub-sf-mcp";
const SENDER = "+4915110000091";
const PEER = "+4915112340091";
const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

function seed() {
  return seedState({
    tenants: [{ id: TENANT, idpSubject: SUB, status: "active", ownerName: "Kunde", kycLevel: "card" }],
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
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      ...EL_OUTBOUND_BOOT_ENV,
      ...vorspannMandantenUmgebung([TENANT]),
    },
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

const languageText = async (toMcp) => {
  const { tools } = await toMcp(TOOLS_LIST);
  const { properties } = tools.find((tool) => tool.name === "place_call").inputSchema;
  return properties.language.description;
};

test("SM-1: der Werkzeugtext von language nennt keine Sprachliste und erlaubt jede Sprache", async () => {
  await mitServer(async ({ toMcp }) => {
    const text = await languageText(toMcp);
    assert.doesNotMatch(text, /one of:/);
    assert.doesNotMatch(text, /\bde, (en|fr)\b/);
    assert.doesNotMatch(text, /\ben\b.*\bfr\b/);
    assert.match(text, /any language code, e\.g\. es or pt-br\./);
    assert.match(text, /REJECTED/);
    assert.match(text, /switch/i);
    assert.match(text, /disclosure/i);
  });
});

test("SM-2: place_call mit language es ueber MCP wird angenommen und der Anruf traegt es", async () => {
  await mitServer(async ({ srv, toMcp }) => {
    const result = await toMcp(toolCall("place_call", { to: PEER, objective: "Termin vereinbaren", language: "es" }));
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.equal(result.structuredContent.status, "dialing");
    const { calls } = srv.readStore();
    assert.equal(calls.at(-1).language, "es");
  });
});
