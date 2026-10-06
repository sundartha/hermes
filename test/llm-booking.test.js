import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND } from "../src/store/defaults.js";

const ANTHROPIC_USAGE = Object.freeze({
  input_tokens: 5,
  cache_creation_input_tokens: 20,
  cache_read_input_tokens: 100,
  output_tokens: 7,
});
const BILLING_MODEL = "claude-haiku-4-5";
const USD_TO_EUR_MICRO = "920000";

const EXPECTED_MICRO_CENTS = 6900;
const EXPECTED_QUANTITY = 132;
const MICRO_CENTS_PER_CENT = 1_000_000;

const GATE_SCALE = 1_000_000;
const EXPECTED_GATE_CENTS = 6900;

const TENANT_CONTRACT = "b4a_vertrag";
const TENANT_ADAPTER = "b4a_adapter";
const TENANT_LEDGER = "b4a_ledger";
const TENANT_GATE = "b4a_gate";

let config, store, bookTokenUsage, createAnthropicProvider;

before(async () => {
  process.env.PAYMENT_ENABLED = "true";
  process.env.PROVIDER_TO_BUCKET_RATE_MICRO = USD_TO_EUR_MICRO;
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
  );
  config = (await import("../src/config.js")).config;
  store = await import("../src/store.js");
  ({ bookTokenUsage } = await import("../src/llm-usage.js"));
  ({ createAnthropicProvider } = await import("../src/llm/adapters/anthropic.js"));
});

function contractUsage(scale = 1) {
  return {
    inputUncachedTokens: ANTHROPIC_USAGE.input_tokens * scale,
    inputCacheWriteTokens: ANTHROPIC_USAGE.cache_creation_input_tokens * scale,
    inputCacheReadTokens: ANTHROPIC_USAGE.cache_read_input_tokens * scale,
    outputTokens: ANTHROPIC_USAGE.output_tokens * scale,
    estimated: false,
    billingModelId: BILLING_MODEL,
  };
}

function bookedMicroCents(tenantId) {
  const usage = store.usageOf(tenantId);
  return usage.costCents * MICRO_CENTS_PER_CENT + usage.costMicroCentsRem;
}

test("B4A-BUCH-1 (Attrappe): ein Turn nach dem Port-Vertrag bucht den von Hand gerechneten Betrag", async () => {
  const provider = {
    complete: async () => ({
      text: "",
      toolCalls: [],
      usage: contractUsage(),
      providerTurn: null,
      stopReason: "end_turn",
    }),
  };
  const turn = await provider.complete({ model: BILLING_MODEL, messages: [] });

  bookTokenUsage({ tenantId: TENANT_CONTRACT, callId: "b4a_call_vertrag", usage: turn.usage });

  assert.equal(
    bookedMicroCents(TENANT_CONTRACT),
    EXPECTED_MICRO_CENTS,
    "auf der Budget-Achse muss der je Token-Sorte gerechnete Betrag stehen, nicht die alte Faltung (14720)",
  );
});

test("B4A-BUCH-2 (Adapter Anthropic): dieselbe Rohantwort ergibt ueber den ECHTEN Adapter denselben Betrag", async () => {
  const provider = createAnthropicProvider({
    apiKey: "test-key-ohne-netz",
    requestTimeoutMs: 1000,
    messagesCreate: async () => ({ content: [], usage: { ...ANTHROPIC_USAGE } }),
  });
  const turn = await provider.complete({ model: BILLING_MODEL, messages: [] });

  assert.equal(turn.usage.estimated, false, "die Antwort meldet Verbrauch - keine Schaetzung");
  bookTokenUsage({ tenantId: TENANT_ADAPTER, callId: "b4a_call_adapter", usage: turn.usage });

  assert.equal(
    bookedMicroCents(TENANT_ADAPTER),
    EXPECTED_MICRO_CENTS,
    "die Kette Adapter -> Vertrag -> Buchung ist durchgemessen, nicht nur der Vertrag",
  );
});

test("B4A-BUCH-3 (Ledger-Achse): derselbe Betrag im Stripe-Beleg, die MENGE unveraendert", () => {
  bookTokenUsage({ tenantId: TENANT_LEDGER, callId: "b4a_call_ledger", usage: contractUsage() });

  const events = store
    .load()
    .usageEvents.filter(
      (e) => e.kind === USAGE_EVENT_KIND.AI_TOKEN && e.tenantId === TENANT_LEDGER,
    );
  assert.equal(events.length, 1, "genau ein ai_token-Beleg je Buchung");
  assert.equal(
    events[0].costMicroCents,
    EXPECTED_MICRO_CENTS,
    "Gate und Kundenbeleg lesen DIESELBE Formel",
  );
  assert.equal(
    events[0].quantity,
    EXPECTED_QUANTITY,
    "quantity ist die Stripe-MENGE (Summe aller Sorten) und aendert sich durch B4a NICHT",
  );
});

test("B4A-BUCH-4 (Regel 1): die pro-Tenant-Kostendecke greift auf dem NEU gerechneten Betrag", () => {
  store.setTenantBudget(TENANT_GATE, {
    budgetCents: EXPECTED_GATE_CENTS - 1,
    hardCapCents: EXPECTED_GATE_CENTS - 1,
  });
  assert.equal(
    store.budgetExceeded(TENANT_GATE, config.billing),
    false,
    "vor der Buchung ist der Tenant frei",
  );

  bookTokenUsage({
    tenantId: TENANT_GATE,
    callId: "b4a_call_gate",
    usage: contractUsage(GATE_SCALE),
  });

  assert.equal(
    store.usageOf(TENANT_GATE).costCents,
    EXPECTED_GATE_CENTS,
    "dieselbe Sortenmischung, um 1e6 skaliert - der Betrag steht in GANZEN Cents",
  );
  assert.equal(
    store.budgetExceeded(TENANT_GATE, config.billing),
    true,
    "die Decke ist durch den kleineren Betrag NICHT blind geworden",
  );
});
