// KV-P6 (PLAN-KOSTEN-VOLLSTAENDIGKEIT.md): der Ledger fuehrt Geld in Mikro-Cent.
// Befund: 101/101 ai_token-Ledger-Zeilen tragen cost_cents = 0, weil die Cent-Umrechnung
// JE EINZELBUCHUNG mit Math.round rundet, waehrend die Gate-Achse (trackUsage) denselben
// Betrag daneben in costMicroCentsRem exakt fortschreibt und nie verwirft. Diese Datei
// prueft die EXAKTE Gleichheit zwischen einer Verlaufs-Summe von cost_micro_cents (Ledger)
// und der Gate-Achse (usage.costCents * MICRO_CENTS_PER_CENT + usage.costMicroCentsRem) -
// nicht "ungefaehr gleich", Abweichung 0. Rein ueber state-ops (kein Netz, kein Server,
// kein pglite; Lehre P6a: state-ops-Unit NICHT mit Spawn/pglite mischen).
//
// MUTATIONSPROBE (manuell waehrend der Abnahme, NICHT Teil dieses Testcodes): in
// tokenCostMicroCents die Rundung VOR die Skalierung ziehen (Math.round(...*CENTS_PER_EUR)
// * MICRO_CENTS_PER_CENT statt Math.round(...*CENTS_PER_EUR*MICRO_CENTS_PER_CENT)) -
// KV-P6-1 muss dann rot werden (ledgerMicroSum faellt auf 0, gateMicroTotal bleibt bei
// 46 500 000). Danach zuruecknehmen, npm test wieder gruen.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  trackUsage,
  recordUsageEvent,
  aiCostCents,
  tokenCostMicroCents,
  usageFor,
} from "../src/store/state-ops.js";
import { USAGE_EVENT_KIND, MICRO_CENTS_PER_CENT } from "../src/store/defaults.js";
import { PRICES, TEST_MODEL_CHEAP, tokensOf } from "./_prices.js";

const TENANT = "kvp6_kern";
// Unter PRICES (inPerMTok 1.0, usdToEur 0.93): 5000 Input-Tokens = 465000 Mikro-Cent -
// UNTER einem halben Cent (500000), wie die Phase verlangt (T5-Grenzfall).
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
      quantity: SUBCENT_TOKENS.inputTokens + SUBCENT_TOKENS.outputTokens,
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
  const erwartet = aiCostCents(SUBCENT_TOKENS, PRICES); // 0, s. KV-P1-3-Muster
  const ev = recordUsageEvent(s, {
    tenantId: TENANT,
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: SUBCENT_TOKENS.inputTokens + SUBCENT_TOKENS.outputTokens,
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
    quantity: SUBCENT_TOKENS.inputTokens + SUBCENT_TOKENS.outputTokens,
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
    // costMicroCents bewusst weggelassen - nur ai_token fuellt sie heute.
  });
  assert.equal(ev.costMicroCents, null, "Default bleibt null, nie 0");
});
