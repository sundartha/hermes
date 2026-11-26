import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AnrufStart, NichtLeer } from "../../src/anrufe/start/anrufstart.ts";

const DE = { language: "de", providerLanguage: "de", disclosureLanguage: "de", voiceId: "voice-1" };
const PT_EN = { language: "pt", providerLanguage: "pt", disclosureLanguage: "en", voiceId: "voice-1" };
const DRITT = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
const BESITZER = "Hallo Jonas. Ich rufe an wegen Ihres Termins.";
const FOLGESATZ = "Ich rufe an. Bitte sprechen Sie.";

const EINGABE = { sprachen: DE, dritt: DRITT, ownerEroeffnung: "", eroeffnungGesagt: false, folgesatz: "" };

type VorspannTyp = Extract<AnrufStart, { sprecher: "vorspann" }>;
type AgentTyp = Extract<AnrufStart, { sprecher: "agent" }>;

export const vorspannTraegtFolgesatz: VorspannTyp extends { folgesatz: NichtLeer } ? true : false = true;
export const leererTextIstKeinFolgesatz: string extends NichtLeer ? false : true = true;
export const agentTraegtKeinenFolgesatz: AgentTyp extends { folgesatz: unknown } ? false : true = true;

const modul = () => import("../../src/anrufe/start/anrufstart.ts");

describe("anrufStart: ein Erzeuger fuer Sprache und Eroeffnung", () => {
  it("Dritter in gleicher Sprache: Eroeffnung als Variable, keine erste Nachricht im Override", async () => {
    const { anrufStart } = await modul();
    const start = anrufStart(EINGABE);
    assert.equal(start.sprecher, "agent");
    assert.equal(start.sprache, "de");
    assert.equal(start.offenlegungssprache, "de");
    assert.equal(start.firstMessage, null);
    assert.equal(start.eroeffnung, DRITT);
    assert.deepEqual(start.override, { agent: { language: "de" }, tts: { voice_id: "voice-1" } });
  });

  it("Offenlegung in anderer Sprache: Eroeffnung ist Variable und erste Nachricht", async () => {
    const { anrufStart } = await modul();
    const start = anrufStart({ ...EINGABE, sprachen: PT_EN });
    assert.equal(start.sprache, "pt");
    assert.equal(start.offenlegungssprache, "en");
    assert.equal(start.eroeffnung, DRITT);
    assert.equal(start.firstMessage, DRITT);
    assert.deepEqual(start.override, { agent: { language: "pt", first_message: DRITT }, tts: { voice_id: "voice-1" } });
  });

  it("leere Eroeffnung bei anderer Sprache: keine erste Nachricht", async () => {
    const { anrufStart } = await modul();
    const start = anrufStart({ ...EINGABE, sprachen: PT_EN, dritt: "" });
    assert.equal(start.eroeffnung, "");
    assert.equal(start.firstMessage, null);
    assert.deepEqual(start.override, { agent: { language: "pt" }, tts: { voice_id: "voice-1" } });
  });

  it("eigene Nummer: die Besitzer-Eroeffnung ist Variable und erste Nachricht, auch in gleicher Sprache", async () => {
    const { anrufStart } = await modul();
    const start = anrufStart({ ...EINGABE, ownerEroeffnung: BESITZER });
    assert.equal(start.eroeffnung, BESITZER);
    assert.equal(start.firstMessage, BESITZER);
    assert.equal(start.override.agent.first_message, BESITZER);
  });

  it("Vorspann: sprecher vorspann, Variable leer, erste Nachricht ist der Folgesatz", async () => {
    const { anrufStart } = await modul();
    const start = anrufStart({ ...EINGABE, ownerEroeffnung: BESITZER, eroeffnungGesagt: true, folgesatz: FOLGESATZ });
    assert.equal(start.sprecher, "vorspann");
    assert.equal(start.folgesatz, FOLGESATZ);
    assert.equal(start.eroeffnung, "");
    assert.equal(start.firstMessage, FOLGESATZ);
    assert.equal(start.override.agent.first_message, FOLGESATZ);
  });

  it("Vorspann ohne Folgesatz wird abgelehnt", async () => {
    const { anrufStart } = await modul();
    assert.throws(() => anrufStart({ ...EINGABE, eroeffnungGesagt: true, folgesatz: "" }));
  });

  it("ohne Stimme steht keine tts im Override", async () => {
    const { anrufStart } = await modul();
    const start = anrufStart({ ...EINGABE, sprachen: { ...DE, voiceId: "" } });
    assert.deepEqual(start.override, { agent: { language: "de" } });
  });

  it("Typ: nichtLeer lehnt den leeren Text ab und reicht jeden anderen durch", async () => {
    const { nichtLeer } = await modul();
    assert.equal(nichtLeer("x"), "x");
    assert.throws(() => nichtLeer(""));
  });
});
