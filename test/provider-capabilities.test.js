// P5: Capability-Seam (registry.js). providerSupports(provider, capability) ersetzt die
// drei verstreuten provider===PROVIDER.TELNYX-Checks (S2-22) durch eine Tabellen-
// Nachfrage; fail-closed-Default false fuer jede unbekannte/fehlende Kombination. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { providerSupports, CAPABILITY } from "../src/telephony/registry.js";
import { PROVIDER } from "../src/store/defaults.js";

test("alle bekannten Kombinationen", () => {
  assert.equal(providerSupports(PROVIDER.TELNYX, CAPABILITY.AI_ASSISTANT), true);
  assert.equal(providerSupports(PROVIDER.TELNYX, CAPABILITY.PLAY_AUDIO_TTS), true);
});

test("fail-closed Grenzfaelle -> false", () => {
  assert.equal(providerSupports("nonsense", CAPABILITY.AI_ASSISTANT), false);
  // C-P4: 'twilio' ist kein Enum-Wert mehr, kann aber als ALTZEILE in einer Bestands-DB
  // stehen (provider TEXT ohne CHECK). Der Weg dorthin ist damit derselbe wie fuer jeden
  // unbekannten Wert - fail-closed false, KEIN stilles true.
  assert.equal(providerSupports("twilio", CAPABILITY.AI_ASSISTANT), false);
  assert.equal(providerSupports("twilio", CAPABILITY.PLAY_AUDIO_TTS), false);
  assert.equal(providerSupports(PROVIDER.TELNYX, "nonsenseCap"), false);
  assert.equal(providerSupports(undefined, undefined), false);
  assert.equal(providerSupports(null, CAPABILITY.AI_ASSISTANT), false);
});
