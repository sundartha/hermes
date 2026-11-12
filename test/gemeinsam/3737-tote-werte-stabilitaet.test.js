import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ladeVorlage } from "../../scripts/lib/elevenlabs-agent-lesen.mjs";

const TOTE_FELDER = ["speed", "optimize_streaming_latency"];

describe("Vorlage ohne wirkungslose Stimmwerte, ruhigere Stabilitaet", () => {
  const vorlage = ladeVorlage();
  const tts = vorlage.agent.conversation_config.tts;
  const besitz = vorlage._besitz.felder.map((feld) => feld.feld);

  it("stability steht auf 0.65", () => {
    assert.equal(tts.stability, 0.65);
  });

  for (const feld of TOTE_FELDER) {
    it(`${feld} fehlt als Wert, Begruendung und Besitz-Eintrag`, () => {
      assert.equal(Object.hasOwn(tts, feld), false);
      assert.equal(Object.hasOwn(tts, `_${feld}_begruendung`), false);
      assert.equal(besitz.includes(`tts_${feld}`), false);
      assert.equal(JSON.stringify(vorlage._besitz).includes(`tts.${feld}`), false);
    });
  }

  it("stability bleibt besessen", () => {
    assert.ok(besitz.includes("tts_stability"));
  });
});
