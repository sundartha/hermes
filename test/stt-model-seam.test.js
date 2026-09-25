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
const { STT_PROFILE } = await import("../src/telephony/stt-profile.js");

function gatherDE(extra = {}) {
  return gather({ promptText: "", action: "/voice/turn?callId=c1", ...extra });
}

test("A: unbekannte STT-Wahl -> der Renderer wirft (fail-closed)", async () => {
  // ohne den Fix ignoriert der Renderer jede solche Angabe und rendert klaglos
  // "deepgram/nova-3" - das ist Verhaltens-Rot, kein "Modul fehlt"-Rot.
  assert.throws(
    () => renderTelnyx([gatherDE()], { sttProfile: "nicht-existent" }),
    /unbekanntes sttProfile/,
  );
});

test("B (Fangnetz, gruen): EIN Profil loest im TeXML-Gather auf", async () => {
  const profile = STT_PROFILE.ACCURATE;

  const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: profile });
  assert.match(
    telnyxOut,
    /<Gather\b[^>]*\btranscriptionEngine="Deepgram"[^>]*\bmodel="deepgram\/nova-3"/,
  );
});

// FANGNETZ, kein Beleg - faengt ein kuenftiges Enum-Mitglied ohne Pfad-Uebersetzung.
test("C (Fangnetz, gruen): jedes Enum-Mitglied loest im TeXML-Gather auf", async () => {
  for (const profile of Object.values(STT_PROFILE)) {
    const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: profile });
    assert.ok(telnyxOut.length > 0);
  }
});

test("D (Fangnetz, gruen): Gather sendet volles BCP-47 'de-DE'", async () => {
  const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: STT_PROFILE.ACCURATE });
  assert.match(telnyxOut, /<Gather\b[^>]*\blanguage="de-DE"/);
  assert.doesNotMatch(telnyxOut, /language="de"[ />]/);
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
