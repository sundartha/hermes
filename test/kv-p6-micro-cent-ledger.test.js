import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  trackUsage,
  recordUsageEvent,
  aiCostCents,
  tokenCostMicroCents,
  usageFor,
  inputTokensOf,
  globalUsageTotals,
  callCostEvidence,
  PLATFORM_TTS_COST_CENTER_ID,
  actualCostMicroCentsForMonth,
} from "../src/store/state-ops.js";
import { USAGE_EVENT_KIND, MICRO_CENTS_PER_CENT, PROVIDER } from "../src/store/defaults.js";
import { PRICES, TEST_MODEL_CHEAP, tokensOf } from "./_prices.js";

const TENANT = "kvp6_kern";
const SUBCENT_TOKENS = tokensOf(5000, 0, TEST_MODEL_CHEAP);
const TURNS = 100;

test("KV-P6-1 Kerntest: 100 Turns unterhalb eines halben Cents - Ledger-Summe cost_micro_cents EXAKT gleich der Gate-Achse (inkl. Cent-Uebertraegen)", () => {
  const s = makeDefaultState();
  let ledgerMicroSum = 0;
  for (let i = 0; i < TURNS; i++) {
    trackUsage(s, TENANT, SUBCENT_TOKENS, PRICES);
    const costMicroCents = tokenCostMicroCents(SUBCENT_TOKENS, PRICES);
    recordUsageEvent(s, {
      tenantId: TENANT,
      kind: USAGE_EVENT_KIND.AI_TOKEN,
      quantity: inputTokensOf(SUBCENT_TOKENS) + SUBCENT_TOKENS.outputTokens,
      costCents: aiCostCents(SUBCENT_TOKENS, PRICES),
      costMicroCents,
    });
    ledgerMicroSum += costMicroCents;
  }
  const usage = usageFor(s, TENANT);
  assert.ok(
    usage.costCents > 0,
    "Fixture muss mindestens einen vollen Cent-Uebertrag ausloesen, sonst prueft der Test nur den bereits belegten Trivialfall",
  );
  const gateMicroTotal = usage.costCents * MICRO_CENTS_PER_CENT + usage.costMicroCentsRem;
  assert.equal(
    ledgerMicroSum,
    gateMicroTotal,
    "Ledger-Summe (cost_micro_cents) muss EXAKT der Gate-Achse entsprechen - Abweichung 0, nicht 'ungefaehr'",
  );
});

test("KV-P6-2 cost_cents bleibt unveraendert (gerundeter Betrag, byte-identisch zum Bestand)", () => {
  const s = makeDefaultState();
  const erwartet = aiCostCents(SUBCENT_TOKENS, PRICES);
  const ev = recordUsageEvent(s, {
    tenantId: TENANT,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: inputTokensOf(SUBCENT_TOKENS) + SUBCENT_TOKENS.outputTokens,
    costCents: erwartet,
    costMicroCents: tokenCostMicroCents(SUBCENT_TOKENS, PRICES),
  });
  assert.equal(
    ev.costCents,
    erwartet,
    "costCents unveraendert - dieselbe Formel, derselbe Wert wie vor der Phase",
  );
});

test("KV-P6-3 Grenzfall: Betrag exakt 0", () => {
  const s = makeDefaultState();
  const NULL_TOKENS = tokensOf(0, 0, TEST_MODEL_CHEAP);
  const ev = recordUsageEvent(s, {
    tenantId: TENANT,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: 0,
    costCents: aiCostCents(NULL_TOKENS, PRICES),
    costMicroCents: tokenCostMicroCents(NULL_TOKENS, PRICES),
  });
  assert.equal(ev.costCents, 0);
  assert.equal(ev.costMicroCents, 0);
});

test("KV-P6-4 Grenzfall: Betrag rundet auf 0 Cent, traegt aber Mikro-Cent > 0 (der Kern des Befunds)", () => {
  const s = makeDefaultState();
  const ev = recordUsageEvent(s, {
    tenantId: TENANT,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: inputTokensOf(SUBCENT_TOKENS) + SUBCENT_TOKENS.outputTokens,
    costCents: aiCostCents(SUBCENT_TOKENS, PRICES),
    costMicroCents: tokenCostMicroCents(SUBCENT_TOKENS, PRICES),
  });
  assert.equal(ev.costCents, 0, "genau die 0, die den Befund ausloeste");
  assert.equal(ev.costMicroCents, 465000, "der Rest, den die 0 bisher verschluckte");
});

test("KV-P6-3b Grenzfall: fehlender Wert bleibt NULL (additiv-nullable), kein '0 statt unbekannt'", () => {
  const s = makeDefaultState();
  const ev = recordUsageEvent(s, {
    tenantId: TENANT,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 10,
  });
  assert.equal(ev.costMicroCents, null, "Default bleibt null, nie 0");
});

const ZWEITER_TENANT = "kvp6_zweiter";

test("KV-P6-Absicherung: globalUsageTotals summiert Token, Anrufe und Mikro-Cents ueber alle Mandanten", () => {
  const state = makeDefaultState();
  state.usage[TENANT] = {
    inputTokens: 10,
    outputTokens: 4,
    calls: 2,
    costCents: 3,
    costMicroCentsRem: 600_000,
  };
  state.usage[ZWEITER_TENANT] = {
    inputTokens: 5,
    outputTokens: 1,
    calls: 1,
    costCents: 2,
    costMicroCentsRem: 700_000,
  };
  assert.deepEqual(
    globalUsageTotals(state),
    {
      inputTokens: 15,
      outputTokens: 5,
      calls: 3,
      costCents: 6,
      costMicroCentsRem: 300_000,
    },
    "Summe aus 3,6 Cent und 2,7 Cent sind 6 Cent plus 300000 Mikro-Cent Rest",
  );
});

test("KV-P6-Absicherung: globalUsageTotals zaehlt einen Eimer ohne Rest als Rest 0", () => {
  const state = makeDefaultState();
  state.usage[TENANT] = { inputTokens: 1, outputTokens: 1, calls: 1, costCents: 4 };
  const summe = globalUsageTotals(state);
  assert.equal(summe.costCents, 4);
  assert.equal(summe.costMicroCentsRem, 0);
});

test("KV-P6-Absicherung: callCostEvidence liefert nur die Zeilen des Anrufs, nach Traeger sortiert", () => {
  const state = makeDefaultState();
  state.callCostEvidence.push(
    { callId: "call_a", traeger: "telnyx" },
    { callId: "call_b", traeger: "anthropic" },
    { callId: "call_a", traeger: "elevenlabs" },
  );
  assert.deepEqual(
    callCostEvidence(state, "call_a").map((zeile) => zeile.traeger),
    ["elevenlabs", "telnyx"],
  );
  assert.deepEqual(callCostEvidence(state, "call_unbekannt"), []);
});

test("KV-P6-Absicherung: die Plattform-Kostenstelle fuer Wiedergabe-TTS heisst platform:play-tts", () => {
  assert.equal(PLATFORM_TTS_COST_CENTER_ID, "platform:play-tts");
});

test("KV-P6-Absicherung: actualCostMicroCentsForMonth summiert nur belegte, nicht negative Telnyx-Kosten des Monats", () => {
  const MONAT = "2026-03";
  const VORMONAT = "2026-02";
  const ANRUF_KOSTEN = 1000;
  const state = makeDefaultState();
  const anruf = (aenderung) => ({
    provider: PROVIDER.TELNYX,
    costTruedAt: "2026-03-05T00:00:00.000Z",
    actualCostMicroCents: ANRUF_KOSTEN,
    estimatedCostSpendMonthKey: MONAT,
    ...aenderung,
  });
  state.calls.push(
    anruf({}),
    anruf({ actualCostMicroCents: 0 }),
    anruf({ actualCostMicroCents: -500 }),
    anruf({ provider: "elevenlabs" }),
    anruf({ costTruedAt: null }),
    anruf({ estimatedCostSpendMonthKey: VORMONAT }),
  );
  assert.equal(actualCostMicroCentsForMonth(state, MONAT), ANRUF_KOSTEN);
});
