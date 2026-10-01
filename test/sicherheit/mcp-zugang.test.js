import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { planProfileFor } from "../../src/plans.js";
import { KYC_LEVEL } from "../../src/store/defaults.js";
import {
  mcpPost,
  readToolResult,
  seedCall,
  seedState,
  startIdp,
  startServer,
  toolCall,
} from "../helpers.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const TENANT_A = "t_sg_a";
const TENANT_B = "t_sg_b";
const SUB_A = "sub-sg-a";
const SUB_B = "sub-sg-b";
const CALL_A = "call_sg_a";
const CALL_B = "call_sg_b";
const SUMMARY_A = "Termin beim Zahnarzt bestaetigt";
const SUMMARY_B = "Vertrauliche Absprache mit Kanzlei Fremd";
const FOREIGN_AUDIENCE = "https://fremder-dienst.test/mcp";
const FOREIGN_ISSUER = "https://fremder-aussteller.test";
const ONLY_OPENID = "openid";
const TARGET = "+4915112340097";
const OBJECTIVE = "Termin vereinbaren";
const INVENTED_CODE = "ZZZZZZ";
const CONFIRMATION_META_KEY = "hermes/confirmation_code";
const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

const customer = (id, idpSubject) => ({
  id,
  idpSubject,
  status: "active",
  ownerName: `${id} Kunde`,
  kycLevel: KYC_LEVEL.CARD,
});

const ownNumber = {
  id: "num_sg_a",
  e164: "+4915110000088",
  tenantId: TENANT_A,
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
};

const hermes = {};

before(async () => {
  hermes.idp = await startIdp();
  hermes.srv = await startServer({
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: hermes.idp.issuer,
      MULTI_TENANT: "true",
      FAKE_ORIGINATE: "true",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: "sg-bestaetigung-geheimnis-mit-reichlich-laenge",
    },
    seed: seedState({
      tenants: [customer(TENANT_A, SUB_A), customer(TENANT_B, SUB_B)],
      profiles: { [TENANT_A]: planProfileFor("business"), [TENANT_B]: planProfileFor("business") },
      numbers: [ownNumber],
      calls: [
        seedCall({ id: CALL_A, tenantId: TENANT_A, status: "completed", summary: SUMMARY_A }),
        seedCall({ id: CALL_B, tenantId: TENANT_B, status: "completed", summary: SUMMARY_B }),
      ],
    }),
  });
});

after(async () => {
  await hermes.srv?.stop();
  await hermes.idp?.close();
});

const toMcp = (token, body) => mcpPost(`${hermes.srv.localUrl}/mcp`, token, body);
const useTool = async (token, name, args) => readToolResult(await toMcp(token, toolCall(name, args)));
const storedCalls = () => hermes.srv.readStore().calls;

test("SG-01 Token mit fremder Audience wird an /mcp mit 401 abgelehnt", async () => {
  const foreignAudience = await hermes.idp.sign({ sub: SUB_A }, { aud: FOREIGN_AUDIENCE });
  const foreignIssuer = await hermes.idp.sign({ sub: SUB_A }, { iss: FOREIGN_ISSUER });
  const own = await hermes.idp.sign({ sub: SUB_A });

  assert.equal((await toMcp(foreignAudience, TOOLS_LIST)).status, HTTP_UNAUTHORIZED);
  assert.equal((await toMcp(foreignIssuer, TOOLS_LIST)).status, HTTP_UNAUTHORIZED);
  assert.equal((await toMcp(own, TOOLS_LIST)).status, HTTP_OK);
});

test("SG-02 Anruf eines anderen Mandanten ist per Kennung nicht abrufbar", async () => {
  const tokenA = await hermes.idp.sign({ sub: SUB_A });

  const foreign = await useTool(tokenA, "get_call_result", { call_id: CALL_B });
  const own = await useTool(tokenA, "get_call_result", { call_id: CALL_A });

  assert.equal(foreign.isError, true);
  assert.equal(JSON.stringify(foreign).includes(SUMMARY_B), false);
  assert.notEqual(own.isError, true);
  assert.equal(JSON.stringify(own).includes(SUMMARY_A), true);
});

test("SG-03 Token ohne verlangte Scopes wird an /mcp abgelehnt", async () => {
  const withoutScopes = await hermes.idp.sign({ sub: SUB_A, scope: null });
  const onlyOpenid = await hermes.idp.sign({ sub: SUB_A, scope: ONLY_OPENID });
  const complete = await hermes.idp.sign({ sub: SUB_A });

  for (const token of [withoutScopes, onlyOpenid]) {
    const res = await toMcp(token, TOOLS_LIST);
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.match(res.headers.get("www-authenticate") ?? "", /error="insufficient_scope"/);
  }
  assert.equal((await toMcp(complete, TOOLS_LIST)).status, HTTP_OK);
});

test("SG-10 place_call ohne gültigen Bestätigungscode löst keinen Anruf aus", async () => {
  const tokenA = await hermes.idp.sign({ sub: SUB_A });
  const request = { to: TARGET, objective: OBJECTIVE };
  const callsBefore = storedCalls().length;

  const missing = await useTool(tokenA, "place_call", request);
  const invented = await useTool(tokenA, "place_call", { ...request, confirmation_code: INVENTED_CODE });

  assert.equal(missing.isError, true);
  assert.equal(invented.isError, true);
  assert.equal(storedCalls().length, callsBefore);

  const prepared = await useTool(tokenA, "prepare_call", request);
  const confirmation_code = prepared._meta[CONFIRMATION_META_KEY];
  const placed = await useTool(tokenA, "place_call", { ...request, confirmation_code });
  assert.notEqual(placed.isError, true);
  assert.equal(storedCalls().length, callsBefore + 1);
});
