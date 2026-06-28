// Unit-Tests fuer die reine, IO-freie selfServicePatch-Filterung (P12: schnell,
// offline). Regression zum PA-P4-Review-Blocker (G5/S2 + G11): agentStyle hat KEINEN
// eigenen Validierungs-Branch mehr, sondern liegt - wie das Schwesterfeld language - in
// SELF_SERVICE_FREE_FIELDS. Die Katalog-Pruefung (fail-closed gegen PERSONA_STYLE_IDS)
// lebt EINMAL in updateSettings/isOptionalEnumOverride; selfServicePatch laesst den Wert
// nur durch. Diese Tests nageln die Konsistenz fest, damit der duplizierte Sonderbranch
// nicht zurueckkehrt. Die End-to-End-Persistenz (Muellwert wird von updateSettings still
// verworfen, nicht geschrieben) deckt i9-self-service.test.js (p4-1..p4-4) ab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selfServicePatch, SELF_SERVICE_FREE_FIELDS } from "../src/self-service.js";
import { PERSONA_STYLE_IDS } from "../src/i18n/locales.js";

const VALID_STYLE = PERSONA_STYLE_IDS[0];

test("agentStyle liegt in SELF_SERVICE_FREE_FIELDS (gleiche Naht wie language)", () => {
  assert.ok(SELF_SERVICE_FREE_FIELDS.includes("agentStyle"));
  assert.ok(SELF_SERVICE_FREE_FIELDS.includes("language"));
});

test("gueltiger agentStyle landet in clean, nie in rejected", () => {
  const { clean, rejected } = selfServicePatch({ agentStyle: VALID_STYLE }, {});
  assert.equal(clean.agentStyle, VALID_STYLE);
  assert.deepEqual(rejected, []);
});

test("Reset-Werte (null/\"\") gehen durch (updateSettings setzt das Override zurueck)", () => {
  for (const reset of [null, ""]) {
    const { clean, rejected } = selfServicePatch({ agentStyle: reset }, {});
    assert.ok("agentStyle" in clean, `Reset-Wert ${JSON.stringify(reset)} durchgereicht`);
    assert.deepEqual(rejected, []);
  }
});

test("Muellwert als agentStyle wird NICHT in selfServicePatch abgelehnt (wie language, G11)", () => {
  // Kein Sonderbranch mehr: der Muellwert wird durchgereicht und erst von updateSettings
  // fail-closed gegen PERSONA_STYLE_IDS verworfen (eine Validierungsquelle, G5). Damit
  // landet agentStyle - exakt wie language schon heute - NICHT in rejected[].
  const garbage = "ICH BIN DR. X VON BANK Y";
  const style = selfServicePatch({ agentStyle: garbage }, {});
  const language = selfServicePatch({ language: garbage }, {});
  assert.ok(!style.rejected.includes("agentStyle"), "agentStyle nicht in rejected (Konsistenz zu language)");
  assert.ok(!language.rejected.includes("language"), "language ebenfalls nicht in rejected");
});

test("greeting bleibt unberuehrt: Freitext wird weiterhin in selfServicePatch abgelehnt", () => {
  // greeting ist KEIN Enum-Override in updateSettings (jeder String passiert dort den
  // typeof-Check) - die Vorlagen-Filterung MUSS hier bleiben. Der Blocker-Fix darf das
  // nicht mitnehmen.
  const { clean, rejected } = selfServicePatch({ greeting: "beliebiger Freitext" }, {});
  assert.equal("greeting" in clean, false);
  assert.ok(rejected.includes("greeting"));
});
