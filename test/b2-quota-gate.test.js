import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, PLAN_PRICE_BOOT_ENV } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { findPlan } from "../src/plans.js";
import { resolvePeriodStartIso, periodStartFromEnd } from "../src/billing/period.js";

const TO = "+4915112345678";

const A = "tenant-a",
  SUB_A = "sub-a",
  NUM_A = "+4915110000001";

const STARTER_MIN = findPlan("starter").includedMinutes;

const SECONDS_PER_DAY = 86400;
const nowSec = Math.floor(Date.now() / 1000);
const fiveDaysAgoSec = nowSec - 5 * SECONDS_PER_DAY;
const twentyFiveDaysAheadSec = nowSec + 25 * SECONDS_PER_DAY;

const activeNumber = (id, e164, tenantId, status = "active") => ({
  id,
  e164,
  tenantId,
  provider: "telnyx",
  status,
  providerNumberId: null,
});

const voiceMinuteEvent = (tenantId, quantity, idSuffix = "") => ({
  id: `ue_${tenantId}${idSuffix}`,
  tenantId,
  callId: null,
  kind: USAGE_EVENT_KIND.VOICE_MINUTE,
  quantity,
  costCents: 0,
  occurredAt: new Date().toISOString(),
  stripeMeterSent: false,
});

const bucket = (costEur) => ({ inputTokens: 0, outputTokens: 0, costEur, calls: costEur ? 1 : 0 });

const PROVISIONED_PROFILE = { maxCallsPerHour: null };

function seedQuota({ subscription = {}, usageEvents = [], usage } = {}) {
  const s = seedState({
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active" },
      {
        id: A,
        status: "active",
        idpSubject: SUB_A,
        ownerName: "Alice",
        kycLevel: "card",
        ...subscription,
      },
    ],
    numbers: [activeNumber("num_a", NUM_A, A)],
    profiles: { [A]: PROVISIONED_PROFILE },
  });
  s.usageEvents = usageEvents;
  if (usage) s.usage = usage;
  return s;
}

const STARTER_SUB = { stripePlanSlug: "starter", stripeCurrentPeriodStart: fiveDaysAgoSec };

const PAY_ENV = {
  MULTI_TENANT: "true",
  ALLOWED_NUMBERS: TO,
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  STRIPE_API_BASE: "http://127.0.0.1:9",
  NUMBER_SETUP_FEE_CENTS: "500",
  ...PLAN_PRICE_BOOT_ENV,
};
const PAY_OFF_ENV = { MULTI_TENANT: "true", ALLOWED_NUMBERS: TO };

function placeCall(srv, identity, body = {}) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(identity ? { "X-Internal-Identity": identity } : {}),
    },
    body: JSON.stringify({ to: TO, objective: "Termin vereinbaren", ...body }),
  });
}

const outboundCallsTo = (srv) =>
  srv.readStore().calls.filter((c) => c.direction === "outbound" && c.to === TO);

async function tryOutbound(env, seed, identity) {
  const srv = await startServer({ env, seed });
  try {
    const res = await placeCall(srv, identity);
    return { status: res.status, body: await res.text(), callCount: outboundCallsTo(srv).length };
  } finally {
    await srv.stop();
  }
}

test("erschoepfte Plan-Minuten blocken den Outbound (402 grund=minutes), KEIN Call", async () => {
  const seed = seedQuota({
    subscription: STARTER_SUB,
    usageEvents: [voiceMinuteEvent(A, STARTER_MIN)],
  });
  const { status, body, callCount } = await tryOutbound(PAY_ENV, seed, SUB_A);
  assert.equal(status, 402, "Minuten erschoepft -> geblockt");
  assert.match(body, /Plan-Minuten/, "Minuten-Meldung (eigene Achse)");
  assert.equal(callCount, 0, "Block VOR createCall -> kein Call-Record");
});

test("Minuten- und Budget-Achse sind getrennt (verschiedene 402-Meldungen)", async () => {
  const budgetSeed = seedQuota({
    subscription: STARTER_SUB,
    usageEvents: [],
    usage: { [BOOTSTRAP_TENANT_ID]: bucket(0), [A]: bucket(99) },
  });
  const budgetRes = await tryOutbound(PAY_ENV, budgetSeed, SUB_A);
  assert.equal(budgetRes.status, 402, "Budget erschoepft -> geblockt");
  assert.match(budgetRes.body, /budget limit/, "Budget-Gate feuert VOR dem Minuten-Gate");

  const minutesSeed = seedQuota({
    subscription: STARTER_SUB,
    usageEvents: [voiceMinuteEvent(A, STARTER_MIN)],
  });
  const minutesRes = await tryOutbound(PAY_ENV, minutesSeed, SUB_A);
  assert.equal(minutesRes.status, 402, "Minuten erschoepft -> geblockt");
  assert.match(minutesRes.body, /Plan-Minuten/, "eigenes Minuten-Gate, getrenntes if");
});

test("Owner/Bootstrap nie minuten-gesperrt (kein Plan) -> erreicht Originate (500)", async () => {
  const seed = seedQuota({ subscription: STARTER_SUB, usageEvents: [voiceMinuteEvent(A, STARTER_MIN)] });
  const { status, callCount } = await tryOutbound(PAY_ENV, seed, null);
  assert.equal(status, 500, "Owner uebergeht das Gate, scheitert erst am Offline-Originate");
  assert.equal(callCount, 1, "Owner-Call wird erzeugt (nicht geblockt)");
});

test("fail-closed: aktiver Subscriber OHNE Plan -> 402 grund=minutes (absichtlich)", async () => {
  const seed = seedQuota({ subscription: {}, usageEvents: [] });
  const { status, body, callCount } = await tryOutbound(PAY_ENV, seed, SUB_A);
  assert.equal(status, 402, "kein Plan -> fail-closed blocken");
  assert.match(body, /Plan-Minuten/, "fail-closed ueber das Minuten-Gate");
  assert.equal(callCount, 0, "kein Call");
});

test("Bestands-Tenant NULL current_period_start + gueltiges currentPeriodEnd -> NICHT gesperrt", async () => {
  const seed = seedQuota({
    subscription: { stripePlanSlug: "starter", stripeCurrentPeriodEnd: twentyFiveDaysAheadSec },
    usageEvents: [],
  });
  const { status } = await tryOutbound(PAY_ENV, seed, SUB_A);
  assert.equal(status, 500, "abgeleiteter Anker, used 0 < Kontingent -> passiert das Gate");
});

test("PAYMENT_ENABLED=false: Minuten-Gate ist No-Op -> erreicht Originate (500)", async () => {
  const seed = seedQuota({ subscription: STARTER_SUB, usageEvents: [voiceMinuteEvent(A, STARTER_MIN)] });
  const { status } = await tryOutbound(PAY_OFF_ENV, seed, SUB_A);
  assert.equal(status, 500, "ohne Payment greift das Gate nicht -> Originate");
});

test("Inbound nicht minuten-gegated: erschoepfte Minuten -> normale Begruessung (200)", async () => {
  const seed = seedQuota({ subscription: STARTER_SUB, usageEvents: [voiceMinuteEvent(A, STARTER_MIN)] });
  const srv = await startServer({ env: PAY_ENV, seed });
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: "+4915199999999", To: NUM_A }),
    });
    assert.equal(res.status, 200, "Inbound trotz erschoepfter Minuten erreichbar");
    assert.match(await res.text(), /Alice/, "normale Begruessung mit A's ownerName, kein Budget-Hangup");
  } finally {
    await srv.stop();
  }
});

test("resolvePeriodStartIso: persistierter Start hat Vorrang, sonst End-Ableitung, sonst null", () => {
  const startSec = 1_700_000_000;
  const endSec = 1_703_000_000;
  assert.equal(
    resolvePeriodStartIso({ currentPeriodStart: startSec }),
    new Date(startSec * 1000).toISOString(),
    "persistierter Start -> ISO davon",
  );
  assert.equal(
    resolvePeriodStartIso({ currentPeriodStart: startSec, currentPeriodEnd: endSec }),
    new Date(startSec * 1000).toISOString(),
    "Start hat Vorrang vor End (Praezedenz 1 vor 2)",
  );
  assert.equal(
    resolvePeriodStartIso({ currentPeriodEnd: endSec }),
    periodStartFromEnd(endSec).toISOString(),
    "nur End -> abgeleiteter Anker (Bestands-Fallback)",
  );
  assert.equal(
    resolvePeriodStartIso({ currentPeriodStart: 0 }),
    new Date(0).toISOString(),
    "0 ist ein Wert, kein fehlender Anker (!= null, nicht falsy)",
  );
  assert.equal(resolvePeriodStartIso({ currentPeriodStart: null, currentPeriodEnd: null }), null, "beide null -> null");
  assert.equal(resolvePeriodStartIso(), null, "leeres Arg -> null (fail-closed an den Aufrufer)");
});
