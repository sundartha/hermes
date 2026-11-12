import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIRECTIVE,
  VOICE_PROFILE,
  dialSip,
  gather,
  hangup,
  redirect,
  say,
  sayWithVoiceId,
} from "../src/telephony/directives.js";

test("Konstanten: Stimmprofile und Anweisungsarten haben feste Werte", () => {
  assert.deepEqual(
    { ...VOICE_PROFILE },
    { DE_FEMALE_NEURAL: "de-female-neural", FR_FEMALE_NEURAL: "fr-female-neural", EN_FEMALE_NEURAL: "en-female-neural" },
  );
  assert.deepEqual(
    { ...DIRECTIVE },
    { SAY: "say", GATHER: "gather", HANGUP: "hangup", REDIRECT: "redirect", DIAL_SIP: "dial_sip" },
  );
  assert.ok(Object.isFrozen(VOICE_PROFILE));
  assert.ok(Object.isFrozen(DIRECTIVE));
});

test("say: Standard-Stimme deutsch, Audio-Url durchgereicht", () => {
  assert.deepEqual(say("Hallo"), {
    kind: "say",
    text: "Hallo",
    voiceProfile: "de-female-neural",
    audioUrl: undefined,
  });
  assert.deepEqual(say("Bonjour", "fr-female-neural", "https://a.example/x.mp3"), {
    kind: "say",
    text: "Bonjour",
    voiceProfile: "fr-female-neural",
    audioUrl: "https://a.example/x.mp3",
  });
});

test("sayWithVoiceId: voiceId nur bei nicht leerem String", () => {
  const base = { text: "Hi", voiceProfile: "en-female-neural" };
  assert.deepEqual(sayWithVoiceId({ ...base, voiceId: "v1" }), {
    kind: "say",
    text: "Hi",
    voiceProfile: "en-female-neural",
    audioUrl: undefined,
    voiceId: "v1",
  });
  for (const voiceId of ["", undefined, null, 5]) {
    assert.equal("voiceId" in sayWithVoiceId({ ...base, voiceId }), false);
  }
});

test("gather: Standardwerte und optionale voiceId", () => {
  const out = gather({ promptText: "Sprechen Sie", action: "/voice/x" });
  assert.deepEqual(out, {
    kind: "gather",
    promptText: "Sprechen Sie",
    action: "/voice/x",
    voiceProfile: "de-female-neural",
    speechTimeoutSec: undefined,
    promptAudioUrl: undefined,
  });
  assert.equal("voiceId" in out, false);
  assert.deepEqual(
    gather({
      promptText: "p",
      action: "/a",
      voiceProfile: "en-female-neural",
      speechTimeoutSec: 4,
      promptAudioUrl: "https://a.example/p.mp3",
      voiceId: "v2",
    }),
    {
      kind: "gather",
      promptText: "p",
      action: "/a",
      voiceProfile: "en-female-neural",
      speechTimeoutSec: 4,
      promptAudioUrl: "https://a.example/p.mp3",
      voiceId: "v2",
    },
  );
  assert.equal("voiceId" in gather({ promptText: "p", action: "/a", voiceId: "" }), false);
});

test("hangup und redirect", () => {
  assert.deepEqual(hangup(), { kind: "hangup" });
  assert.deepEqual(redirect("/voice/next"), { kind: "redirect", url: "/voice/next" });
});

test("dialSip: alle Felder werden übernommen", () => {
  const args = {
    uri: "sip:a@b.example",
    username: "u",
    password: "pw",
    callerId: "+4930123",
    timeoutS: 30,
    timeLimitS: 600,
    statusCallbackUrl: "https://c.example/s",
    answerOnBridge: true,
    ringbackAudioUrl: "https://c.example/r.mp3",
  };
  assert.deepEqual(dialSip(args), { kind: "dial_sip", ...args });
});
