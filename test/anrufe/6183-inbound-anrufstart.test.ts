import assert from "node:assert/strict";
import { describe, it } from "node:test";

const DE = { language: "de", providerLanguage: "de", disclosureLanguage: "de", voiceId: "voice-1" };
const FREMD = "Guten Tag, hier spricht der KI-Assistent von Jonas Beispiel.";
const BESITZER = "Hallo Jonas, womit kann ich helfen?";
const EINGEHEND = { sprachen: DE, dritt: FREMD, ownerEroeffnung: "", eroeffnungGesagt: false, folgesatz: "", eingehend: true };

describe("anrufStart fuer eingehende Anrufe", () => {
  it("Anrufer ist ein Dritter: die Begruessung ist immer die erste Nachricht, auch in gleicher Sprache", async () => {
    const { anrufStart } = await import("../../src/anrufe/start/anrufstart.ts");
    const start = anrufStart(EINGEHEND);
    assert.equal(start.sprecher, "agent");
    assert.equal(start.firstMessage, FREMD);
    assert.deepEqual(start.override, { agent: { language: "de", first_message: FREMD }, tts: { voice_id: "voice-1" } });
  });

  it("Anrufer ist der Auftraggeber: dessen Begruessung ersetzt die fremde", async () => {
    const { anrufStart } = await import("../../src/anrufe/start/anrufstart.ts");
    const start = anrufStart({ ...EINGEHEND, ownerEroeffnung: BESITZER });
    assert.equal(start.firstMessage, BESITZER);
    assert.equal(start.override.agent.first_message, BESITZER);
  });

  it("ausgehend in gleicher Sprache bleibt ohne erste Nachricht", async () => {
    const { anrufStart } = await import("../../src/anrufe/start/anrufstart.ts");
    const start = anrufStart({ ...EINGEHEND, eingehend: false });
    assert.equal(start.firstMessage, null);
  });
});
