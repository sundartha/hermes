import assert from "node:assert/strict";
import { test } from "node:test";

import { planProfileFor } from "../../src/plans.ts";
import {
  mcpPost,
  readRpcMessage,
  seedState,
  startIdp,
  startServer,
  toolCall,
} from "../helpers.js";

const KYC_CARD = "card";
const TENANT = "t_pc_paid";
const SUB = "sub-pc-paid";
const SENDER = "+4915110000091";
const TARGET = "+4915112340097";
const OBJECTIVE = "Termin vereinbaren";
const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

function seed() {
  return seedState({
    tenants: [
      { id: TENANT, idpSubject: SUB, status: "active", ownerName: "Kunde", kycLevel: KYC_CARD },
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

test("W1 tools/list enthaelt kein prepare_call, place_call bleibt", async () => {
  await mitServer(async ({ rpc }) => {
    const { result } = await rpc(TOOLS_LIST);
    const names = result.tools.map((tool) => tool.name);
    assert.equal(names.includes("prepare_call"), false);
    assert.equal(names.includes("place_call"), true);
  });
});

test("W2 tools/call prepare_call scheitert als unbekanntes Werkzeug und startet keinen Anruf", async () => {
  await mitServer(async ({ srv, rpc }) => {
    const message = await rpc(
      toolCall("prepare_call", { to: TARGET, objective: OBJECTIVE }),
    );
    const failed = Boolean(message.error) || message.result?.isError === true;
    assert.equal(failed, true, JSON.stringify(message));
    assert.match(JSON.stringify(message), /prepare_call/);
    assert.equal(message.result?.structuredContent, undefined);
    assert.equal(srv.readStore().calls.length, 0);
  });
});
