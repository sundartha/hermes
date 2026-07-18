// PA-12 (config-Hub-Entschaerfung): Unit-Test fuer die zweite, verschachtelte
// Zugriffs-Oberflaeche (CONFIG_NAMESPACES + attachNamespaces in src/config.js).
// Reiner Unit-Test, offline, kein Server-Spawn (Muster config-shape.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, CONFIG_NAMESPACES, configFatalErrors } from "../src/config.js";
import { makeConfigOverrides } from "./helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

// EINE Quelle (G5) fuer die 13 erwarteten Namespace-Groessen (OQ-3, PLAN-POLISH-A.md).
const EXPECTED_NAMESPACE_COUNTS = {
  safety: 10,
  billing: 15,
  provisioning: 11,
  auth: 15,
  llm: 11,
  telnyx: 2,
  voice: 10,
  telephony: 8,
  tenancy: 5,
  server: 7,
  store: 3,
  metrics: 1,
  privacy: 1,
};
const EXPECTED_TOTAL_KEYS = 99;

test("Struktur: CONFIG_NAMESPACES hat genau die 13 gepinnten Counts und deckt disjunkt die Flach-Oberflaeche (99 Keys)", () => {
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
  const flatKeys = Object.getOwnPropertyNames(config).filter((k) => !(k in CONFIG_NAMESPACES));
  assert.deepEqual(
    new Set(allNamespacedKeys),
    new Set(flatKeys),
    "die Karte deckt exakt die Flach-Oberflaeche ab (keine erfundenen/vergessenen Keys)",
  );
});

test("Default-Alias-Gleichheit: config.<ns>.<key> liefert denselben Wert wie config.<flatKey> fuer alle 99 Keys", () => {
  for (const [namespace, keys] of Object.entries(CONFIG_NAMESPACES)) {
    for (const key of keys) {
      const viaFlat = config[key];
      const viaNamespace = config[namespace][key];
      // Der Proxy-Guard mintet pro Zugriff auf eine verschachtelte Gruppe eine frische
      // Huelle (bewusst ohne Memoisierung, s. guardedConfig-Kommentar) -> === waere fuer
      // Nested-Objekte selbst flat-vs-flat false. Arrays/Primitive bleiben identisch.
      const isNestedObject =
        viaFlat && typeof viaFlat === "object" && !Array.isArray(viaFlat);
      if (isNestedObject) {
        assert.deepEqual(viaNamespace, viaFlat, `${namespace}.${key} (nested)`);
      } else {
        assert.strictEqual(viaNamespace, viaFlat, `${namespace}.${key}`);
      }
    }
  }
});

// Sentinel-Wahl typabhaengig, damit der neue Wert garantiert vom Default abweicht.
function sentinelFor(currentValue) {
  if (typeof currentValue === "boolean") return !currentValue;
  if (typeof currentValue === "number") return currentValue + 12345;
  return "__pa12_override_sentinel__";
}

test("PM-1: ein Override auf dem Flach-Pfad schlaegt fuer JEDES primitive Blatt auf config.<ns>.<key> durch", () => {
  let checked = 0;
  for (const [namespace, keys] of Object.entries(CONFIG_NAMESPACES)) {
    for (const key of keys) {
      const currentValue = config[key];
      // Arrays/nested Objekte sind hier nicht das Ziel: PM-1 beweist die Getter-statt-
      // Kopie-Eigenschaft an den primitiven Blaettern (93 von 99), die per Object.assign
      // direkt ueberschrieben werden.
      if (currentValue && typeof currentValue === "object") continue;
      checked += 1;
      const sentinel = sentinelFor(currentValue);
      withConfigOverrides({ [key]: sentinel }, () => {
        assert.strictEqual(
          config[namespace][key],
          sentinel,
          `${namespace}.${key} muss den Flach-Override live sehen (kein Wert-Kopie-Getter)`,
        );
      });
      // Restore-Assertion: nach withConfigOverrides zeigt der Namespace wieder den
      // urspruenglichen Wert (derselbe rawConfig-Speicherort, kein haengengebliebener Zustand).
      assert.strictEqual(config[namespace][key], currentValue, `${namespace}.${key} restauriert`);
    }
  }
  assert.equal(checked, 93, "alle primitiven Blaetter (99 - 3 Arrays - 3 nested Objekte) geprueft");
});

test("No-double-eval: ein ungueltiger numerischer Env-Wert erzeugt genau EINEN Fatal-Befund, auch nach voller Namespace-Traversierung", async () => {
  const saved = process.env.MAX_CALLS_PER_HOUR;
  process.env.MAX_CALLS_PER_HOUR = "120abc";
  try {
    const fresh = await import("../src/config.js?pa12-nodbl");
    const before = fresh.configFatalErrors().length;
    // Volle Namespace-Oberflaeche + JSON.stringify beruehren - ein Getter, der numEnv/
    // boolEnv NOCHMAL aufriefe, wuerde hier einen zweiten Fatal-Push produzieren.
    for (const [namespace, keys] of Object.entries(fresh.CONFIG_NAMESPACES)) {
      for (const key of keys) void fresh.config[namespace][key];
    }
    JSON.stringify(fresh.config);
    const after = fresh.configFatalErrors().length;
    assert.equal(after, before, "keine zusaetzlichen Fatal-Befunde durch den Namespace-Zugriff");
    assert.ok(
      fresh.configFatalErrors().some((e) => e.includes("MAX_CALLS_PER_HOUR")),
      "der urspruengliche Fatal-Befund muss weiter vorhanden sein",
    );
  } finally {
    if (saved === undefined) delete process.env.MAX_CALLS_PER_HOUR;
    else process.env.MAX_CALLS_PER_HOUR = saved;
  }
});

test("Duck-Typing + Guard: JSON.stringify/await funktionieren auf den neuen Gruppen, unbekannte Keys werfen weiter", async () => {
  assert.doesNotThrow(() => JSON.stringify(config.safety));
  assert.deepEqual(JSON.parse(JSON.stringify(config.safety)), config.safety);

  const awaited = await config.safety;
  assert.equal(awaited.maxCallsPerHour, config.maxCallsPerHour);

  assert.throws(() => config.safety.nope, TypeError);

  // Nested-Blatt-Konsistenz: elevenLabsPlayTts bleibt ein eigenstaendiges nested Objekt
  // INNERHALB voice (OQ-6), NICHT in voice-Blaetter aufgeloest.
  assert.equal(config.voice.elevenLabsPlayTts.model, config.elevenLabsPlayTts.model);
  assert.throws(() => config.voice.elevenLabsPlayTts.nope, TypeError);
});

test("Flach-Oberflaeche unveraendert: 99 enumerable Keys, Namespaces nur ueber 'in' erreichbar (kein Blast-Radius auf Object.keys/JSON.stringify)", () => {
  assert.equal(Object.keys(config).length, EXPECTED_TOTAL_KEYS);
  for (const namespace of Object.keys(CONFIG_NAMESPACES)) {
    assert.ok(!Object.keys(config).includes(namespace), `${namespace} darf nicht enumerable sein`);
    assert.ok(namespace in config, `${namespace} muss ueber 'in' erreichbar sein`);
  }
});
