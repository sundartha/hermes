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
  const garbage = "ICH BIN DR. X VON BANK Y";
  const style = selfServicePatch({ agentStyle: garbage }, {});
  const language = selfServicePatch({ language: garbage }, {});
  assert.ok(!style.rejected.includes("agentStyle"), "agentStyle nicht in rejected (Konsistenz zu language)");
  assert.ok(!language.rejected.includes("language"), "language ebenfalls nicht in rejected");
});

test("greeting bleibt unberuehrt: Freitext wird weiterhin in selfServicePatch abgelehnt", () => {
  const { clean, rejected } = selfServicePatch({ greeting: "beliebiger Freitext" }, {});
  assert.equal("greeting" in clean, false);
  assert.ok(rejected.includes("greeting"));
});

test("allowCalendar/allowBooking sind seit P1b KEIN Self-Service-Feld mehr (Angebot ohne Wirkung, E1)", () => {
  assert.ok(!SELF_SERVICE_FREE_FIELDS.includes("allowCalendar"));
  assert.ok(!SELF_SERVICE_FREE_FIELDS.includes("allowBooking"));
  const { clean, rejected } = selfServicePatch({ allowCalendar: false, allowBooking: false }, {});
  assert.equal("allowCalendar" in clean, false, "allowCalendar nicht durchgereicht");
  assert.equal("allowBooking" in clean, false, "allowBooking nicht durchgereicht");
  assert.ok(rejected.includes("allowCalendar"), "allowCalendar explizit abgelehnt");
  assert.ok(rejected.includes("allowBooking"), "allowBooking explizit abgelehnt");
});
