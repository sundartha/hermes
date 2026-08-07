// STT-A1: EINE neutrale STT-Wahl (stt-profile.js), pro Pfad uebersetzt. C-P4: das waren
// drei Uebersetzer (Twilio-Gather, Telnyx-Gather, Telnyx-Assistant), jetzt sind es zwei -
// die Naht selbst ist unveraendert, ihr wurde ein Konsument entzogen.
//
// WAS HIER BELEG IST UND WAS FANGNETZ - die Unterscheidung ist gemessen, nicht behauptet
// (Gegenprobe 2026-08-07, zwei gezielte Sabotagen am fertigen Branch):
//
//   Sabotage                                  | A    | B     | C/D
//   fail-closed aus sttAttrs/speechModelFor    | ROT  | gruen | gruen
//   Durchreichen der Wahl gekappt (arg-los)    | ROT  | gruen | gruen
//
// (A) ist damit der EINZIGE Beleg dieser Datei - und er deckt BEIDE Bruchstellen ab:
//     ohne fail-closed wirft niemand, und ohne Durchreichen erreicht die ungueltige Wahl
//     die Tabelle gar nicht erst. Verhaltens-Rot, kein "Modul fehlt"-Rot.
// (B) ist ein reiner WERTEVERGLEICH und bleibt ohne den Fix gruen, weil das Enum heute nur
//     EIN Mitglied hat - eine ignorierte Wahl liefert denselben Wert wie eine beachtete.
//     Es ist ein Fangnetz gegen kuenftige Drift zwischen den zwei Schreibweisen, KEIN
//     Beleg. Bekommt das Enum je ein zweites Mitglied, wird B zum echten
//     Durchreich-Beleg - dann diesen Kommentar streichen.
// (C/D) Fangnetze: jedes Enum-Mitglied loest ueberall auf; Sprach-Kontrast
//     Gather ("de-DE") vs. Assistant ("de") bleibt bestehen.
// Config VOR dem Import gesetzt -> echte .env beeinflusst den Test nicht (Muster
// telnyx-call-control.test.js). Kein pglite/Server-Spawn ausser in Test E (eigener Spawn).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServerExpectExit } from "./helpers.js";
import { gather } from "../src/telephony/directives.js";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;

// Dynamischer Import NACH dem Env-Setzen (config liest process.env beim Eval).
const { renderDirectives: renderTelnyx } = await import("../src/telephony/adapters/telnyx/render.js");
const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { STT_PROFILE } = await import("../src/telephony/stt-profile.js");
const { config } = await import("../src/config.js");

function stubFetch() {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "{}" };
  };
  return calls;
}

function gatherDE(extra = {}) {
  return gather({ promptText: "", action: "/voice/turn?callId=c1", ...extra });
}

test("A: unbekannte STT-Wahl -> beide Aufrufer werfen (fail-closed)", async () => {
  // ohne den Fix ignoriert der Renderer jede solche Angabe und rendert klaglos
  // "deepgram/nova-3" - das ist Verhaltens-Rot, kein "Modul fehlt"-Rot.
  assert.throws(
    () => renderTelnyx([gatherDE()], { sttProfile: "nicht-existent" }),
    /unbekanntes sttProfile/,
  );

  const original = config.voice.sttProfile;
  config.voice.sttProfile = "nicht-existent";
  const calls = stubFetch();
  try {
    await assert.rejects(
      telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: "de" }),
      /unbekanntes sttProfile/,
    );
    // die ungueltige Wahl faellt VOR dem HTTP-Call auf, nicht erst danach.
    assert.equal(calls.length, 0);
  } finally {
    config.voice.sttProfile = original;
  }
});

test("B (Fangnetz, gruen): EIN Profil -> zwei pfadtypische Schreibweisen", async () => {
  const profile = STT_PROFILE.ACCURATE;

  const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: profile });
  assert.match(
    telnyxOut,
    /<Gather\b[^>]*\btranscriptionEngine="Deepgram"[^>]*\bmodel="deepgram\/nova-3"/,
  );

  const original = config.voice.sttProfile;
  config.voice.sttProfile = profile;
  const calls = stubFetch();
  try {
    await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: "de" });
    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(body.transcription, { model: "deepgram/nova-3", language: "de" });
    // Call-Control-JSON traegt kein Engine-Feld.
    assert.ok(!("transcriptionEngine" in body.transcription));
    assert.ok(!("engine" in body.transcription));
  } finally {
    config.voice.sttProfile = original;
  }
});

// FANGNETZ, kein Beleg - faengt ein kuenftiges Enum-Mitglied ohne Pfad-Uebersetzung.
test("C (Fangnetz, gruen): jedes Enum-Mitglied loest in BEIDEN Pfaden auf", async () => {
  const original = config.voice.sttProfile;
  try {
    for (const profile of Object.values(STT_PROFILE)) {
      const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: profile });
      assert.ok(telnyxOut.length > 0);

      config.voice.sttProfile = profile;
      stubFetch();
      await assert.doesNotReject(
        telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: "de" }),
      );
    }
  } finally {
    config.voice.sttProfile = original;
  }
});

// FANGNETZ gegen den Vereinheitlichungs-Reflex - wer die beiden Formen angleicht, macht
// diesen Test rot. Gather sendet volles BCP-47 (Telnyx erkennt "de" nicht als Deutsch ->
// Fallback Englisch, durch echte STT-Billing-Records widerlegt), der Assistant den
// blanken Code (STT_LANGUAGE_HINTS, live am Objekt bestaetigt).
test("D (Fangnetz, gruen): Gather sendet 'de-DE', Assistant 'de' - und das ist Absicht", async () => {
  const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: STT_PROFILE.ACCURATE });
  assert.match(telnyxOut, /<Gather\b[^>]*\blanguage="de-DE"/);
  assert.doesNotMatch(telnyxOut, /language="de"[ />]/);

  const original = config.voice.sttProfile;
  config.voice.sttProfile = STT_PROFILE.ACCURATE;
  const calls = stubFetch();
  try {
    await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: "de" });
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.transcription.language, "de");
    assert.notEqual("de-DE", body.transcription.language);
  } finally {
    config.voice.sttProfile = original;
  }
});

test("E: ungueltiges STT_PROFILE -> Boot verweigert (exit 1), nennt die Variable", async () => {
  // Der Positivfall (gueltiges Profil bootet) ist durch BASE_ENV.STT_PROFILE="accurate" in
  // jedem Spawn-Test abgedeckt - ein zweiter Server-Spawn dafuer waere reine Laufzeit ohne
  // zusaetzliche Aussage.
  const { code, output } = await startServerExpectExit({ env: { STT_PROFILE: "nova3" } });
  assert.equal(code, 1);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /STT_PROFILE/);
  assert.doesNotMatch(output, /Gateway laeuft/);
});
