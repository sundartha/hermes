// PA-12 (config-Hub-Entschaerfung): Unit-Test fuer die verschachtelte Zugriffs-Oberflaeche
// (CONFIG_NAMESPACES + attachNamespaces in src/config.js). Reiner Unit-Test, offline, kein
// Server-Spawn (Muster config-shape.test.js).
// PA-20 (Flip): die 13 Namespaces sind die EINZIGE Oberflaeche - kein dual-read mehr. Die
// alte Alias-Gleichheit/PM-1-Flach-Override-Tests entfallen (der Flach-Pfad existiert nicht
// mehr); an ihre Stelle tritt der Setter-Durchschlag-Test ueber makeConfigOverrides(config)
// und eine TypeError-Regression fuer entfernte flache Keys (Read UND Write).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config, CONFIG_NAMESPACES, configFatalErrors } from "../src/config.js";
import { makeConfigOverrides } from "./helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

// EINE Quelle (G5) fuer die 13 erwarteten Namespace-Groessen (OQ-3, PLAN-POLISH-A.md).
const EXPECTED_NAMESPACE_COUNTS = {
  // P3.1: capFarewellLeadMs ergaenzt (Cap-Vorlauf-Ansage vor dem harten Max-Dauer-Cap).
  safety: 11,
  // P6 (Budget-Achsen, Fruehwarnung): platformSpendWarnPercent + platformAlertSmsTo
  // ergaenzt (Fruehwarn-Schwelle + Betreiber-SMS-Ziel) -> 17 statt 15.
  billing: 17,
  provisioning: 11,
  auth: 15,
  // P7a: die vormals zwei globalen Preis-Skalare (Input/Output pro 1M Tokens) sind zu
  // einer Preistabelle pro Modell-ID zusammengefasst (modelPricesUsd, 1 nested Key statt
  // 2 primitiver Keys) -> 10 statt 11.
  // P8: briefingModel + briefingTimeoutMs ergaenzt (Pre-Call-Briefing-Modell + -Timeout) -> 12.
  llm: 12,
  telnyx: 2,
  voice: 10,
  telephony: 8,
  // P8: precallBriefingEnabled ergaenzt (Pre-Call-Briefing-Flag) -> 6.
  tenancy: 6,
  server: 7,
  store: 3,
  metrics: 1,
  // P2b: diagnosticRetentionDays ergaenzt (Diagnose-Retention-Frist, eigene Namespace-Zeile).
  privacy: 2,
};
const EXPECTED_TOTAL_KEYS = 105;

test("Struktur: CONFIG_NAMESPACES hat genau die 13 gepinnten Counts und disjunkte Blaetter (105 Keys)", () => {
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

test("Oberflaeche: config traegt GENAU die 13 Namespaces (enumerable UND ueber 'in' erreichbar), kein flacher Key mehr", () => {
  assert.equal(new Set(Object.keys(config)).size, Object.keys(CONFIG_NAMESPACES).length);
  assert.deepEqual(Object.keys(config).sort(), Object.keys(CONFIG_NAMESPACES).sort());
  for (const namespace of Object.keys(CONFIG_NAMESPACES)) {
    assert.ok(namespace in config, `${namespace} muss ueber 'in' erreichbar sein`);
  }
});

// Sentinel-Wahl typabhaengig, damit der neue Wert garantiert vom Default abweicht.
function sentinelFor(currentValue) {
  if (typeof currentValue === "boolean") return !currentValue;
  if (typeof currentValue === "number") return currentValue + 12345;
  return "__pa12_override_sentinel__";
}

test("Setter-Durchschlag: ein Override ueber config.<ns>.<key> trifft fuer JEDES primitive Blatt denselben Speicher-Slot", () => {
  let checked = 0;
  for (const [namespace, keys] of Object.entries(CONFIG_NAMESPACES)) {
    for (const key of keys) {
      const currentValue = config[namespace][key];
      // Arrays/nested Objekte sind hier nicht das Ziel: der Test beweist die Getter/Setter-
      // statt-Kopie-Eigenschaft an den primitiven Blaettern (93 von 100).
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
      // Restore-Assertion: nach withConfigOverrides zeigt der Namespace wieder den
      // urspruenglichen Wert (derselbe rawConfig-Speicherort, kein haengengebliebener Zustand).
      assert.strictEqual(config[namespace][key], currentValue, `${namespace}.${key} restauriert`);
    }
  }
  // P8: briefingModel/briefingTimeoutMs/precallBriefingEnabled sind alle drei primitiv
  // (kein neues Array, kein neues nested Objekt) -> 93 + 3 = 96.
  // P6: platformSpendWarnPercent/platformAlertSmsTo sind ebenfalls primitiv (Zahl/String,
  // kein Array/nested Objekt) -> 96 + 2 = 98.
  assert.equal(checked, 98, "alle primitiven Blaetter (105 - 3 Arrays - 4 nested Objekte) geprueft");
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

test("Duck-Typing + Guard: JSON.stringify/await funktionieren auf den Namespace-Gruppen, unbekannte Keys werfen weiter", async () => {
  assert.doesNotThrow(() => JSON.stringify(config.safety));
  assert.deepEqual(JSON.parse(JSON.stringify(config.safety)), config.safety);

  const awaited = await config.safety;
  assert.equal(awaited.maxCallsPerHour, config.safety.maxCallsPerHour);

  assert.throws(() => config.safety.nope, TypeError);

  // Nested-Blatt-Konsistenz: elevenLabsPlayTts bleibt ein eigenstaendiges nested Objekt
  // INNERHALB voice (OQ-6).
  assert.equal(typeof config.voice.elevenLabsPlayTts.model, "string");
  assert.throws(() => config.voice.elevenLabsPlayTts.nope, TypeError);
});

// PA-20 (Flip): der flache Pfad existiert NACHWEISLICH nicht mehr - fail-closed statt
// still-undefined. Stichprobe je betroffenem Namespace, Read UND Write (Set-Trap, §2.1).
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
