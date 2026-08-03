// PA-12 (config-Hub-Entschaerfung): Unit-Test fuer die verschachtelte Zugriffs-Oberflaeche
// (CONFIG_NAMESPACES + attachNamespaces in src/config.js). Reiner Unit-Test, offline, kein
// Server-Spawn (Muster config-shape.test.js).
// PA-20 (Flip): die 14 Namespaces sind die EINZIGE Oberflaeche - kein dual-read mehr. Die
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
  // KS-P3 (b): maxCallDurationS ENTFAELLT (E2/E3 - keine feste Maximaldauer mehr, die Frist
  // faellt pro Call aus dem Restguthaben) -> 10.
  safety: 10,
  // P6 (Budget-Achsen, Fruehwarnung): platformSpendWarnPercent + platformAlertSmsTo
  // ergaenzt (Fruehwarn-Schwelle + Betreiber-SMS-Ziel) -> 17 statt 15.
  // P7 (Budget-Achsen, Der Flip): budgetMonthEnabled ergaenzt (Spend-Monat-Flag) -> 18.
  // P1 (Live-Cost-Tracing): providerCurrency ergaenzt (Waehrung der Provider-CDR) -> 19.
  // P2 (Live-Cost-Tracing): providerToBucketRateMicro ergaenzt (Kurs Provider->Bucket) -> 20.
  // P3 (Live-Cost-Tracing): sieben Kosten-Abgleich-Felder ergaenzt (costTruingDelayMinutes,
  // costTruingMaxAttempts, costTruingRequiredRecordTypes, costTruingMinCoveragePercent,
  // costTruingCoverageStallSweeps, costDriftWarnPercent, costAlertDebounceMs) -> 27.
  // P5 (Live-Cost-Tracing, Drift-Waechter): costCalibrationMinSamples ergaenzt -> 28.
  // P4b (Live-Cost-Tracing, Vollkosten-Boot-Guard): voiceTariffFullCostFloorCents ergaenzt -> 29.
  // P6 (Live-Cost-Tracing, Tenant-Decken aus dem Abo): voiceCapRateCentsPerMin ergaenzt -> 30.
  // P7 (Live-Cost-Tracing, Fixkosten sichtbar machen): fuenf Felder ergaenzt
  // (ttsCharacterQuota, ttsCharacterQuotaWarnPercent, ttsQuotaCycleAnchorDay,
  // platformFixedCostCentsPerMonth, numberMonthlyCostCents) -> 35.
  // KE-P6B: costTruingSweepIntervalMs ergaenzt (Sweep-Kadenz als Env statt Modul-Konstante) -> 36.
  // KS-P5a: voiceCapRateCentsPerMin entfaellt (E5a, ein Satz) -> 35.
  // KV-P0: flushEpochIso ergaenzt (Flush-Stichtag, verriegelt POST /api/billing/flush-meters) -> 36.
  // KV-P2: voiceTariffInboundCents ergaenzt (Inbound-Minutensatz, kalibriert an KV-M1) -> 37.
  billing: 37,
  // GAP-38 (P7): bootstrapE164 + bootstrapProvider ergaenzt (Deploy-Bootstrap-Parameter,
  // die der Boot statt des entfallenen preDeployCommand liest) -> 13.
  // Review-Fix (P10, Runde 1): worldDefaultLanguageEnabled ergaenzt (Env-Schalter fuer
  // den Weltdefault-Flip, s. src/store/defaults.js) -> 14.
  provisioning: 14,
  auth: 15,
  // P7a: die vormals zwei globalen Preis-Skalare (Input/Output pro 1M Tokens) sind zu
  // einer Preistabelle pro Modell-ID zusammengefasst (modelPricesUsd, 1 nested Key statt
  // 2 primitiver Keys) -> 10 statt 11.
  // P8: briefingModel + briefingTimeoutMs ergaenzt (Pre-Call-Briefing-Modell + -Timeout) -> 12.
  llm: 12,
  telnyx: 2,
  // AL-P7b: thinkingSignalEnabled ergaenzt (Denk-Signal-Flag) -> 11.
  voice: 11,
  // GAP-21: machineDetection ergaenzt (1 nested Key statt zweier primitiver) -> 9.
  telephony: 9,
  // P8: precallBriefingEnabled ergaenzt (Pre-Call-Briefing-Flag) -> 6.
  // AL-P13: consultEnabled ergaenzt (Consult-Kanal am Call, Default aus) -> 7.
  // AL-P14: inCallConsultEnabled ergaenzt (Rueckfrage IM Gespraech, Default aus) -> 8.
  tenancy: 8,
  // P1 (i18n-Fix): deployedCommit ergaenzt (Deploy-Commit fuer /healthz + Boot-Banner) -> 8.
  server: 8,
  store: 3,
  metrics: 1,
  // P2b: diagnosticRetentionDays ergaenzt (Diagnose-Retention-Frist, eigene Namespace-Zeile).
  // AL-P11: evidenceRetentionDays ergaenzt (kurze Frist der Ergebnis-Karten-Zitate) -> 3.
  privacy: 3,
  // AL-P10: researchEnabled + researchMaxUses + researchSearchFeeCents (Vorab-Recherche
  // im Pre-Call-Briefing, src/research/) - eigene Namespace-Zeile.
  // AL-P10b: lookupEnabled + lookupSearchFeeCents + exaApiKey + exaApiBase (Nachschlagen
  // IM Gespraech, src/research/in-call.js; Anbieter-Tausch AL-P10c, Anzahl
  // unveraendert) -> 7.
  research: 7,
};
const EXPECTED_TOTAL_KEYS = 140;

test("Struktur: CONFIG_NAMESPACES hat genau die 14 gepinnten Counts und disjunkte Blaetter (140 Keys)", () => {
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

test("Oberflaeche: config traegt GENAU die 14 Namespaces (enumerable UND ueber 'in' erreichbar), kein flacher Key mehr", () => {
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
  // P7: budgetMonthEnabled ist ebenfalls primitiv (Boolean, kein Array/nested Objekt) -> 99.
  // P1 (Live-Cost-Tracing): providerCurrency ist ebenfalls primitiv (String) -> 100.
  // P2 (Live-Cost-Tracing): providerToBucketRateMicro ist ebenfalls primitiv (Zahl) -> 101.
  // P3 (Live-Cost-Tracing): sechs der sieben neuen Felder sind primitiv (Zahl) -> 107.
  // costTruingRequiredRecordTypes ist das VIERTE Array (kein primitives Blatt, s.u.).
  // P5 (Live-Cost-Tracing, Drift-Waechter): costCalibrationMinSamples ist primitiv (Zahl) -> 108.
  // P4b (Live-Cost-Tracing, Vollkosten-Boot-Guard): voiceTariffFullCostFloorCents ist
  // primitiv (Zahl, kein Array/nested Objekt) -> 109.
  // P6 (Live-Cost-Tracing, Tenant-Decken aus dem Abo): voiceCapRateCentsPerMin ist
  // primitiv (Zahl, kein Array/nested Objekt) -> 110.
  // P7 (Live-Cost-Tracing, Fixkosten sichtbar machen): alle fuenf neuen Felder sind
  // primitiv (Zahl, kein Array/nested Objekt) -> 115.
  // KE-P6B: costTruingSweepIntervalMs ist primitiv (Zahl) -> 116.
  // P1 (i18n-Fix, GAP-36): deployedCommit ist primitiv (String) -> 117.
  // GAP-21: machineDetection ist ein NEUES nested Objekt (kein primitives Blatt) -> checked
  // bleibt 117, nur die Nested-Objekt-Zahl in der Assertion unten steigt.
  // GAP-38 (P7): bootstrapE164 + bootstrapProvider sind primitiv (String) -> 119.
  // Review-Fix (P10, Runde 1): worldDefaultLanguageEnabled ist primitiv (Boolean) -> 120.
  // AL-P10: researchEnabled/researchMaxUses/researchSearchFeeCents sind alle drei
  // primitiv (Boolean/Zahl/Zahl, kein Array/nested Objekt) -> 123.
  // AL-P11: evidenceRetentionDays ist primitiv (Zahl, kein Array/nested Objekt) -> 124.
  // AL-P13: consultEnabled ist primitiv (Boolean, kein Array/nested Objekt) -> 125.
  // KS-P5a: voiceCapRateCentsPerMin entfaellt (E5a, ein Satz) -> 124.
  // AL-P14: inCallConsultEnabled ist primitiv (Boolean, kein Array/nested Objekt) -> 124.
  // AL-P7b: thinkingSignalEnabled ist primitiv (Boolean, kein Array/nested Objekt) -> 125.
  // AL-P10b: lookupEnabled/lookupSearchFeeCents/exaApiKey/exaApiBase (Anbieter-Tausch
  // AL-P10c, Anzahl unveraendert) sind alle vier primitiv
  // (Boolean/Zahl/String/String) -> 129.
  // KV-P0: flushEpochIso ist primitiv (String | null - null ist falsy, faellt also nicht
  // in den object-Nested-Zweig, kein Array/nested Objekt) -> 130.
  // KV-P2: voiceTariffInboundCents ist primitiv (Zahl, kein Array/nested Objekt) -> 131.
  assert.equal(checked, 131, "alle primitiven Blaetter (140 - 4 Arrays - 5 nested Objekte) geprueft");
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
