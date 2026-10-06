import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "../src/i18n/locales.js";
import { startServer } from "./helpers.js";
import { SPOKEN_TRANSLITERATION_STEMS as TRANSLITERATION_STEMS } from "./umlaut-stems-helper.js";
import { greetingTemplatesFor } from "../src/i18n/greeting-catalog.js";

const OWNER_NAME = "Jonas Beispiel";
const OWNER_VORNAME = "Jonas";
const UNROUTED_TO = "+49999999999";
const CALLER_FROM = "+4915112345678";

const SPOKEN_DE_FIELDS = [
  ["S1 disclosure", LOCALES.de.disclosure(OWNER_NAME)],
  ["S2 llmDegradedSpeech", LOCALES.de.llmDegradedSpeech],
  ["S3 turnErrorSpeech", LOCALES.de.turnErrorSpeech],
  ["S4 noSpeechReprompt", LOCALES.de.noSpeechReprompt],
  ["S5 budgetExhaustedHangup", LOCALES.de.budgetExhaustedHangup],
  ["S6 turnFallbackSpeech.inbound", LOCALES.de.turnFallbackSpeech.inbound],
  ["S7 turnFallbackSpeech.outbound", LOCALES.de.turnFallbackSpeech.outbound],
  ["S9 noSpeechRepromptAgain", LOCALES.de.noSpeechRepromptAgain],
  ["S10 noSpeechFarewell", LOCALES.de.noSpeechFarewell],
  ["S11 capFarewellSpeech", LOCALES.de.capFarewellSpeech],
  ["S12 inboundNotice", LOCALES.de.inboundNotice],
  ["S13 consultFillerSpeech", LOCALES.de.consultFillerSpeech],
  ["S14 consultHoldSpeech", LOCALES.de.consultHoldSpeech],
  ["S15 greetingDefault (gesprochen)", greetingTemplatesFor("de")[0]],
  ["S16.0 greetingVariants[0] (gesprochen)", greetingTemplatesFor("de")[1]],
  ["S17 inboundFehlersatz (mit Name)", LOCALES.de.inboundFehlersatz(OWNER_NAME)],
  ["S18 inboundFehlersatz (ohne Name, O4)", LOCALES.de.inboundFehlersatz("")],
  ["S19 inboundEroeffnung (mit Name)", LOCALES.de.inboundEroeffnung(OWNER_NAME)],
  ["S20 inboundEroeffnung (ohne Name, O4)", LOCALES.de.inboundEroeffnung("")],
  ["S21 inboundEroeffnungOwner", LOCALES.de.inboundEroeffnungOwner(OWNER_VORNAME)],
];

test("P1-U1: gesprochene DE-Strings (S1-S7) tragen keine ASCII-Transliteration mehr", () => {
  for (const [id, value] of SPOKEN_DE_FIELDS) {
    assert.equal(typeof value, "string", `${id}: kein String`);
    const hit = value.match(TRANSLITERATION_STEMS);
    assert.equal(hit, null, `${id}: Transliteration "${hit?.[0]}" in: ${value}`);
  }
});

test("P1-U2: Gegenprobe - jedes dieser Felder traegt echte Umlaut-Zeichen", () => {
  for (const [id, value] of SPOKEN_DE_FIELDS) {
    assert.match(value, /[äöü]/u, `${id}: kein Umlaut - Wortlaut versehentlich entfernt? ${value}`);
  }
});

test("P1-U3: Abgrenzung - der LLM-Prompt bleibt transliteriert (nicht mitfixen)", () => {
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
    assert.match(res.headers.get("content-type"), /charset=utf-8/i);
    assert.ok(Buffer.byteLength(body, "utf8") > body.length, "Umlaute -> Bytes > Zeichen");
    assert.equal(Number(res.headers.get("content-length")), Buffer.byteLength(body, "utf8"));
  } finally {
    await srv.stop();
  }
});
