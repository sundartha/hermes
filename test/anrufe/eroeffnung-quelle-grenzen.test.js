import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { assertEroeffnungGeprueft, startOutboundCall } = await import("../../src/elevenlabs/convai.js");

const KONTO = Object.freeze({ apiKey: "k", apiBase: "http://127.0.0.1:1" });
const KI_ERSTSATZ =
  "Hallo, es geht um einen Termin – ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.";
const GATE_MELDUNG = /dynamic_variables\.eroeffnung oder opening_line fehlt oder traegt nicht den KI-Satz vor der ersten Frage/;

function gateStart(inhalt, extra = {}) {
  let netzaufrufe = 0;
  const fetchImpl = async () => {
    netzaufrufe += 1;
    return { ok: true, status: 200, json: async () => ({ conversation_id: "conv_gate_2" }) };
  };
  const body = { conversation_initiation_client_data: inhalt };
  const lauf = startOutboundCall({ fetchImpl, account: KONTO, body, callId: "c2", disclosureLanguage: "de", ...extra });
  return { lauf, netzaufrufe: () => netzaufrufe };
}

describe("Eroeffnung-Gate: Abbruchmeldung und Randfaelle", () => {
  it("ohne dynamic_variables bricht der Anrufstart mit der Gate-Meldung ab, nicht mit einem Programmfehler", async () => {
    const { lauf, netzaufrufe } = gateStart({ conversation_config_override: { agent: { language: "de" } } });
    await assert.rejects(lauf, GATE_MELDUNG);
    assert.equal(netzaufrufe(), 0);
  });

  it("eine fehlende Eroeffnung nennt die Gate-Meldung mit der Anruf-Kennung", async () => {
    const { lauf } = gateStart({ dynamic_variables: { opening_line: "es geht um einen Termin." }, conversation_config_override: { agent: { language: "de" } } });
    await assert.rejects(lauf, /Anrufstart abgebrochen \(call=c2\): dynamic_variables\.eroeffnung/);
  });

  it("opening_line allein genuegt nicht, die Eroeffnung allein auch nicht", async () => {
    for (const variablen of [{ eroeffnung: KI_ERSTSATZ }, { opening_line: "es geht um einen Termin." }]) {
      const { lauf, netzaufrufe } = gateStart({ dynamic_variables: variablen, conversation_config_override: { agent: { language: "de" } } });
      await assert.rejects(lauf, GATE_MELDUNG);
      assert.equal(netzaufrufe(), 0);
    }
  });
});
