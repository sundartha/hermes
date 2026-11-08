import assert from "node:assert/strict";
import { test } from "node:test";

import { planProfileFor } from "../../src/plans.js";
import {
  mcpPost,
  readRpcMessage,
  seedState,
  startIdp,
  startServer,
  toolCall,
} from "../helpers.js";

const TENANT = "t_pc_hinweis";
const SUB = "sub-pc-hinweis";
const SENDER = "+4915110000092";
const TARGET = "+4915112340098";

function seed() {
  return seedState({
    tenants: [
      { id: TENANT, idpSubject: SUB, status: "active", ownerName: "Kunde", kycLevel: "card" },
    ],
    profiles: { [TENANT]: planProfileFor("business") },
    numbers: [
      {
        id: `num_${TENANT}`,
        e164: SENDER,
        tenantId: TENANT,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
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
      FAKE_ORIGINATE: "true",
      MCP_UI_ENABLED: "true",
    },
    seed: seed(),
  });
  const token = await idp.sign({ sub: SUB });
  const rpc = async (body) => readRpcMessage(await mcpPost(`${srv.localUrl}/mcp`, token, body));
  try {
    await lauf({ srv, rpc });
  } finally {
    await srv.stop();
    await idp.close();
  }
}

test("H1 prepare_call liefert isError mit deutschem und englischem Hinweis auf place_call", async () => {
  await mitServer(async ({ srv, rpc }) => {
    const { result } = await rpc(toolCall("prepare_call", { to: TARGET, objective: "Termin" }));
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    const text = result.content[0].text;
    assert.match(text, /prepare_call/);
    assert.match(text, /place_call/);
    assert.match(text, /nicht mehr/);
    assert.match(text, /no longer exists/);
    assert.match(text, /neuen Chat/);
    assert.match(text, /new chat/);
    assert.equal(result.structuredContent, undefined);
    assert.equal(srv.readStore().calls.length, 0);
  });
});

test("H2 tools/list enthaelt prepare_call nicht", async () => {
  await mitServer(async ({ rpc }) => {
    const { result } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = result.tools.map((tool) => tool.name);
    assert.equal(names.includes("prepare_call"), false);
    assert.equal(names.includes("place_call"), true);
  });
});

test("H3 initialize meldet tools.listChanged", async () => {
  await mitServer(async ({ rpc }) => {
    const { result } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    assert.equal(result.capabilities.tools.listChanged, true);
  });
});
