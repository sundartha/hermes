import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSentenceChunker, MIN_SENTENCE_CHARS } from "../src/speech-chunker.js";
import { shapeChunkForSpeech, shapeForSpeech } from "../src/speech-shape.js";

function chunksFor(deltas, { toolUseAfter = -1 } = {}) {
  const out = [];
  const chunker = makeSentenceChunker({ onChunk: (t) => out.push(t) });
  deltas.forEach((delta, i) => {
    if (i === toolUseAfter) chunker.toolUseStarted();
    chunker.pushText(delta);
  });
  chunker.flushRemainder();
  return { out, chunker };
}

function splitInto(text, n) {
  const size = Math.ceil(text.length / n);
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

test("AL-P7-1: Satzgrenzen mitten im Delta und exakt auf der Delta-Grenze ergeben dieselben Chunks", () => {
  const mitten = chunksFor(["Guten Tag, hier ist Hermes. Wie kann ich", " Ihnen helfen? Sagen Sie es mir."]);
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
  assert.equal(MIN_SENTENCE_CHARS, 12);
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
    for (const parts of [1, 3, 7, 40].map((n) => splitInto(raw, n))) {
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
