import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives as renderTelnyx } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, VOICE_PROFILE } from "../src/telephony/directives.js";

const UNKNOWN_VOICE_PROFILE = "en-US-female-neural";
const BARGE_IN_ATTRIBUTE = /barge|interrupt/i;
const STT_MODEL_ATTRIBUTE = /\bmodel="([^"]+)"/;

const gatherFor = (voiceProfile) =>
  gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1", voiceProfile });

test("VOICE-22 (Mechanismus, gruen) - Gather traegt fuer JEDES Voice-Profil dasselbe STT-Modell", () => {
  const models = new Set();
  for (const profile of Object.values(VOICE_PROFILE)) {
    const match = renderTelnyx([gatherFor(profile)]).match(STT_MODEL_ATTRIBUTE);
    assert.ok(match, `${profile}: kein STT-Modell-Attribut im Gather`);
    models.add(match[1]);
  }
  assert.equal(models.size, 1, `STT-Modell variiert mit der Sprache: ${[...models].join(", ")}`);
});

test("VOICE-23 (Charakterisierung, gruen) - Budget-Engine setzt fuer keine Sprache ein Barge-in-/Interrupt-Attribut", () => {
  for (const profile of Object.values(VOICE_PROFILE)) {
    const out = renderTelnyx([gatherFor(profile)]);
    assert.doesNotMatch(out, BARGE_IN_ATTRIBUTE, profile);
  }
});

test("VOICE-25 (Mechanismus, gruen) - verschraenkte DE-/EN-Renderaufrufe faerben sich nicht ab", () => {
  const first = renderTelnyx([gatherFor(VOICE_PROFILE.DE_FEMALE_NEURAL)]);
  const second = renderTelnyx([gatherFor(VOICE_PROFILE.EN_FEMALE_NEURAL)]);
  const third = renderTelnyx([gatherFor(VOICE_PROFILE.DE_FEMALE_NEURAL)]);

  assert.match(first, /language="de-DE"/, "erster Aufruf traegt de-DE");
  assert.match(second, /language="en-GB"/, "zweiter Aufruf traegt en-GB");
  assert.doesNotMatch(second, /language="de-DE"/, "zweiter Aufruf leakt kein de-DE");
  assert.equal(third, first, "dritter Aufruf ist byte-identisch zum ersten (kein Leak)");
});

test("VOICE-29 (Mechanismus, gruen) - jedes bekannte Voice-Profil rendert, ein Fremdprofil wirft", () => {
  for (const profile of Object.values(VOICE_PROFILE))
    assert.doesNotThrow(() => renderTelnyx([say("Hallo", profile)]), `${profile} sollte bekannt sein`);

  assert.throws(
    () => renderTelnyx([say("Hallo", UNKNOWN_VOICE_PROFILE)]),
    /unbekanntes voiceProfile/,
    "Fremdprofil muss werfen",
  );
});
