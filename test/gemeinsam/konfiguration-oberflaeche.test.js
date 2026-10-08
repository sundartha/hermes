import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_NAMESPACES,
  config,
  gatewayUrlForPort,
  isSelfServiceLive,
  resolveGatewayUrl,
} from "../../src/config.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const EXPECTED_NAMESPACE_COUNTS = {
  safety: 17,
  billing: 56,
  provisioning: 17,
  auth: 18,
  mail: 7,
  llm: 17,
  telnyx: 1,
  voice: 18,
  telephony: 8,
  tenancy: 13,
  server: 10,
  store: 3,
  metrics: 1,
  privacy: 3,
  research: 7,
  werkzeug: 1,
};
const EXPECTED_TOTAL_KEYS = 197;

test("Struktur: CONFIG_NAMESPACES hat genau die gepinnten Counts und disjunkte Blaetter", () => {
  assert.deepEqual(
    Object.keys(CONFIG_NAMESPACES).sort(),
    Object.keys(EXPECTED_NAMESPACE_COUNTS).sort(),
  );
  for (const [namespace, count] of Object.entries(EXPECTED_NAMESPACE_COUNTS)) {
    assert.equal(
      CONFIG_NAMESPACES[namespace].length,
      count,
      `Namespace ${namespace} soll ${count} Keys haben`,
    );
  }
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  assert.equal(allNamespacedKeys.length, EXPECTED_TOTAL_KEYS, "Summe aller Namespace-Counts");
  assert.equal(
    new Set(allNamespacedKeys).size,
    EXPECTED_TOTAL_KEYS,
    "kein Key darf in zwei Namespaces gleichzeitig stehen",
  );
});

test("Oberflaeche: config traegt GENAU die gepinnten Namespaces (enumerable UND ueber 'in' erreichbar), kein flacher Key mehr", () => {
  assert.equal(new Set(Object.keys(config)).size, Object.keys(CONFIG_NAMESPACES).length);
  assert.deepEqual(Object.keys(config).sort(), Object.keys(CONFIG_NAMESPACES).sort());
  for (const namespace of Object.keys(CONFIG_NAMESPACES)) {
    assert.ok(namespace in config, `${namespace} muss ueber 'in' erreichbar sein`);
  }
});

const NUMERIC_SENTINEL_OFFSET = 12345;

function sentinelFor(currentValue) {
  if (typeof currentValue === "boolean") return !currentValue;
  if (typeof currentValue === "number") return currentValue + NUMERIC_SENTINEL_OFFSET;
  return "__pa12_override_sentinel__";
}

test("Setter-Durchschlag: ein Override ueber config.<ns>.<key> trifft fuer JEDES primitive Blatt denselben Speicher-Slot", () => {
  let checked = 0;
  for (const [namespace, keys] of Object.entries(CONFIG_NAMESPACES)) {
    for (const key of keys) {
      const currentValue = config[namespace][key];
      if (currentValue && typeof currentValue === "object") continue;
      checked += 1;
      const sentinel = sentinelFor(currentValue);
      withConfigOverrides({ [key]: sentinel }, () => {
        assert.strictEqual(
          config[namespace][key],
          sentinel,
          `${namespace}.${key} muss den Override live sehen (kein Wert-Kopie-Getter)`,
        );
      });
      assert.strictEqual(config[namespace][key], currentValue, `${namespace}.${key} restauriert`);
    }
  }
  const EXPECTED_PRIMITIVE_LEAVES = 183;
  assert.equal(
    checked,
    EXPECTED_PRIMITIVE_LEAVES,
    `alle primitiven Blaetter (${EXPECTED_TOTAL_KEYS} - 7 Arrays - 7 nested Objekte) geprueft`,
  );
});

test("No-double-eval: ein ungueltiger numerischer Env-Wert erzeugt genau EINEN Fatal-Befund, auch nach voller Namespace-Traversierung", async () => {
  const saved = process.env.MAX_CALLS_PER_HOUR;
  process.env.MAX_CALLS_PER_HOUR = "120abc";
  try {
    const fresh = await import("../../src/config.js?pa12-nodbl");
    const before = fresh.configFatalErrors().length;
    for (const [namespace, keys] of Object.entries(fresh.CONFIG_NAMESPACES)) {
      for (const key of keys) void fresh.config[namespace][key];
    }
    JSON.stringify(fresh.config);
    const after = fresh.configFatalErrors().length;
    assert.equal(after, before, "keine zusaetzlichen Fatal-Befunde durch den Namespace-Zugriff");
    assert.ok(
      fresh.configFatalErrors().some((msg) => msg.includes("MAX_CALLS_PER_HOUR")),
      "der urspruengliche Fatal-Befund muss weiter vorhanden sein",
    );
  } finally {
    if (saved === undefined) delete process.env.MAX_CALLS_PER_HOUR;
    else process.env.MAX_CALLS_PER_HOUR = saved;
  }
});

test("Duck-Typing + Guard: JSON.stringify/await funktionieren auf den Namespace-Gruppen, unbekannte Keys werfen weiter", async () => {
  assert.doesNotThrow(() => JSON.stringify(config.safety));
  assert.deepEqual(JSON.parse(JSON.stringify(config.safety)), config.safety);

  const awaited = await config.safety;
  assert.equal(awaited.maxCallsPerHour, config.safety.maxCallsPerHour);

  assert.throws(() => config.safety.nope, TypeError);

  assert.equal(typeof config.voice.elevenLabsPlayTts.model, "string");
  assert.throws(() => config.voice.elevenLabsPlayTts.nope, TypeError);
});

test("Flip-Regression: entfernte flache Keys werfen TypeError bei Read UND Write", () => {
  const removedFlatKeys = [
    "platformSpendCapCents",
    "maxCallsPerHour",
    "mcpAuth",
    "storeBackend",
    "telnyxElevenLabs",
    "telnyxAssistant",
    "elevenLabsPlayTts",
    "anthropicApiKey",
  ];
  for (const key of removedFlatKeys) {
    assert.throws(() => config[key], TypeError, `config.${key} (Read) sollte nicht mehr existieren`);
    assert.throws(
      () => {
        config[key] = "x";
      },
      TypeError,
      `config.${key} = ... (Write) sollte nicht mehr moeglich sein`,
    );
  }
});

const MONEY_CONFIG_KEYS = Object.freeze([
  "platformSpendCapCents",
  "numberSetupFeeCents",
  "voiceTariffDomesticCents",
  "voiceTariffDefaultCents",
  "voiceTariffInboundCents",
  "voiceTariffFullCostFloorCents",
  "defaultTenantBudgetCents",
  "smsCostCents",
  "usdToEur",
  "modelPricesUsd",
  "numberMonthlyCostCents",
  "platformFixedCostUsdCentsPerMonth",
  "voiceTariffGrundbetragCentsJeRoute",
  "researchSearchFeeCents",
  "lookupSearchFeeCents",
]);

const MONEY_NAME_PATTERN = /(Cents|Eur|Usd)$/;

test("Geld-Manifest: jedes Cents-/Eur-/Usd-Feld in config.js ist im Manifest erfasst", () => {
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  const moneyShapedKeys = allNamespacedKeys.filter((k) => MONEY_NAME_PATTERN.test(k));
  const unregistered = moneyShapedKeys.filter((k) => !MONEY_CONFIG_KEYS.includes(k));
  assert.deepEqual(
    unregistered,
    [],
    `Neues Geld-Feld in config.js nicht im Manifest eingetragen: ${unregistered.join(", ")}. ` +
      `Bewusst in MONEY_CONFIG_KEYS (test/gemeinsam/konfiguration-oberflaeche.test.js) aufnehmen.`,
  );
});

test("Geld-Manifest: kein gelistetes Feld wurde stillschweigend aus config.js entfernt", () => {
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  const missing = MONEY_CONFIG_KEYS.filter((k) => !allNamespacedKeys.includes(k));
  assert.deepEqual(
    missing,
    [],
    `Manifest-Feld existiert nicht mehr in config.js: ${missing.join(", ")}. Manifest nachziehen.`,
  );
});

const BEISPIEL_PORT = 3000;

test("gatewayUrlForPort baut die localhost-Fallback-URL", () => {
  assert.equal(gatewayUrlForPort(BEISPIEL_PORT), "http://localhost:3000");
  assert.equal(gatewayUrlForPort(0), "http://localhost:0");
});

test("resolveGatewayUrl: ohne GATEWAY_URL -> Fallback auf den config-Port", () => {
  const prev = process.env.GATEWAY_URL;
  try {
    delete process.env.GATEWAY_URL;
    assert.equal(resolveGatewayUrl(), gatewayUrlForPort(config.server.port));
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

test("resolveGatewayUrl: mit GATEWAY_URL -> genau dieser Wert, Trailing-Slash gestrippt", () => {
  const prev = process.env.GATEWAY_URL;
  try {
    process.env.GATEWAY_URL = "https://hermes.example.test/";
    assert.equal(resolveGatewayUrl(), "https://hermes.example.test");
    process.env.GATEWAY_URL = "https://hermes.example.test";
    assert.equal(resolveGatewayUrl(), "https://hermes.example.test");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

test("isSelfServiceLive: beide Flags an -> true", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: true } }), true);
});

test("isSelfServiceLive: nur selfServiceEnabled an -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: false } }), false);
});

test("isSelfServiceLive: nur multiTenant an -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: true } }), false);
});

test("isSelfServiceLive: beide Flags aus -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: false } }), false);
});

test("isSelfServiceLive: liefert immer einen echten Boolean (kein truthy-Objekt-Leak)", () => {
  assert.strictEqual(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: true } }), true);
  assert.strictEqual(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: false } }), false);
});
