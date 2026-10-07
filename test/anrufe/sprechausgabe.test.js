import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSentenceChunker, MIN_SENTENCE_CHARS } from "../../src/speech-chunker.js";
import { shapeChunkForSpeech, shapeForSpeech } from "../../src/speech-shape.js";
import { makeThinkingSignal, THINKING_SIGNAL_MAX_CHARS } from "../../src/thinking-signal.js";

const ERWARTETE_MINDESTZEICHEN = 12;
const GROBE_ZERLEGUNG = 3;
const MITTLERE_ZERLEGUNG = 7;
const FEINE_ZERLEGUNG = 40;
const FRAGMENTZAHLEN = Object.freeze([1, GROBE_ZERLEGUNG, MITTLERE_ZERLEGUNG, FEINE_ZERLEGUNG]);
const WOERTER_IM_LANGEN_TEXT = 40;
const ZAHL_STATT_TEXT = 42;

function chunksFor(deltas, { toolUseAfter = -1 } = {}) {
  const out = [];
  const chunker = makeSentenceChunker({ onChunk: (text) => out.push(text) });
  deltas.forEach((delta, i) => {
    if (i === toolUseAfter) chunker.toolUseStarted();
    chunker.pushText(delta);
  });
  chunker.flushRemainder();
  return { out, chunker };
}

function splitInto(text, anzahl) {
  const size = Math.ceil(text.length / anzahl);
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

test("AL-P7-1: Satzgrenzen mitten im Delta und exakt auf der Delta-Grenze ergeben dieselben Chunks", () => {
  const mitten = chunksFor([
    "Guten Tag, hier ist Hermes. Wie kann ich",
    " Ihnen helfen? Sagen Sie es mir.",
  ]);
  assert.deepEqual(mitten.out, [
    "Guten Tag, hier ist Hermes.",
    " Wie kann ich Ihnen helfen?",
    " Sagen Sie es mir.",
  ]);
  const aufDerGrenze = chunksFor([
    "Guten Tag, hier ist Hermes.",
    " Wie kann ich Ihnen helfen?",
    " Sagen Sie es mir.",
  ]);
  assert.deepEqual(aufDerGrenze.out, mitten.out);
});

test("AL-P7-2: Ordnungszahlen und Abkuerzungen loesen keinen Chunk aus (MIN_SENTENCE_CHARS)", () => {
  assert.equal(MIN_SENTENCE_CHARS, ERWARTETE_MINDESTZEICHEN);
  assert.deepEqual(chunksFor(["Am 3. Januar um 9 Uhr."]).out, ["Am 3. Januar um 9 Uhr."]);
  assert.deepEqual(chunksFor(["z. B. am Freitag"]).out, ["z. B. am Freitag"]);
});

test("AL-P7-3: der Chunk-Shaper raeumt Markdown/Listen/Gedankenstriche ab, ergaenzt aber KEINEN Punkt", () => {
  assert.equal(shapeChunkForSpeech("**Guten Tag**"), "Guten Tag");
  assert.equal(shapeChunkForSpeech("- Erster Punkt"), "Erster Punkt");
  assert.equal(shapeChunkForSpeech("Montag - oder Dienstag"), "Montag, oder Dienstag");
  assert.equal(shapeChunkForSpeech("Ich melde mich"), "Ich melde mich");
  assert.equal(shapeChunkForSpeech("Ich melde mich,"), "Ich melde mich,");
  assert.equal(shapeForSpeech("Ich melde mich,"), "Ich melde mich.");
});

test("AL-P7-4: nach toolUseStarted wird nur noch gepuffert, flushRemainder gibt den Rest VOLLSTAENDIG aus", () => {
  const { out } = chunksFor(
    ["Ich notiere das fuer Jonas. ", "Er meldet sich morgen. ", "Bis dann."],
    { toolUseAfter: 2 },
  );
  assert.deepEqual(out, ["Ich notiere das fuer Jonas.", " Er meldet sich morgen. Bis dann."]);
});

test("AL-P7-5: Invariante - roh aneinandergehaengte Chunks ergeben geshapt exakt den geshapten Rohtext", () => {
  const KORPUS = [
    "Guten Tag, hier ist Hermes fuer Jonas Beispiel. Ich rufe wegen eines Termins an. Passt Donnerstag um 14 Uhr?",
    "Alles klar. Ich gebe das an Jonas weiter. Vielen Dank und einen schoenen Tag!",
    "Bonjour, je suis Hermes. Puis-je vous poser une question ? C'est au sujet d'un rendez-vous.",
    "Hello. The price is 12,50 Euro per month. Does that work for you?",
    "Kein Problem, ich rufe spaeter noch einmal an. Waere 16 Uhr besser? Sagen Sie mir Bescheid.",
    "Ich habe Ihre Nummer notiert: 0151 12345678. Jonas meldet sich. Auf Wiederhoeren.",
  ];
  for (const raw of KORPUS) {
    for (const parts of FRAGMENTZAHLEN.map((anzahl) => splitInto(raw, anzahl))) {
      const { out } = chunksFor(parts);
      assert.ok(out.length > 0, `keine Chunks fuer: ${raw}`);
      assert.equal(
        shapeForSpeech(out.join("")),
        shapeForSpeech(raw),
        `Zeichenfolge weicht ab bei ${parts.length} Fragmenten: ${raw}`,
      );
    }
  }
});

test("AL-P7-6: die Chunk-Grenze schneidet NIE unmittelbar vor einem Aufzaehlungs-Marker", () => {
  const raw = "Zwei Optionen sind moeglich. - Montag oder Dienstag.";
  const { out } = chunksFor([raw]);
  assert.equal(out.length, 1);
  assert.equal(shapeForSpeech(out.join("")), shapeForSpeech(raw));
});

test("AL-P7-7: leere/whitespace-Fragmente erzeugen keinen Chunk, receivedText bleibt ehrlich", () => {
  const leer = chunksFor([]);
  assert.deepEqual(leer.out, []);
  assert.equal(leer.chunker.chunkCount(), 0);
  assert.equal(leer.chunker.receivedText(), false);

  const nurWhitespace = chunksFor(["   \n  "]);
  assert.deepEqual(nurWhitespace.out, []);
  assert.equal(nurWhitespace.chunker.chunkCount(), 0);
  assert.equal(nurWhitespace.chunker.receivedText(), true, "ein Fragment KAM an - nur ohne Inhalt");
});

test("AL-P7-8: shapeForSpeech bleibt nach dem Umzug byte-identisch (Gegenprobe zu shape-for-speech.test.js)", () => {
  const PAARE = [
    ["Guten   Tag,\n\nwie geht es Ihnen?", "Guten Tag, wie geht es Ihnen?"],
    ["- Erstens\n- Zweitens", "Erstens Zweitens."],
    ["**Wichtig**: der Termin", "Wichtig: der Termin."],
    ["Ich schicke eine E-Mail", "Ich schicke eine E-Mail."],
    ["Montag - oder Dienstag", "Montag, oder Dienstag."],
    ["Ich melde mich,", "Ich melde mich."],
    ["", ""],
  ];
  for (const [input, expected] of PAARE) assert.equal(shapeForSpeech(input), expected);
});

function chunkSpy() {
  const chunks = [];
  const onSpeechChunk = (text) => chunks.push(text);
  return { onSpeechChunk, chunks };
}

test("AL-P7b-1: Flag aus ODER kein Abnehmer -> kein Aufruf, kein spoken()", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const off = makeThinkingSignal({ onSpeechChunk, enabled: false });
  assert.equal(off.speakBridge("Einen Moment."), "");
  assert.deepEqual(chunks, []);
  assert.equal(off.spoken(), false);

  const noSink = makeThinkingSignal({ onSpeechChunk: undefined, enabled: true });
  assert.equal(noSink.speakBridge("Einen Moment."), "");
  assert.equal(noSink.spoken(), false);
});

test("AL-P7b-2: nur EINMAL pro Turn - der zweite Aufruf im selben Turn spricht nicht mehr", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
  assert.equal(
    signal.speakBridge("Einen Moment, das pruefe ich."),
    "Einen Moment, das pruefe ich.",
  );
  assert.equal(signal.speakBridge("Noch ein Satz."), "", "Einmal-Riegel");
  assert.equal(chunks.length, 1);
  assert.equal(signal.spoken(), true);
});

test("AL-P7b-15: Rueckgabe ist der GESPROCHENE Text ohne Trennzeichen - Aufrufer kann ihn direkt als speech uebernehmen", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
  const spokenText = signal.speakBridge("Einen Moment, das pruefe ich.");
  assert.equal(chunks[0], `${spokenText} `, "Chunk = Rueckgabe + Trennzeichen");
});

test("AL-P7b-16: kappt roundText ueber THINKING_SIGNAL_MAX_CHARS, ist die Rueckgabe die GEKAPPTE Fassung, nie der volle Rundentext", () => {
  const { onSpeechChunk } = chunkSpy();
  const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
  const langerText = "Wort ".repeat(WOERTER_IM_LANGEN_TEXT).trim();
  const spokenText = signal.speakBridge(langerText);
  assert.ok(spokenText.length < langerText.length, "gekappt, nicht der volle Rundentext");
  assert.ok(
    spokenText.length <= THINKING_SIGNAL_MAX_CHARS + 1,
    "Kappe haelt (plus Satzendzeichen)",
  );
});

test("AL-P7b-3: der gesprochene Text ist geshapt und traegt das Trennzeichen am Ende", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
  signal.speakBridge("- Einen Moment");
  assert.equal(chunks.length, 1);
  const bridge = chunks[0];
  assert.ok(!bridge.includes("-"), "kein Listenmarker mehr");
  assert.ok(/[.!?] $/.test(bridge), "Satzende gesetzt, dann Leerzeichen als Trennzeichen");
});

test("AL-P7b-4: ueberlanger Text wird an einer Wortgrenze gekappt (kein Wortfragment)", () => {
  const { onSpeechChunk, chunks } = chunkSpy();
  const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
  const langerText = "Wort ".repeat(WOERTER_IM_LANGEN_TEXT).trim();
  signal.speakBridge(langerText);
  const bridge = chunks[0].trimEnd();
  assert.ok(bridge.length <= THINKING_SIGNAL_MAX_CHARS + 1, "Kappe haelt (plus Satzendzeichen)");
  assert.ok(!bridge.endsWith("Wor"), "keine mitten im Wort abgeschnittene Kappe");
});

test("AL-P7b-5: leerer/Whitespace-/Nicht-String-Rundentext -> kein Aufruf des Abnehmers", () => {
  for (const empty of ["", "   ", null, undefined, ZAHL_STATT_TEXT]) {
    const { onSpeechChunk, chunks } = chunkSpy();
    const signal = makeThinkingSignal({ onSpeechChunk, enabled: true });
    assert.equal(signal.speakBridge(empty), "", `Eingabe: ${JSON.stringify(empty)}`);
    assert.deepEqual(chunks, []);
  }
});
