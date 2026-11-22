import assert from "node:assert/strict";
import { test } from "node:test";

const { config, CONFIG_NAMESPACES } = await import("../../src/config.ts");
const { stimmenUrteil } = await import("../../scripts/iel-geheimnisse-belege.mjs");
const { RENDER_SCHLUESSEL } = await import("../../scripts/iel-geheimnisse-render.mjs");

test("Telnyx-Stimmschluessel: die Konfiguration kennt keinen Namensraum telnyx mehr", () => {
  assert.equal("telnyx" in CONFIG_NAMESPACES, false);
  assert.equal("telnyx" in config, false);
});

test("Telnyx-Stimmschluessel: das Stimmen-Urteil richtet sich nur nach Agent- und Play-Stimme", () => {
  const proben = [{ voiceId: "a", status: 200 }];
  const tabelle = [
    [{ agentVoice: "x", playVoice: "x", telnyxVoice: "t", telnyxProbe: 401 }, true],
    [{ agentVoice: "x", playVoice: "y", telnyxVoice: "t", telnyxProbe: 200 }, false],
    [{ agentVoice: "", playVoice: "", telnyxVoice: "", telnyxProbe: null }, false],
  ];
  for (const [eingabe, gruen] of tabelle) {
    assert.equal(stimmenUrteil({ profilProben: proben, ...eingabe }).gruen, gruen, JSON.stringify(eingabe));
  }
});

test("Telnyx-Stimmschluessel: der Render-Schluesselsatz fuehrt keinen Telnyx-Stimmschluessel", () => {
  assert.equal("TELNYX_VOICE" in RENDER_SCHLUESSEL, false);
  assert.equal(Object.values(RENDER_SCHLUESSEL).includes("TELNYX_ELEVENLABS_VOICE_ID"), false);
});
