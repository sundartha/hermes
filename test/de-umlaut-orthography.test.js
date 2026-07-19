// P1 (PLAN-CONVERSATION-QUALITY-V2): jeder deterministisch GESPROCHENE deutsche String
// traegt korrekte Umlaute. Geprueft wird eine EXPLIZIT aufgezaehlte Feldliste (S1-S8 des
// Plans), NICHT die Datei und NICHT "alles im Bundle": realtimeOpener.outbound
// (Realtime-Steuertext) und summarySystem (LLM-Prompt, Output wird als JSON geparst)
// liegen im selben Objekt, werden aber nie gesprochen und bleiben bewusst transliteriert.
// Denylist bekannter Staemme statt generischer /ue|oe|ae/-Regel: sonst schlagen legitime
// Wortfolgen ("neue", "Poesie", "zuerst") falsch an.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "../src/i18n/locales.js";
import { startServer } from "./helpers.js";
// P5: EINE Quelle (G5) fuer die Stamm-Denylist statt der frueher lokalen Kopie -
// zweiter Konsument ist test/cq-p5-prompt-redesign.test.js. Reines Umbenennen des
// Imports, keine Verhaltensaenderung (dieselben neun Staemme, case-insensitiv).
import { SPOKEN_TRANSLITERATION_STEMS as TRANSLITERATION_STEMS } from "./umlaut-stems-helper.js";

const OWNER_NAME = "Jonas Beispiel";
const UNROUTED_TO = "+49999999999"; // nicht geseedet -> nicht routbar (S8-Pfad)
const CALLER_FROM = "+4915112345678";

// S1-S7: die gesprochenen DE-Felder des Locale-Bundles, einzeln benannt (id fuer die
// Fehlermeldung). S8 lebt nicht im Bundle und wird unten ueber den echten Renderpfad
// geprueft.
const SPOKEN_DE_FIELDS = [
  ["S1 disclosure", LOCALES.de.disclosure(OWNER_NAME)],
  ["S2 llmDegradedSpeech", LOCALES.de.llmDegradedSpeech],
  ["S3 turnErrorSpeech", LOCALES.de.turnErrorSpeech],
  ["S4 noSpeechReprompt", LOCALES.de.noSpeechReprompt],
  ["S5 budgetExhaustedHangup", LOCALES.de.budgetExhaustedHangup],
  ["S6 turnFallbackSpeech.inbound", LOCALES.de.turnFallbackSpeech.inbound],
  ["S7 turnFallbackSpeech.outbound", LOCALES.de.turnFallbackSpeech.outbound],
  // P3.2: die zwei weiteren Eskalations-Stufen der No-Speech-Staffel.
  ["S9 noSpeechRepromptAgain", LOCALES.de.noSpeechRepromptAgain],
  ["S10 noSpeechFarewell", LOCALES.de.noSpeechFarewell],
  // P3.1: deterministischer Abschluss-Satz kurz vor dem harten Max-Dauer-Cap.
  ["S11 capFarewellSpeech", LOCALES.de.capFarewellSpeech],
];

test("P1-U1: gesprochene DE-Strings (S1-S7) tragen keine ASCII-Transliteration mehr", () => {
  for (const [id, value] of SPOKEN_DE_FIELDS) {
    assert.equal(typeof value, "string", `${id}: kein String`);
    const hit = value.match(TRANSLITERATION_STEMS);
    assert.equal(hit, null, `${id}: Transliteration "${hit?.[0]}" in: ${value}`);
  }
});

test("P1-U2: Gegenprobe - jedes dieser Felder traegt echte Umlaut-Zeichen", () => {
  // Ohne diese Probe koennte ein "Fix" das betroffene Wort einfach streichen und U1
  // trotzdem gruen faerben.
  for (const [id, value] of SPOKEN_DE_FIELDS) {
    assert.match(value, /[äöü]/u, `${id}: kein Umlaut - Wortlaut versehentlich entfernt? ${value}`);
  }
});

test("P1-U3: Abgrenzung - Steuertext und LLM-Prompt bleiben transliteriert (nicht mitfixen)", () => {
  // Scope-Grenze des Plans als Test: beide sind KEIN gesprochener Text. Wer sie
  // "verbessert", bricht f1-i18n-locale ohne jeden hoerbaren Gewinn.
  assert.match(LOCALES.de.realtimeOpener.outbound("DISCLOSURE"), /Gespraech/);
  assert.match(LOCALES.de.summarySystem(OWNER_NAME), /fuer/);
});

test("P1-U4: S8 - Unerreichbar-Hangup spricht Umlaute und geht als UTF-8 byte-korrekt raus", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: "CAtest", From: CALLER_FROM, To: UNROUTED_TO }),
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Auf Wiederhören/);
    assert.doesNotMatch(body, TRANSLITERATION_STEMS);
    // Charset-Fehlermodus: eine falsche Kodierung kuerzt den letzten Satz ab und bleibt
    // am Bildschirm unsichtbar. Content-Length MUSS die UTF-8-Bytezahl sein.
    assert.match(res.headers.get("content-type"), /charset=utf-8/i);
    assert.ok(Buffer.byteLength(body, "utf8") > body.length, "Umlaute -> Bytes > Zeichen");
    assert.equal(Number(res.headers.get("content-length")), Buffer.byteLength(body, "utf8"));
  } finally {
    await srv.stop();
  }
});
