// P1 (PLAN-CONVERSATION-QUALITY-V2): jeder deterministisch GESPROCHENE deutsche String
// traegt korrekte Umlaute. Geprueft wird eine EXPLIZIT aufgezaehlte Feldliste (S1-S8 des
// Plans), NICHT die Datei und NICHT "alles im Bundle": summarySystem
// (LLM-Prompt, Output wird als JSON geparst) liegt im selben Objekt, wird aber nie
// gesprochen und bleibt bewusst transliteriert.
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
import { greetingTemplatesFor } from "../src/i18n/greeting-catalog.js";

const OWNER_NAME = "Jonas Beispiel";
// IEP-P6: die Owner-Anrede nennt nur den Vornamen.
const OWNER_VORNAME = "Jonas";
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
  // GAP-14: der Inbound-Pflichtsatz ist ein deterministisch GESPROCHENER DE-String.
  ["S12 inboundNotice", LOCALES.de.inboundNotice],
  // AL-P14: Ueberbrueckungs- und Halte-Satz der Rueckfrage im Gespraech - beide werden
  // deterministisch GESPROCHEN (LLM-frei), gehoeren also in dieselbe Klasse wie S1-S12.
  ["S13 consultFillerSpeech", LOCALES.de.consultFillerSpeech],
  ["S14 consultHoldSpeech", LOCALES.de.consultHoldSpeech],
  // IP1 (W2): der erste gesprochene Satz jedes Inbound-Anrufs. Gemessen an der Form, die
  // der Anrufer HOERT (Pflichtsatz + Vorlage, greetingTemplatesFor), nicht am nackten
  // Locale-Feld - S15 ist ohnehin identisch (greetingDefault ist umhuellt), S16.0 gewinnt
  // dadurch die Pflichtsatz-Haelfte mit.
  // BEWUSST OHNE greetingVariants[1]: diese Vorlage traegt von sich aus keinen Umlaut
  // ("Hallo! Der KI-Assistent ... weiterhelfen?"), die Gegenprobe U2 wuerde fuer sie falsch
  // rot. Ihre Transliterations-Abdeckung liegt in IP1-G1, das JEDE DE-Vorlage iteriert
  // (und damit auch jede kuenftige) - eine Iteration statt einer gepflegten Liste.
  ["S15 greetingDefault (gesprochen)", greetingTemplatesFor("de")[0]],
  ["S16.0 greetingVariants[0] (gesprochen)", greetingTemplatesFor("de")[1]],
  // IEX-A2 (O3/O4): der Fehlersatz einer gescheiterten EL-Uebergabe - mit Namen und in der
  // namenlosen Form. Der Namenssatz allein traegt keinen Umlaut (U2 waere falsch rot) und ist
  // ueber beide Felder abgedeckt.
  ["S17 inboundFehlersatz (mit Name)", LOCALES.de.inboundFehlersatz(OWNER_NAME)],
  ["S18 inboundFehlersatz (ohne Name, O4)", LOCALES.de.inboundFehlersatz("")],
  // IEX-A3 (O1/O4): die Eroeffnung des Agenten bei einem eingehenden Anruf - mit und ohne Namen.
  ["S19 inboundEroeffnung (mit Name)", LOCALES.de.inboundEroeffnung(OWNER_NAME)],
  ["S20 inboundEroeffnung (ohne Name, O4)", LOCALES.de.inboundEroeffnung("")],
  // IEP-P6: dieselbe Eroeffnung mit Owner-Anrede - sie wird gesprochen und traegt denselben
  // Hinweis ("Gespraech") wie S19/S20. BEWUSST OHNE inboundGrussSatzOwner: der Kopfsatz
  // allein traegt keinen Umlaut (U2 waere falsch rot, Muster inboundNameSatz oben) und ist
  // ueber S21 mit abgedeckt - er ist dessen Praefix.
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
  // Ohne diese Probe koennte ein "Fix" das betroffene Wort einfach streichen und U1
  // trotzdem gruen faerben.
  for (const [id, value] of SPOKEN_DE_FIELDS) {
    assert.match(value, /[äöü]/u, `${id}: kein Umlaut - Wortlaut versehentlich entfernt? ${value}`);
  }
});

test("P1-U3: Abgrenzung - der LLM-Prompt bleibt transliteriert (nicht mitfixen)", () => {
  // Scope-Grenze des Plans als Test: kein gesprochener Text. Wer ihn "verbessert",
  // bricht f1-i18n-locale ohne jeden hoerbaren Gewinn.
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
