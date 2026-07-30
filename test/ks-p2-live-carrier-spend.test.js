// KS-P2: die Mid-Call-Pruefung (blockingBudgetAxis) sieht seit dieser Phase nicht nur den
// GEBUCHTEN Verbrauch, sondern auch den noch nicht gebuchten LIVE-Verbrauch der
// Carrier-Achse. Bis hierher war genau die teure Achse mid-call blind: die KI-Token-Achse
// bucht in jeder Schleifenrunde, die Carrier-Minuten erst bei Call-Ende
// (reconcileOutboundVoiceBudget).
//
// Der Live-Term ist eine TENANT-Groesse: die Summe der angefangenen Minuten ALLER noch
// laufenden Outbound-Legs des Tenants mal deren Leg-Tarif. Damit deckt EINE Groesse die
// Gleichzeitigkeit ab, ohne sich auf die strukturell ephemere Vorab-Reserve zu stuetzen.
//
// Testnamen tragen bewusst KEINE i18n-Katalog-ID (KS- matcht i18nCatalogPattern nicht) -
// sie landen im Regressionslauf, wo Rot wirklich Rot heisst.
//
// Aufbau wie test/al-p6-turn-deadline-budget.test.js: die Tarif-Env wird VOR dem ersten
// config.js-Import gesetzt, danach werden die config-lesenden Module dynamisch importiert.
// Ohne das entschiede eine lokale .env ueber den Minutensatz (Lehre test-base-env-drift).
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
  activeOutboundCallsFor,
  tryReserveOutboundBudget,
} from "../src/store/state-ops.js";
// test/telnyx-shim-harness.js importiert src/config.js STATISCH und wird deshalb - wie
// budget-gate.js und billing/metering.js - erst NACH dem Setzen der Tarif-Env geladen.
// Ein statischer Import hier fror die Config mit dem Tarif der lokalen .env ein.

// Fixierter Minutensatz dieser Datei: das Leg +1 -> +49 ist KEIN Inlands-Leg
// (isDomesticLeg), es zieht also VOICE_TARIFF_DEFAULT_CENTS.
const TARIFF_CENTS_PER_MIN = 50;
const MS_PER_MINUTE = 60_000;

const TENANT = "tenant_ks_p2";
const OTHER_TENANT = "tenant_ks_p2_fremd";

// Zeitanker der laufenden Legs. 90 s liegen sicher in der ZWEITEN angefangenen Minute,
// 30 s sicher in der ersten - beide Werte sind gegen die Ausfuehrungslatenz des Tests
// unempfindlich (anders als exakt 60 s, das genau auf der Rundungsgrenze saesse).
const TWO_MINUTE_LEG_MS = 90_000;
const ONE_MINUTE_LEG_MS = 30_000;

// Uhr der GEBUCHTEN Achse. Sie ist hier bedeutungslos (budgetMonthEnabled=false und kein
// Perioden-Stempel -> der Gate-Verbrauch ist der Lebenszeit-Bucket), muss aber lesbar sein.
const NOW_ISO = "2026-07-30T12:00:00.000Z";

// Config-Literal statt src/config.js (Muster PRICES in budget-nan-fail-closed.test.js):
// die Praedikat-Tests bleiben damit unabhaengig von .env. Der effektive Cap kommt in jedem
// Test aus einer expliziten tenant_budget-Zeile, platformSpendCapCents ist nur die
// Rueckfallstufe fuer Tenants ohne Zeile.
const CFG = Object.freeze({
  platformSpendCapCents: 100_000,
  defaultTenantBudgetCents: 0,
  budgetMonthEnabled: false,
});

let blockingBudgetAxis, liveVoiceSpendCents;
let shim; // Modul-Namensraum von test/telnyx-shim-harness.js (s. Hinweis oben)

before(async () => {
  process.env.VOICE_TARIFF_DEFAULT_CENTS = String(TARIFF_CENTS_PER_MIN);
  process.env.VOICE_TARIFF_DOMESTIC_CENTS = "0";
  await import("../src/config.js");
  ({ blockingBudgetAxis } = await import("../src/budget-gate.js"));
  ({ liveVoiceSpendCents } = await import("../src/billing/metering.js"));
  shim = await import("./telnyx-shim-harness.js");
});

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

// Ein laufendes Outbound-Leg in der Form, die der Live-Term liest: Richtung, Zeitanker und
// BEIDE Nummern (der Minutensatz haengt an Ziel UND Herkunft).
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

// Build-Schritt (P13): ein State mit gesetztem Tenant-Cap, gebuchtem Verbrauch und den
// gegebenen Legs.
function stateWith({ capCents, bookedCents = 0, legs = [] }) {
  const s = makeDefaultState();
  setTenantBudget(s, TENANT, { budgetCents: capCents, hardCapCents: capCents });
  if (bookedCents) addVoiceUsageCostCents(s, TENANT, bookedCents, NOW_ISO);
  s.calls.push(...legs);
  return s;
}

// Fassaden-Fake ueber einen ECHTEN state-ops-State: blockingBudgetAxis bekommt genau die
// zwei Methoden, die es fragt, und beide fuehren in die echten ops-Funktionen - kein
// Nachbau der Geld-Entscheidung im Test.
function storeOver(s) {
  return {
    activeOutboundCallsFor: (tenantId) => activeOutboundCallsFor(s, tenantId),
    liveBudgetExceeded: (tenantId, liveCents, cfg) =>
      liveBudgetExceeded(s, tenantId, liveCents, cfg, NOW_ISO),
  };
}

function axisFor(s, tenantId = TENANT) {
  return blockingBudgetAxis({ store: storeOver(s), billing: CFG, tenantId });
}

// Leitet console.error waehrend fn um (Muster captureErr in budget-nan-fail-closed.test.js).
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
  // Mutationsprobe im Test selbst: die GEBUCHTE Achse allein sieht hier nichts - genau das
  // war der Defekt. Ein Rueckbau auf store.budgetExceeded macht die Zeile darueber rot.
  assert.equal(budgetExceeded(s, TENANT, CFG, NOW_ISO), false, "gebucht ist noch nichts");
});

test("KS-P2-2: Inbound zaehlt NICHT - ein laufendes Inbound-Gespraech wird nicht aufgelegt", () => {
  // Realistische Inbound-Form: die EIGENE DID wird angewaehlt (to), der Anrufer ist die
  // Gegenstelle (from). Die DID steht bewusst in +1 - ein Land ohne gemessenen Inlandssatz,
  // callTariffCentsPerMin liefert dafuer den vollen Default-Satz. Mit einer +49-DID kaeme
  // der Inlandssatz 0 heraus und der Test bestuende auch OHNE den Richtungs-Filter.
  const inbound = activeLeg({ direction: "inbound", to: "+15005550006", from: "+4915112345678" });
  const s = stateWith({ capCents: 100, legs: [inbound] });

  assert.equal(
    liveVoiceSpendCents([inbound], Date.now()),
    2 * TARIFF_CENTS_PER_MIN,
    "der Leg WAERE teuer - nur die Richtung haelt ihn aus der Summe",
  );
  assert.equal(axisFor(s), null);
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
  // Jedes Leg allein kostet 50 ct und bliebe unter der Decke; zusammen sind es 100.
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
      // Toter Port: ein einziger Anthropic-Request wuerde den Test haengen lassen bzw.
      // scheitern - der gruene Lauf beweist damit zugleich "kein Token verbrannt".
      ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
      LLM_MAX_RETRIES: "0",
      LLM_BACKOFF_MS: "1",
    },
    seed: {
      ...seedState({
        calls: [
          seedCall({
            id,
            provider: "twilio",
            direction: "outbound",
            // Der Live-Term braucht Spielraum bis zum Max-Dauer-Cap, sonst terminalisiert
            // der Boot-Re-Arm das 90 s alte Leg, bevor der Turn ueberhaupt ankommt.
            maxDurationS: 300,
            startedAt,
            answeredAt: startedAt,
          }),
        ],
      }),
      // 2 angefangene Minuten x 50 ct = 100 ct = die Decke. Kein /voice/outbound vorab:
      // markAnswered wuerde answeredAt auf "jetzt" setzen und den Live-Term loeschen.
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

test("KS-P2-12: Shim - der Live-Verbrauch loest killCallForBudget aus, ohne agentTurn zu rufen", async () => {
  const startedAt = isoAgo(TWO_MINUTE_LEG_MS);
  const call = shim.makeCall({ tenantId: TENANT, startedAt, answeredAt: startedAt });
  const s = stateWith({ capCents: 100, legs: [call] });
  // Der Harness-Fake liefert die Shim-Kanten (getCallByControlId, Settlement-Spies); die
  // zwei Geld-Kanten fuehren in die ECHTEN ops-Funktionen (kein Nachbau im Test).
  const store = { ...shim.fakeStore({ call }), ...storeOver(s) };
  const voiceControl = shim.voiceControlSpy();
  const agentTurn = shim.agentTurnSpy();
  const res = shim.fakeRes();

  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    await shim.makeHandler({ store, agentTurn, voiceControl })(shim.validReq(call), res);
  } finally {
    console.warn = original;
  }

  assert.equal(shim.sseContent(res), localeFor("de").budgetExhaustedHangup);
  assert.deepEqual(voiceControl.calls, [{ provider: "telnyx", callControlId: "cc_1" }]);
  assert.deepEqual(agentTurn.calls, [], "kein Token verbrannt");
  assert.deepEqual(store.settlementCalls, [], "Settlement bleibt allein bei P4.5 onHangup");
  const gateLines = lines.filter((l) => l.includes("[telnyx-shim] gate"));
  assert.equal(gateLines.length, 1);
  assert.match(gateLines[0], /"reason":"budget_tenant"/);
});
