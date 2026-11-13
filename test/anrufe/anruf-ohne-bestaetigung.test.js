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
  waitForLog,
} from "../helpers.js";

const KYC_CARD = "card";
const TENANT_PAID = "t_ob_paid";
const TENANT_FREE = "t_ob_free";
const TENANT_CAPPED = "t_ob_capped";
const SUB_PAID = "sub-ob-paid";
const SUB_FREE = "sub-ob-free";
const SUB_CAPPED = "sub-ob-capped";
const OWN_NUMBER = "+4915110000077";
const OTHER_NUMBER = "+4915112340097";
const THIRD_NUMBER = "+4915112340098";
const OBJECTIVE = "Termin vereinbaren";
const CARD_NUMBER = "4111 1111 1111 1111";
const HOURLY_LIMIT = "1";
const ZERO_CENTS = 0;
const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

const customer = (id, idpSubject, kycLevel) => ({
  id,
  idpSubject,
  status: "active",
  ownerName: `${id} Kunde`,
  ...(kycLevel ? { kycLevel } : {}),
});

const numberOf = (tenantId, e164) => ({
  id: `num_${tenantId}`,
  e164,
  tenantId,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
});

const SENDERS = {
  [TENANT_PAID]: "+4915110000081",
  [TENANT_FREE]: "+4915110000082",
  [TENANT_CAPPED]: "+4915110000083",
};

function seed() {
  const state = seedState({
    tenants: [
      customer(TENANT_PAID, SUB_PAID, KYC_CARD),
      customer(TENANT_FREE, SUB_FREE),
      customer(TENANT_CAPPED, SUB_CAPPED, KYC_CARD),
    ],
    profiles: {
      [TENANT_PAID]: planProfileFor("business"),
      [TENANT_FREE]: planProfileFor("business"),
      [TENANT_CAPPED]: planProfileFor("business"),
    },
    numbers: Object.entries(SENDERS).map(([tenantId, e164]) => numberOf(tenantId, e164)),
  });
  return {
    ...state,
    tenantBudgets: [
      { tenantId: TENANT_CAPPED, budgetCents: ZERO_CENTS, hardCapCents: ZERO_CENTS },
    ],
  };
}

async function mitServer(env, lauf) {
  const idp = await startIdp();
  const srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      FAKE_ORIGINATE: "true",
      MCP_UI_ENABLED: "true",
      ...env,
    },
    seed: seed(),
  });
  const toMcp = (token, body) => mcpPost(`${srv.localUrl}/mcp`, token, body);
  const werkzeug = async (sub, name, args) =>
    readToolResult(await toMcp(await idp.sign({ sub }), toolCall(name, args)));
  const anzahl = () => srv.readStore().calls.length;
  try {
    await lauf({ srv, idp, toMcp, werkzeug, anzahl });
  } finally {
    await srv.stop();
    await idp.close();
  }
}

test("K1 place_call ohne confirmation_code startet genau einen Anruf, auch an eine fremde Nummer", async () => {
  await mitServer({}, async ({ werkzeug, anzahl }) => {
    for (const to of [OTHER_NUMBER, OWN_NUMBER]) {
      const vorher = anzahl();
      const result = await werkzeug(SUB_PAID, "place_call", { to, objective: OBJECTIVE });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.equal(result.structuredContent.status, "dialing");
      assert.match(result.structuredContent.call_id, /^call_/);
      assert.equal(anzahl(), vorher + 1);
    }
  });
});

test("K2 tools/list kennt an place_call kein Feld confirmation_code", async () => {
  await mitServer({}, async ({ srv, idp, toMcp }) => {
    const res = await toMcp(await idp.sign({ sub: SUB_PAID }), TOOLS_LIST);
    const { tools } = await readToolResult(res);
    const placeCall = tools.find((tool) => tool.name === "place_call");
    assert.ok(placeCall, "place_call fehlt im tools/list");
    assert.equal(Object.hasOwn(placeCall.inputSchema.properties, "confirmation_code"), false);
    assert.equal(JSON.stringify(placeCall).includes("confirmation_code"), false);
    assert.equal(srv.readStore().calls.length, 0);
  });
});

test("K3 Sperrdaten in den Anruf-Argumenten stoppen place_call ohne Anruf", async () => {
  await mitServer({}, async ({ werkzeug, anzahl }) => {
    const request = { to: OTHER_NUMBER, objective: OBJECTIVE, briefing: `Karte ${CARD_NUMBER}` };
    const vorher = anzahl();

    const placed = await werkzeug(SUB_PAID, "place_call", request);

    assert.equal(placed.isError, true);
    assert.match(placed.content[0].text, /briefing/);
    assert.equal(anzahl(), vorher);
  });
});

test("K4 ohne Abo-Stufe startet place_call keinen Anruf", async () => {
  await mitServer({}, async ({ srv, werkzeug, anzahl }) => {
    const result = await werkzeug(SUB_FREE, "place_call", { to: OTHER_NUMBER, objective: OBJECTIVE });
    assert.equal(result.isError, true);
    await waitForLog(srv, /place_call_denied .*grund=kyc/);
    assert.equal(anzahl(), 0);
  });
});

test("K4 erreichte Kostendecke des Mandanten startet keinen Anruf", async () => {
  await mitServer({}, async ({ srv, werkzeug, anzahl }) => {
    const result = await werkzeug(SUB_CAPPED, "place_call", { to: OTHER_NUMBER, objective: OBJECTIVE });
    assert.equal(result.isError, true);
    await waitForLog(srv, /place_call_denied .*tenant=t_ob_capped/);
    assert.equal(anzahl(), 0);
  });
});

test("K4 OUTBOUND_FROZEN sperrt place_call ohne Anruf", async () => {
  await mitServer({ OUTBOUND_FROZEN: "true" }, async ({ srv, werkzeug, anzahl }) => {
    const result = await werkzeug(SUB_PAID, "place_call", { to: OTHER_NUMBER, objective: OBJECTIVE });
    assert.equal(result.isError, true);
    await waitForLog(srv, /place_call_denied .*grund=frozen/);
    assert.equal(anzahl(), 0);
  });
});

test("K4 das Stundenlimit sperrt den zweiten place_call ohne Anruf", async () => {
  await mitServer({ MAX_CALLS_PER_HOUR: HOURLY_LIMIT }, async ({ srv, werkzeug, anzahl }) => {
    const first = await werkzeug(SUB_PAID, "place_call", { to: OTHER_NUMBER, objective: OBJECTIVE });
    assert.notEqual(first.isError, true, JSON.stringify(first));
    const second = await werkzeug(SUB_PAID, "place_call", { to: THIRD_NUMBER, objective: OBJECTIVE });
    assert.equal(second.isError, true);
    await waitForLog(srv, /place_call_denied .*grund=stundenlimit/);
    assert.equal(anzahl(), 1);
  });
});

test("Mandantentrennung: der Anruf gehört dem aufrufenden Mandanten und ist für einen anderen nicht abrufbar", async () => {
  await mitServer({}, async ({ srv, werkzeug }) => {
    const placed = await werkzeug(SUB_PAID, "place_call", { to: OTHER_NUMBER, objective: OBJECTIVE });
    const callId = placed.structuredContent.call_id;

    const own = await werkzeug(SUB_PAID, "get_call_status", { call_id: callId });
    const foreign = await werkzeug(SUB_FREE, "get_call_status", { call_id: callId });

    const stored = srv.readStore().calls;
    assert.equal(stored.at(-1).tenantId, TENANT_PAID);
    assert.notEqual(own.isError, true);
    assert.equal(foreign.isError, true);
  });
});
