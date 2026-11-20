import { test } from "node:test";
import assert from "node:assert/strict";
import { stimmeAusVorlage } from "../../src/conversation/agent-stimme.ts";

const VOLL = { model_id: "m", stability: 0.5, similarity_boost: 0.7, speed: 1.1 };

test("Stimme aus Vorlage: gesetztes speed geht in voiceSettings mit", () => {
  assert.deepEqual(stimmeAusVorlage(VOLL), {
    model: "m",
    voiceSettings: { stability: 0.5, similarity_boost: 0.7, speed: 1.1 },
  });
});

test("Stimme aus Vorlage: ohne speed fehlt der Schluessel in voiceSettings", () => {
  const { speed, ...ohne } = VOLL;
  const stimme = stimmeAusVorlage(ohne);
  assert.deepEqual(stimme, { model: "m", voiceSettings: { stability: 0.5, similarity_boost: 0.7 } });
  assert.equal("speed" in stimme.voiceSettings, false);
  assert.equal(speed, 1.1);
});

test("Stimme aus Vorlage: ohne stability keine voiceSettings, model bleibt", () => {
  const { stability, ...ohne } = VOLL;
  assert.deepEqual(stimmeAusVorlage(ohne), { model: "m" });
  assert.equal(stability, 0.5);
});

test("Stimme aus Vorlage: ohne similarity_boost keine voiceSettings, model bleibt", () => {
  const { similarity_boost: boost, ...ohne } = VOLL;
  assert.deepEqual(stimmeAusVorlage(ohne), { model: "m" });
  assert.equal(boost, 0.7);
});

test("Stimme aus Vorlage: ohne model_id kein model, voiceSettings bleiben", () => {
  const { model_id: modell, ...ohne } = VOLL;
  assert.deepEqual(stimmeAusVorlage(ohne), {
    voiceSettings: { stability: 0.5, similarity_boost: 0.7, speed: 1.1 },
  });
  assert.equal(modell, "m");
});

test("Stimme aus Vorlage: ohne tts-Abschnitt ist das Ergebnis leer", () => {
  assert.deepEqual(stimmeAusVorlage(undefined), {});
});
