// ElevenLabs-TTS ueber Telnyx (sprachaufgeloeste Stimme): Snapshot-Tests fuer den
// opts.elevenLabs-Zweig des Telnyx-Renderers. Pur (kein Env, kein Spawn) - in
// Produktion injiziert die Registry config.telnyxElevenLabs, hier kommen die opts
// direkt. Pinnt: (1) Say-Attribute voice+api_key_ref OHNE language-Attribut,
// (2) Gather-STT-Attribute byte-identisch zum Azure-Bestand (STT bleibt Deepgram -
// Telnyx unterstuetzt ElevenLabs nur fuer TTS), (3) innerer Gather-Say erbt die
// ElevenLabs-Stimme, (4) halbes/leeres Gate -> Azure fail-safe ohne Wurf,
// (5) Model-Slot-Override. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { say, gather, hangup, VOICE_PROFILE } from "../src/telephony/directives.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';
// voiceId ist der RUECKFALL fuer ein Profil ohne eigene Stimme. Seit 2026-08-18 hat jede
// der drei Sprachen eine eigene kuratierte ID, deshalb taucht "abc123" in keinem
// Schnappschuss mehr auf - der Renderer loest immer sprachaufgeloest auf.
const EL = { apiKeyRef: "elevenlabs_prod", voiceId: "abc123", model: "Default" };
const OPTS = { elevenLabs: EL };

test("ElevenLabs-Say: voice=ElevenLabs.Default.<id> + api_key_ref, KEIN language-Attribut", () => {
  const out = renderDirectives([say("Hallo & <Test>"), hangup()], OPTS);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Say voice="ElevenLabs.Default.cqPdIo76zSHFDcSZpFov" api_key_ref="elevenlabs_prod">Hallo &amp; &lt;Test&gt;</Say>' +
      "<Hangup/></Response>",
  );
});

test("ElevenLabs-Gather: STT-Attribute byte-identisch zum Azure-Bestand, innerer Say erbt die Stimme", () => {
  const out = renderDirectives([gather({ promptText: "Hallo?", action: "/voice/turn?callId=c1" })], OPTS);
  assert.equal(
    out,
    XML +
      "<Response>" +
      '<Gather input="speech" language="de-DE" transcriptionEngine="Deepgram" model="deepgram/nova-3" speechTimeout="auto" action="/voice/turn?callId=c1" method="POST">' +
      '<Say voice="ElevenLabs.Default.cqPdIo76zSHFDcSZpFov" api_key_ref="elevenlabs_prod">Hallo?</Say>' +
      "</Gather>" +
      "</Response>",
  );
});

// FR/EN am ElevenLabs-Say: die STT-Locale folgt dem Profil und die Voice-ID folgt seit P9
// der SPRACHE (Owner-Entscheidung 2026-07-27) - kein `language`-Attribut am <Say>, weil das
// Modell multilingual ist und dem Text folgt. DE traegt der byte-exakte Test oben, FR/EN
// dieser Test - der Regex unten schliesst unmittelbar hinter `api_key_ref` mit `>`, das IST
// der Beweis fuer das fehlende `language`-Attribut.
// ACHTUNG (Grund der Korrektur in P9): dieser Test behauptete bis P9 "eine Voice-ID fuer
// alle Sprachen" und schrieb damit genau den Defekt fest, den das Launch-Gate VOICE-12
// unten misst - ein Ist-Pin, der als Sollzustand gelesen wurde. Er pinnt jetzt den
// Sollzustand. Wer ihn wieder auf eine einzige ID zurueckdreht, bricht VOICE-12.
test("ElevenLabs + jedes Sprachprofil: STT-Locale UND Voice-ID folgen der Sprache", () => {
  for (const [profile, locale, voiceId] of [
    [VOICE_PROFILE.DE_FEMALE_NEURAL, "de-DE", "cqPdIo76zSHFDcSZpFov"],
    [VOICE_PROFILE.FR_FEMALE_NEURAL, "fr-FR", "WeAAwKYcS06VmXw086yZ"],
    [VOICE_PROFILE.EN_FEMALE_NEURAL, "en-GB", "ZSNL4hPqCnqoMPaI4jGX"],
  ]) {
    const out = renderDirectives(
      [gather({ promptText: "Oui?", action: "/x", voiceProfile: profile })],
      OPTS,
    );
    assert.match(out, new RegExp(`<Gather\\b[^>]*\\blanguage="${locale}"`), `STT-Locale ${locale}`);
    assert.match(
      out,
      new RegExp(`<Say voice="ElevenLabs\\.Default\\.${voiceId}" api_key_ref="elevenlabs_prod">`),
      "Voice-ID folgt der Sprache; kein language-Attribut am ElevenLabs-Say",
    );
  }
});

// VOICE-12 (SOLL, heute rot) - Leittest des Clusters D20 (VOICE-13/VOICE-14 entfallen dort
// als Duplikat, 00-kanonische-liste.md). Nachgezogen nach W2-B2, wo die ID nur als
// Ist-Charakterisierung abgelegt worden war.
//
// Sollzustand aus Owner-Entscheidung 7.5 (PLAN-I18N-TESTS.md): "dateLocale, sttLocale und
// TTS-Stimme loesen regional auf". Heute gibt es EINE globale Stimme (config.js
// `TELNYX_ELEVENLABS_VOICE_ID` / `ELEVENLABS_VOICE_ID`), die der Renderer sprachblind in
// jedes <Say> schreibt - ein deutscher, ein franzoesischer und ein englischer Satz klingen
// nach derselben Sprecherin mit demselben Akzent.
//
// Bewusst am gerenderten Ergebnis formuliert, nicht an einer Funktionssignatur: der Fix darf
// die Stimme aus dem Locale-Bundle, aus einer Env-Tabelle oder aus dem Tenant ziehen - der
// Test schreibt den WEG nicht vor, nur das beobachtbare Ergebnis.
test("VOICE-12 (SOLL, rot) - ElevenLabs-Stimme loest pro Sprache auf statt einer globalen ID", () => {
  const voiceIdOf = (profile) => {
    const out = renderDirectives([say("Text", profile)], OPTS);
    const m = out.match(/<Say voice="ElevenLabs\.[^.]+\.([^"]+)"/);
    assert.ok(m, `kein ElevenLabs-Say gerendert fuer ${profile}`);
    return m[1];
  };
  const distinct = new Set(
    [
      VOICE_PROFILE.DE_FEMALE_NEURAL,
      VOICE_PROFILE.FR_FEMALE_NEURAL,
      VOICE_PROFILE.EN_FEMALE_NEURAL,
    ].map(voiceIdOf),
  );
  assert.equal(
    distinct.size,
    3,
    `DE/FR/EN muessen drei verschiedene Voice-IDs liefern, gefunden: ${[...distinct].join(", ")}`,
  );
});

test("Gate halb/aus -> Azure-Bestand byte-identisch (fail-safe, kein Wurf mitten im Call)", () => {
  const dirs = () => [say("Hi"), hangup()];
  const azure = renderDirectives(dirs());
  assert.match(azure, /voice="Azure\.de-DE-KatjaNeural"/, "Referenz ist der Azure-Bestand");
  assert.equal(renderDirectives(dirs(), {}), azure);
  assert.equal(renderDirectives(dirs(), { elevenLabs: { apiKeyRef: "r", voiceId: "" } }), azure);
  assert.equal(renderDirectives(dirs(), { elevenLabs: { apiKeyRef: "", voiceId: "v" } }), azure);
});

test("Model-Slot-Override: model=v3 -> ElevenLabs.v3.<id>; leer -> Default", () => {
  const v3 = renderDirectives([say("Hi")], { elevenLabs: { ...EL, model: "v3" } });
  assert.match(v3, /voice="ElevenLabs\.v3\.cqPdIo76zSHFDcSZpFov"/);
  const empty = renderDirectives([say("Hi")], { elevenLabs: { ...EL, model: "" } });
  assert.match(empty, /voice="ElevenLabs\.Default\.cqPdIo76zSHFDcSZpFov"/);
});
