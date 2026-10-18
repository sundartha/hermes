import assert from "node:assert/strict";
import { seedState, startServer, withFetch } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { captureToolHandlers } from "./werkzeug-registrierung.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const HTTP_UNAVAILABLE = 503;
const HTTP_CONFLICT = 409;

const TARGET = "+12025550199";
const OTHER_TARGET = "+12025550177";
const HOME_COUNTRY_TARGET = "+4915112345678";
const OBJECTIVE = "Book a table for two";
const MAX_CALLS_PER_HOUR = 100;
const CAP_FOR_ONE_CALL_CENTS = 60;
const CAP_NEAR_EXHAUSTED_CENTS = 800;
const SPENT_NEAR_CAP_CENTS = 779;
const SMALL_CAP_CENTS = 100;
const UNREADABLE_SPENT_CENTS = -5;

const GATE_SERVER_ENV = Object.freeze({
  PER_TARGET_CALL_CAP: "1",
  VOICE_TARIFF_DEFAULT_CENTS: "30",
  VOICE_TARIFF_DOMESTIC_CENTS: "30",
  FAKE_ORIGINATE: "true",
});

const GATE_CASES = Object.freeze([
  { grund: "kyc", status: HTTP_FORBIDDEN, tenant: { kycLevel: "otp" } },
  { grund: "abo", status: HTTP_FORBIDDEN, tenant: { status: "suspended" } },
  { grund: "billing_hold", status: HTTP_FORBIDDEN, tenant: { billingHold: "paused" } },
  { grund: "denylist", status: HTTP_FORBIDDEN, to: "+870123456789" },
  { grund: "format", status: HTTP_BAD_REQUEST, to: "+4901737123456", ohneGrund: true },
  {
    grund: "land",
    status: HTTP_FORBIDDEN,
    to: HOME_COUNTRY_TARGET,
    profile: { allowedCountryCodes: ["+1"] },
  },
  {
    grund: "stundenlimit",
    status: HTTP_TOO_MANY_REQUESTS,
    profile: { maxCallsPerHour: 1 },
    earlierCalls: ["+12025550100"],
  },
  { grund: "ziel_limit", status: HTTP_TOO_MANY_REQUESTS, earlierCalls: [TARGET] },
  { grund: "herkunft", status: HTTP_FORBIDDEN, to: HOME_COUNTRY_TARGET, tenant: { country: "DE" } },
  {
    grund: "budget_tenant",
    status: HTTP_PAYMENT_REQUIRED,
    cap: SMALL_CAP_CENTS,
    spent: SMALL_CAP_CENTS,
  },
  {
    grund: "budget_tenant",
    status: HTTP_PAYMENT_REQUIRED,
    cap: SMALL_CAP_CENTS,
    spent: UNREADABLE_SPENT_CENTS,
  },
  {
    grund: "reserve_ueber_rest",
    status: HTTP_PAYMENT_REQUIRED,
    cap: CAP_NEAR_EXHAUSTED_CENTS,
    spent: SPENT_NEAR_CAP_CENTS,
  },
  {
    grund: "reserve_erschoepft",
    status: HTTP_PAYMENT_REQUIRED,
    cap: CAP_FOR_ONE_CALL_CENTS,
    spent: 0,
    firstCall: TARGET,
    to: OTHER_TARGET,
  },
]);

const NUMMER_ENDSTELLEN = 2;
const tenantIdOf = (index) => `t_gate_${index}`;

const tenantRow = (fall, index) => ({
  id: tenantIdOf(index),
  status: "active",
  kycLevel: "card",
  ownerName: "Eve Example",
  country: "US",
  defaultLanguage: "en",
  ...fall.tenant,
});

const numberRow = (_fall, index) => ({
  id: `num_gate_${index}`,
  e164: `+120255502${String(index).padStart(NUMMER_ENDSTELLEN, "0")}`,
  tenantId: tenantIdOf(index),
  provider: "telnyx",
  status: "active",
  providerNumberId: null,
  language: "en",
});

const earlierCallRows = (fall, index) =>
  (fall.earlierCalls ?? []).map((to) => ({
    id: `call_gate_${index}_${to}`,
    tenantId: tenantIdOf(index),
    direction: "outbound",
    to,
    status: "completed",
    startedAt: new Date().toISOString(),
  }));

const budgetCases = (faelle) =>
  faelle.map((fall, index) => [fall, index]).filter(([fall]) => fall.cap !== undefined);

function gateSeed(faelle) {
  return {
    ...seedState({
      tenants: faelle.map(tenantRow),
      numbers: faelle.map(numberRow),
      profiles: Object.fromEntries(
        faelle.map((fall, index) => [
          tenantIdOf(index),
          { maxCallsPerHour: MAX_CALLS_PER_HOUR, ...fall.profile },
        ]),
      ),
      calls: faelle.flatMap(earlierCallRows),
    }),
    usage: Object.fromEntries(
      budgetCases(faelle).map(([fall, index]) => [tenantIdOf(index), { costCents: fall.spent }]),
    ),
    tenantBudgets: budgetCases(faelle).map(([fall, index]) => ({
      tenantId: tenantIdOf(index),
      budgetCents: fall.cap,
      hardCapCents: fall.cap,
    })),
  };
}

async function placeCallAs(srv, tenantId, to) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": tenantId },
    body: JSON.stringify({ to, objective: OBJECTIVE }),
  });
  return { status: res.status, body: await res.json() };
}

async function gateRejection(srv, fall, index) {
  const tenantId = tenantIdOf(index);
  if (fall.firstCall) {
    const accepted = await placeCallAs(srv, tenantId, fall.firstCall);
    assert.equal(accepted.status, HTTP_OK, `${fall.grund}: der erste Anruf muss angenommen werden`);
  }
  const { status, body } = await placeCallAs(srv, tenantId, fall.to ?? TARGET);
  assert.equal(status, fall.status, `${fall.grund}: Status der Ablehnung`);
  assert.equal(body.reason, fall.ohneGrund ? undefined : fall.grund, `${fall.grund}: Grund der Ablehnung`);
  assert.match(body.error, /\S/, `${fall.grund}: Text fehlt`);
  return body.error;
}

export async function gateRejectionTexts() {
  const srv = await startServer({ seed: gateSeed(GATE_CASES), env: GATE_SERVER_ENV });
  try {
    const texts = [];
    for (const [index, fall] of GATE_CASES.entries()) {
      texts.push(await gateRejection(srv, fall, index));
    }
    return texts;
  } finally {
    await srv.stop();
  }
}

const TIMEOUT = Symbol("timeout");
const reply = (status, body) => ({ status, body });
const CONFIRMED = reply(HTTP_OK, { preview: { to: TARGET, objective: OBJECTIVE }, confirmed: true });
const PREPARE_ARGS = { to: TARGET, objective: OBJECTIVE };
const PLACE_ARGS = { ...PREPARE_ARGS, confirmation_code: "123456" };
const CALL_ROUTE = "/api/calls/c1";
const STATE_ROUTE = "/api/state";
const CONFIRM_ROUTE = "/api/call-confirmations";
const CONSULT_ROUTE = `${CALL_ROUTE}/consult/answer`;
const CONSULT_ARGS = { call_id: "c1", event_id: "e1", answers: ["Tuesday"] };
const CALL_ID = { call_id: "c1" };

const TOOL_FAILURES = Object.freeze([
  { tool: "list_calls", routes: { [STATE_ROUTE]: reply(HTTP_OK, null) } },
  { tool: "list_calls", routes: { [STATE_ROUTE]: reply(HTTP_OK, {}) } },
  { tool: "list_calls", routes: { [STATE_ROUTE]: TIMEOUT } },
  { tool: "get_call_status", args: CALL_ID, routes: { [CALL_ROUTE]: reply(HTTP_NOT_FOUND, {}) } },
  { tool: "get_call_status", args: CALL_ID, routes: { [CALL_ROUTE]: reply(HTTP_FORBIDDEN, {}) } },
  { tool: "get_call_status", args: CALL_ID, routes: { [CALL_ROUTE]: reply(HTTP_UNPROCESSABLE, {}) } },
  {
    tool: "get_call_result",
    args: CALL_ID,
    routes: { [CALL_ROUTE]: reply(HTTP_OK, { status: "active", transcript: [] }) },
  },
  {
    tool: "get_call_result",
    args: CALL_ID,
    routes: { [CALL_ROUTE]: reply(HTTP_OK, { status: "completed", transcript: [] }) },
  },
  {
    tool: "prepare_call",
    args: PREPARE_ARGS,
    routes: { [CONFIRM_ROUTE]: reply(HTTP_UNAVAILABLE, { reason: "confirmation_unavailable" }) },
  },
  {
    tool: "prepare_call",
    args: { ...PREPARE_ARGS, briefing: "My card number is 4111 1111 1111 1111, expiry 12/30" },
    routes: {},
  },
  {
    tool: "prepare_call",
    args: { ...PREPARE_ARGS, briefing: "My SSN is 078-05-1120" },
    routes: {},
  },
  {
    tool: "prepare_call",
    args: { ...PREPARE_ARGS, briefing: "The password: hunter2hunter2 opens the door" },
    routes: {},
  },
  {
    tool: "place_call",
    args: PLACE_ARGS,
    routes: { [CONFIRM_ROUTE]: reply(HTTP_OK, { preview: PREPARE_ARGS, confirmed: false }) },
  },
  {
    tool: "place_call",
    args: PLACE_ARGS,
    routes: {
      [CONFIRM_ROUTE]: reply(HTTP_OK, { preview: PREPARE_ARGS, confirmed: false, reason: "already_used" }),
    },
  },
  {
    tool: "place_call",
    args: PLACE_ARGS,
    routes: { [CONFIRM_ROUTE]: CONFIRMED, "/api/calls": TIMEOUT },
  },
  {
    tool: "place_call",
    args: PLACE_ARGS,
    routes: { [CONFIRM_ROUTE]: CONFIRMED, "/api/calls": reply(HTTP_SERVER_ERROR, {}) },
  },
  {
    tool: "answer_consult",
    args: CONSULT_ARGS,
    routes: { [CONSULT_ROUTE]: reply(HTTP_BAD_REQUEST, {}) },
  },
  {
    tool: "answer_consult",
    args: CONSULT_ARGS,
    routes: { [CONSULT_ROUTE]: reply(HTTP_CONFLICT, {}) },
  },
]);

const FALLBACK_FAILURE = {
  tool: "list_calls",
  routes: { [STATE_ROUTE]: reply(HTTP_SERVER_ERROR, {}) },
};

const DENIAL_REASONS = Object.freeze([
  "frozen",
  "tenant_unbekannt",
  "kyc",
  "keine_identitaet",
  "denylist",
  "format",
  "land",
  "stundenlimit",
  "ziel_limit",
  "abo",
  "allowlist",
  "billing_hold",
  "keine_tenant_nummer",
  "herkunft",
  "ani_not_owned",
  "budget_tenant",
  "reserve_erschoepft",
  "reserve_ueber_rest",
  "minutes",
  "reserve_error",
  "gate_error",
]);

const denialCase = (reason) => ({
  tool: "place_call",
  args: PLACE_ARGS,
  routes: { [CONFIRM_ROUTE]: CONFIRMED, "/api/calls": reply(HTTP_FORBIDDEN, { reason }) },
});

function gatewayStub(routes) {
  return async (url) => {
    const answer = routes[new URL(url).pathname] ?? reply(HTTP_NOT_FOUND, {});
    if (answer === TIMEOUT) throw Object.assign(new Error("Frist"), { name: "TimeoutError" });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
}

async function deliveredText(fall) {
  const call = captureToolHandlers({ scopedTenant: "t_en", language: "en", consultAllowed: true }).get(fall.tool);
  const result = await withFetch(gatewayStub(fall.routes), () => call(fall.args ?? {}));
  const text = result.content.map((part) => part.text).join("\n");
  assert.match(text, /\S/, `${fall.tool}: keine Antwort`);
  return { text, isError: result.isError === true };
}

async function deliveredTexts(faelle, ausweichtext) {
  const texts = [];
  for (const fall of faelle) {
    const { text } = await deliveredText(fall);
    assert.notEqual(text, ausweichtext, `${fall.tool}: nur der Ausweichtext kam an, die Meldung wurde nicht erzeugt`);
    texts.push(text);
  }
  return texts;
}

export async function mcpErrorTexts() {
  const fallback = await deliveredText(FALLBACK_FAILURE);
  assert.equal(fallback.isError, true, "der Ausweichfall muss als Fehler ausgeliefert werden");
  const unknownDenial = await deliveredText(denialCase("unbekannter_grund_xyz"));
  const failures = await deliveredTexts(TOOL_FAILURES, fallback.text);
  const denials = await deliveredTexts(DENIAL_REASONS.map(denialCase), unknownDenial.text);
  return [fallback.text, unknownDenial.text, ...failures, ...denials];
}
