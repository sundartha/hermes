import assert from "node:assert/strict";
import { test } from "node:test";

import * as helfer from "../helpers.js";
import * as geheimnisse from "./erfundene-geheimnisse.js";
import { prodEnv } from "../prod-env.js";

const { EL_OUTBOUND_BOOT_ENV, EL_OUTBOUND_CONFIG, elFakeFuerStart } = helfer;
const { EL_OUTBOUND_AGENT_ID_BEISPIEL, EL_OUTBOUND_SCHLUESSEL_BEISPIEL, PLATFORM_ALERT_SMS_TO_BEISPIEL } =
  geheimnisse;

test("EL_OUTBOUND_CONFIG ist eingefroren und trägt Schalter, Schlüssel und Agent-ID", () => {
  assert.equal(Object.isFrozen(EL_OUTBOUND_CONFIG), true);
  assert.ok(EL_OUTBOUND_SCHLUESSEL_BEISPIEL);
  assert.deepEqual(
    { ...EL_OUTBOUND_CONFIG },
    {
      enabled: true,
      apiKey: EL_OUTBOUND_SCHLUESSEL_BEISPIEL,
      agentId: EL_OUTBOUND_AGENT_ID_BEISPIEL,
    },
  );
});

test("EL_OUTBOUND_BOOT_ENV bleibt unverändert und trägt den Schalter", () => {
  assert.equal(EL_OUTBOUND_BOOT_ENV.ELEVENLABS_OUTBOUND_ENABLED, "true");
});

test("elFakeFuerStart: Fake nur, wenn der Aufrufer weder API-Basis noch Fake selbst setzt", () => {
  const faelle = [
    [{}, "true"],
    [{ ELEVENLABS_API_BASE: "http://127.0.0.1:1234" }, undefined],
    [{ FAKE_ORIGINATE_ELEVENLABS: "false" }, "false"],
    [{ FAKE_ORIGINATE_ELEVENLABS: "true" }, "true"],
    [{ SKIP_TWILIO_SIGNATURE_CHECK: "false" }, undefined],
    [{ SKIP_TWILIO_SIGNATURE_CHECK: "true" }, "true"],
  ];
  for (const [eingabe, erwartet] of faelle) {
    assert.equal(elFakeFuerStart(eingabe).FAKE_ORIGINATE_ELEVENLABS, erwartet, JSON.stringify(eingabe));
  }
});

test("elFakeFuerStart behält die übrigen Schlüssel und verändert die Eingabe nicht", () => {
  const eingabe = Object.freeze({ PORT: "1" });
  const ergebnis = elFakeFuerStart(eingabe);
  assert.equal(ergebnis.PORT, "1");
  assert.deepEqual({ ...eingabe }, { PORT: "1" });
});

test("prodEnv trägt für PLATFORM_ALERT_SMS_TO einen Platzhalter und lässt Überschreiben zu", () => {
  assert.equal(prodEnv().PLATFORM_ALERT_SMS_TO, PLATFORM_ALERT_SMS_TO_BEISPIEL);
  assert.equal(prodEnv({ PLATFORM_ALERT_SMS_TO: "" }).PLATFORM_ALERT_SMS_TO, "");
});
