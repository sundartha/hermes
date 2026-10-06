import { test } from "node:test";
import assert from "node:assert/strict";
import { providerSupports, CAPABILITY } from "../src/telephony/registry.js";
import { PROVIDER } from "../src/store/defaults.js";

test("alle bekannten Kombinationen", () => {
  assert.equal(providerSupports(PROVIDER.TELNYX, CAPABILITY.PLAY_AUDIO_TTS), true);
});

test("fail-closed Grenzfaelle -> false", () => {
  assert.equal(providerSupports("nonsense", CAPABILITY.PLAY_AUDIO_TTS), false);
  assert.equal(providerSupports("twilio", CAPABILITY.PLAY_AUDIO_TTS), false);
  assert.equal(providerSupports(PROVIDER.TELNYX, "nonsenseCap"), false);
  assert.equal(providerSupports(undefined, undefined), false);
  assert.equal(providerSupports(null, CAPABILITY.PLAY_AUDIO_TTS), false);
});
