// Struct-3 (C6a, PLAN-FRAGILITY-REMEDIATION.md P5): Proxy-Guard-Mechanismus + erste
// Feature-Gruppierung (telnyxAssistant). Reiner Unit-Test, offline, kein Server-Spawn,
// keine .env (Muster config-prod-footguns.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";

// Teil 1: Proxy-Guard-Mechanismus (unabhaengig von der telnyxAssistant-Migration -
// nutzt bereits bestehende Gruppen/Keys, damit dieser Block auch VOR jeder Migration
// beweiskraeftig ist).
test("Proxy-Guard: unbekannter Top-Level-Key wirft TypeError statt undefined", () => {
  assert.throws(() => config.doesNotExistTopLevel, TypeError);
});

test("Proxy-Guard: unbekannter verschachtelter Key wirft TypeError", () => {
  assert.throws(() => config.telnyxElevenLabs.doesNotExistNested, TypeError);
});

test("Proxy-Guard: legitimer Zugriff liefert weiterhin den echten Default-Wert", () => {
  assert.equal(typeof config.telnyxElevenLabs.model, "string");
  assert.equal(config.telnyxElevenLabs.model, "Default");
});

test("Proxy-Guard: Arrays bleiben unverpackte echte Arrays (keine Namens-Zugriffe)", () => {
  assert.ok(Array.isArray(config.allowedCountryCodes));
  assert.ok(config.allowedCountryCodes.includes("+49"));
});

test("Proxy-Guard: Symbol-Zugriffe werden NICHT bewacht (kein Crash bei util.inspect)", () => {
  assert.equal(config[Symbol.for("nichts")], undefined);
});

// Review-Blocker S1-1: JSON.stringify prueft intern value.toJSON, await/Promise pruefen
// value.then - beides normale property-Reads, die der Guard sonst als unbekannten Key
// missversteht und einen TypeError wirft statt zu serialisieren/aufzuloesen.
test("Proxy-Guard: JSON.stringify auf eine Config-Gruppe wirft nicht (toJSON-Duck-Typing)", () => {
  assert.doesNotThrow(() => JSON.stringify(config.telnyxAssistant));
  assert.deepEqual(JSON.parse(JSON.stringify(config.telnyxAssistant)), {
    enabled: false,
    assistantId: "",
    callControlAppId: "",
    shimMaxTurnsPerMin: 30,
    deadAirTimeoutS: 45,
    openingSpeakTimeoutS: 45,
    loopGuardMaxEmptyTurns: 8,
    shimSharedSecret: "",
    shimApiKeyRef: "",
    shimDebugShape: false,
  });
});

test("Proxy-Guard: JSON.stringify auf die Top-Level-Config wirft nicht (toJSON-Duck-Typing)", () => {
  assert.doesNotThrow(() => JSON.stringify(config));
});

test("Proxy-Guard: await/Promise.resolve auf eine Config-Gruppe wirft nicht (then-Duck-Typing)", async () => {
  const awaited = await config.telnyxAssistant;
  assert.equal(awaited.shimMaxTurnsPerMin, 30); // Objekt kommt unveraendert/lesbar durch
  const resolved = await Promise.resolve(config.telnyxAssistant);
  assert.equal(resolved.shimMaxTurnsPerMin, 30);
});

test("Proxy-Guard: then/toJSON bleiben fuer echte unbekannte Keys weiterhin bewacht", () => {
  assert.throws(() => config.telnyxAssistant.doesNotExistNested, TypeError);
});

// Teil 2: telnyxAssistant-Gruppierung (P5, erstes Feature-Grouping).
test("telnyxAssistant: alle 10 Keys existieren mit den dokumentierten Defaults (NODE_ENV=test, keine Env gesetzt)", () => {
  assert.equal(config.telnyxAssistant.enabled, false);
  assert.equal(config.telnyxAssistant.assistantId, "");
  assert.equal(config.telnyxAssistant.callControlAppId, "");
  assert.equal(config.telnyxAssistant.shimMaxTurnsPerMin, 30);
  assert.equal(config.telnyxAssistant.deadAirTimeoutS, 45);
  assert.equal(config.telnyxAssistant.openingSpeakTimeoutS, 45);
  assert.equal(config.telnyxAssistant.loopGuardMaxEmptyTurns, 8);
  assert.equal(config.telnyxAssistant.shimSharedSecret, "");
  assert.equal(config.telnyxAssistant.shimApiKeyRef, "");
  assert.equal(config.telnyxAssistant.shimDebugShape, false);
});

// Regression: der alte flache Pfad existiert NACHWEISLICH nicht mehr - waere er
// (versehentlich re-addiert) doch da, faellt dieser Test durch statt den Sinn der
// Migration stillschweigend zu unterlaufen.
test("telnyxAssistant: die 10 alten flachen Config-Pfade existieren nicht mehr", () => {
  const oldFlatKeys = [
    "telnyxAiAssistantEnabled",
    "telnyxAssistantId",
    "telnyxCallControlAppId",
    "telnyxShimMaxTurnsPerMin",
    "telnyxDeadAirTimeoutS",
    "telnyxOpeningSpeakTimeoutS",
    "telnyxLoopGuardMaxEmptyTurns",
    "telnyxShimSharedSecret",
    "telnyxShimApiKeyRef",
    "telnyxShimDebugShape",
  ];
  for (const key of oldFlatKeys) {
    assert.throws(() => config[key], TypeError, `config.${key} sollte nicht mehr existieren`);
  }
});
