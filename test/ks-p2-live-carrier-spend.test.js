import { test, before } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_CORRUPT_REASON } from "../src/store/defaults.js";
import { localeFor } from "../src/i18n/locales.js";
import {
  makeDefaultState,
  setTenantBudget,
  addVoiceUsageCostCents,
  budgetExceeded,
  liveBudgetExceeded,
  activeCallsFor,
  tryReserveOutboundBudget,
} from "../src/store/state-ops.js";

const TARIFF_CENTS_PER_MIN = 50;
const INBOUND_TARIFF_CENTS_PER_MIN = 20;
const MS_PER_MINUTE = 60_000;

const TENANT = "tenant_ks_p2";
const OTHER_TENANT = "tenant_ks_p2_fremd";

const TWO_MINUTE_LEG_MS = 90_000;
const ONE_MINUTE_LEG_MS = 30_000;

const NOW_ISO = "2026-07-30T12:00:00.000Z";

const CFG = Object.freeze({
  platformSpendCapCents: 100_000,
  defaultTenantBudgetCents: 0,
  budgetMonthEnabled: false,
});

let blockingBudgetAxis, liveVoiceSpendCents;

before(async () => {
  process.env.VOICE_TARIFF_DEFAULT_CENTS = String(TARIFF_CENTS_PER_MIN);
  process.env.VOICE_TARIFF_DOMESTIC_CENTS = "0";
  process.env.VOICE_TARIFF_INBOUND_CENTS = String(INBOUND_TARIFF_CENTS_PER_MIN);
  await import("../src/config.js");
  ({ blockingBudgetAxis } = await import("../src/budget-gate.js"));
  ({ liveVoiceSpendCents } = await import("../src/billing/metering.js"));
});

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function activeLeg({ id = "call_live", tenantId = TENANT, ageMs = TWO_MINUTE_LEG_MS, ...rest } = {}) {
  const startedAt = isoAgo(ageMs);
  return {
    id,
    tenantId,
    direction: "outbound",
    status: "active",
    from: "+15005550006",
    to: "+4915112345678",
    startedAt,
    answeredAt: startedAt,
    ...rest,
  };
}

function stateWith({ capCents, bookedCents = 0, legs = [] }) {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT, { budgetCents: capCents, hardCapCents: capCents });
  if (bookedCents) addVoiceUsageCostCents(s, TENANT, bookedCents, NOW_ISO);
  s.calls.push(...legs);
  return s;
}

function storeOver(s) {
  return {
    activeCallsFor: (tenantId) => activeCallsFor(s, tenantId),
    liveBudgetExceeded: (tenantId, liveCents, cfg) =>
      liveBudgetExceeded(s, tenantId, liveCents, cfg, NOW_ISO),
  };
}

function axisFor(s, tenantId = TENANT) {
  return blockingBudgetAxis({ store: storeOver(s), billing: CFG, tenantId });
}

function captureErr(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return logs;
}

test("KS-P2-1: die laufende Minute allein reisst den Cap - der Turn liefert budget_tenant", () => {
  const s = stateWith({ capCents: 100, legs: [activeLeg()] });

  assert.equal(axisFor(s), "budget_tenant");
  assert.equal(budgetExceeded(s, TENANT, CFG, NOW_ISO), false, "gebucht ist noch nichts");
});

test("KS-P2-2: Inbound zaehlt MIT - der Live-Term deckt seit KV-P2 alle laufenden Legs", () => {
  const inbound = activeLeg({ direction: "inbound", to: "+15005550006", from: "+4915112345678" });

  assert.equal(
    liveVoiceSpendCents([inbound], Date.now()),
    2 * INBOUND_TARIFF_CENTS_PER_MIN,
    "der Inbound-Satz zaehlt, nicht mehr die Richtung",
  );
  assert.equal(
    axisFor(stateWith({ capCents: 10, legs: [inbound] })),
    "budget_tenant",
    "eine kleine Decke wird vom laufenden Inbound-Leg gerissen",
  );
  assert.equal(
    axisFor(stateWith({ capCents: 10_000, legs: [inbound] })),
    null,
    "die Decke bindet, nicht die Richtung",
  );
});

test("KS-P2-3: die Vorab-Reserve zaehlt NICHT mit (der Call laeuft nicht gegen sich selbst)", () => {
  const capCents = 1000;
  const s = stateWith({ capCents, legs: [activeLeg({ ageMs: ONE_MINUTE_LEG_MS })] });
  assert.equal(
    tryReserveOutboundBudget(s, TENANT, capCents, CFG, NOW_ISO),
    true,
    "die Reserve fuer genau diesen Call ist gebucht",
  );

  assert.equal(axisFor(s), null, "gebucht + eigene Zeit, NICHT plus der eigenen Reserve");
});

test("KS-P2-4: unlesbarer Zeitanker sperrt fail-closed mit grund=usage_korrupt feld=liveCents", () => {
  const s = stateWith({ capCents: 100, legs: [activeLeg({ startedAt: null, answeredAt: null })] });

  let axis;
  const logs = captureErr(() => {
    axis = axisFor(s);
  });

  assert.equal(axis, "budget_tenant", "ein ungemessener Leg darf das Gate nicht blind machen");
  assert.equal(logs.length, 1, `genau eine Zeile, erhalten: ${JSON.stringify(logs)}`);
  assert.equal(
    logs[0],
    `[budget] grund=${USAGE_CORRUPT_REASON} kante=tenant:${TENANT} feld=liveCents wert=NaN`,
  );
});

test("KS-P2-5: rueckwaerts springende Uhr drueckt den Verbrauch nie unter den gebuchten Wert", () => {
  const future = new Date(Date.now() + 10 * MS_PER_MINUTE).toISOString();
  const leg = activeLeg({ startedAt: future, answeredAt: future });
  const s = stateWith({ capCents: 100, bookedCents: 99, legs: [leg] });

  assert.equal(liveVoiceSpendCents([leg], Date.now()), 0, "negative Zeit clampt auf 0");
  assert.equal(axisFor(s), null, "99 < 100 bleibt frei, der Live-Term senkt nichts");
});

test("KS-P2-6: zwei gleichzeitige Outbound-Legs summieren (Gleichzeitigkeit ohne Reserve)", () => {
  const legs = [
    activeLeg({ id: "call_a", ageMs: ONE_MINUTE_LEG_MS }),
    activeLeg({ id: "call_b", ageMs: ONE_MINUTE_LEG_MS }),
  ];
  const s = stateWith({ capCents: 80, legs });

  assert.equal(axisFor(stateWith({ capCents: 80, legs: [legs[0]] })), null, "ein Leg allein: frei");
  assert.equal(axisFor(s), "budget_tenant");
});

test("KS-P2-7: angefangene Minute - 1 ms zaehlt als eine, 60000 ms als eine, 60001 ms als zwei", () => {
  const nowMs = Date.parse(NOW_ISO);
  const legAged = (elapsedMs) => {
    const at = new Date(nowMs - elapsedMs).toISOString();
    return activeLeg({ startedAt: at, answeredAt: at });
  };

  assert.equal(liveVoiceSpendCents([legAged(0)], nowMs), 0, "noch keine angefangene Minute");
  assert.equal(liveVoiceSpendCents([legAged(1)], nowMs), TARIFF_CENTS_PER_MIN);
  assert.equal(liveVoiceSpendCents([legAged(MS_PER_MINUTE)], nowMs), TARIFF_CENTS_PER_MIN);
  assert.equal(liveVoiceSpendCents([legAged(MS_PER_MINUTE + 1)], nowMs), 2 * TARIFF_CENTS_PER_MIN);
});

test("KS-P2-8: der Leg eines fremden Tenants sperrt niemanden", () => {
  const s = stateWith({ capCents: 100, legs: [activeLeg({ tenantId: OTHER_TENANT })] });

  assert.equal(axisFor(s), null, "die Zeit eines fremden Tenants gehoert nicht in diese Decke");
});

test("KS-P2-9: ein beendeter Leg zaehlt nicht mehr (keine Doppelzaehlung mit der Buchung)", () => {
  const s = stateWith({ capCents: 100, legs: [activeLeg({ status: "completed" })] });

  assert.equal(axisFor(s), null);
});

test("KS-P2-10: budgetExceeded bleibt am Dial-Gate und beim Inbound-Reject unveraendert", () => {
  const s = stateWith({ capCents: 100, bookedCents: 40, legs: [activeLeg()] });

  assert.equal(budgetExceeded(s, TENANT, CFG, NOW_ISO), false, "40 < 100, der Live-Term zaehlt hier nicht");
  addVoiceUsageCostCents(s, TENANT, 60, NOW_ISO);
  assert.equal(budgetExceeded(s, TENANT, CFG, NOW_ISO), true, "100 >= 100, Grenze inklusiv wie im Bestand");
});

test("KS-P2-11: Budget-Engine - der Live-Verbrauch beendet den Call mit Ansage und Hangup", async () => {
  const id = "call_ks_p2_engine";
  const startedAt = isoAgo(TWO_MINUTE_LEG_MS);
  const srv = await startServer({
    env: {
      VOICE_TARIFF_DEFAULT_CENTS: String(TARIFF_CENTS_PER_MIN),
      ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
      LLM_MAX_RETRIES: "0",
      LLM_BACKOFF_MS: "1",
    },
    seed: {
      ...seedState({
        calls: [
          seedCall({
            id,
            provider: "telnyx",
            direction: "outbound",
            maxDurationS: 300,
            startedAt,
            answeredAt: startedAt,
          }),
        ],
      }),
      tenantBudgets: [{ tenantId: BOOTSTRAP_TENANT_ID, budgetCents: 100, hardCapCents: 100 }],
    },
  });
  try {
    const turn = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: "Ja, Donnerstag passt gut" }),
    });
    const body = await turn.text();

    assert.ok(body.includes(localeFor("de").budgetExhaustedHangup), `Abschluss-Ansage erwartet: ${body}`);
    assert.match(body, /<Hangup/);
    assert.match(srv.stdout, /\[turn\] abbruch grund=budget_tenant/);
  } finally {
    await srv.stop();
  }
});

