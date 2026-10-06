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
} from "../src/store/state-ops.js";
import { USAGE_EVENT_KIND, MICRO_CENTS_PER_CENT } from "../src/store/defaults.js";
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
