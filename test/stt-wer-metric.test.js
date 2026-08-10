// B-7: der rechnende Kern von scripts/stt-wer.mjs (Wortfehlerrate, Normalisierung,
// Kanal-Zuordnung, Turn-Fenster). Rein offline - kein Netz, keine Aufnahme, kein ffmpeg
// (F.I.R.S.T.): die Datei exportiert die reinen Funktionen, der IO-Teil laeuft nur, wenn
// das Skript direkt aufgerufen wird.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assignTurnWindows,
  fingerprint,
  hasPunctuation,
  hasUppercase,
  normalizeWords,
  parseProviderTime,
  pickCounterpartChannel,
  wordErrorRate,
} from "../scripts/stt-wer.mjs";

// Der Fehler, der die erste Fassung um 7200 s verschoben hat: Telnyx liefert bei Aufnahmen
// "2026-08-06T09:41:32" OHNE Zonenanteil, bei Nachrichten "…Z". Date.parse liest den ersten
// als Ortszeit. Ohne diesen Test faellt die Verschiebung nur auf, wenn jemand die
// Turn-Tabelle mit der Uhr im Kopf gegenliest.
test("parseProviderTime: Zeitstempel ohne Zonenanteil ist UTC, nicht Ortszeit", () => {
  const ohneZone = parseProviderTime("2026-08-06T09:41:32");
  const mitZ = parseProviderTime("2026-08-06T09:41:32Z");
  assert.equal(ohneZone, mitZ);
  assert.equal(ohneZone, Date.UTC(2026, 7, 6, 9, 41, 32));
});

test("parseProviderTime: expliziter Offset bleibt unangetastet", () => {
  assert.equal(parseProviderTime("2026-08-06T11:41:32+02:00"), Date.UTC(2026, 7, 6, 9, 41, 32));
});

// Umlaute sind bedeutungstragend ("Vaters" vs. "Satzes" war genau der Live-Fehlgriff) - eine
// Normalisierung, die sie wegwirft, wuerde einen echten Erkennungsfehler unsichtbar machen.
test("normalizeWords: Umlaute bleiben, Satzzeichen und Grossschreibung fallen", () => {
  assert.deepEqual(normalizeWords("Du beendest seine Sätze irgendwie nicht!"), [
    "du", "beendest", "seine", "sätze", "irgendwie", "nicht",
  ]);
});

test("normalizeWords: leerer/fehlender Text ergibt eine leere Liste", () => {
  assert.deepEqual(normalizeWords(""), []);
  assert.deepEqual(normalizeWords(null), []);
});

test("wordErrorRate: identische Woerter ergeben 0", () => {
  const words = normalizeWords("du bist ein idiot");
  assert.equal(wordErrorRate(words, words).rate, 0);
});

// Die drei Fehlerarten getrennt zu zaehlen ist kein Luxus: viele "fehlend" heisst
// abgeschnitten, viele "ersetzt" heisst falsch verstanden - zwei verschiedene Wurzeln.
test("wordErrorRate: trennt Ersetzung, Einfuegung und Auslassung", () => {
  const ersetzt = wordErrorRate(normalizeWords("ein idiot"), normalizeWords("anil jones"));
  assert.equal(ersetzt.substitutions, 2);
  assert.equal(ersetzt.rate, 1);

  const fehlend = wordErrorRate(normalizeWords("du bist ein idiot"), normalizeWords("du bist"));
  assert.equal(fehlend.deletions, 2);
  assert.equal(fehlend.rate, 0.5);

  const eingefuegt = wordErrorRate(normalizeWords("ja toll"), normalizeWords("ja ja toll"));
  assert.equal(eingefuegt.insertions, 1);
});

test("wordErrorRate: leere Referenz liefert NaN statt Division durch null", () => {
  assert.ok(Number.isNaN(wordErrorRate([], normalizeWords("irgendwas")).rate));
});

// Die Zuordnung wird gemessen, nicht angenommen: der Kanal, der dem bekannten Agententext
// AEHNLICHER ist (niedrigere WER), ist der Agent - der andere ist die Gegenstelle.
test("pickCounterpartChannel: waehlt den Kanal, der NICHT der Agent ist", () => {
  assert.equal(pickCounterpartChannel([0.9, 0.05]), 0);
  assert.equal(pickCounterpartChannel([0.05, 0.9]), 1);
});

// fingerprint ist das Messinstrument fuer "hat der Anbieter den Query-Parameter ueberhaupt
// gelesen?" (Kopf-Kommentar zur Namensfalle in scripts/stt-wer.mjs). Beide Richtungen muessen
// belegt sein: eine konstante Funktion (() => "abc") wuerde nur die erste Haelfte bestehen.
test("fingerprint: gleicher Text ergibt gleichen Hash", () => {
  const text = "koennen sie das bitte wiederholen";
  assert.equal(fingerprint(text), fingerprint(text));
});

test("fingerprint: unterschiedlicher Text ergibt unterschiedlichen Hash", () => {
  const eins = fingerprint("ich habe sie leider nicht verstanden");
  const zwei = fingerprint("der techniker kommt am dienstag vorbei");
  assert.notEqual(eins, zwei);
});

// Satzzeichen/Grossschreibung werden separat von normalizeWords geprueft - die WER wirft
// beides bewusst weg, hier soll es sichtbar bleiben (Kommentar bei PUNCTUATION im Skript).
test("hasPunctuation: erkennt Satzzeichen", () => {
  assert.equal(hasPunctuation("Guten Tag, wie kann ich helfen?"), true);
});

test("hasPunctuation: Text ohne Satzzeichen liefert false", () => {
  assert.equal(hasPunctuation("guten tag wie kann ich helfen"), false);
});

test("hasUppercase: erkennt Grossbuchstaben", () => {
  assert.equal(hasUppercase("Guten Tag"), true);
});

test("hasUppercase: durchgehend kleingeschriebener Text liefert false", () => {
  assert.equal(hasUppercase("guten tag"), false);
});

test("assignTurnWindows: schneidet die Referenzwoerter an den Erkennungs-Zeitpunkten", () => {
  const startMs = Date.UTC(2026, 7, 6, 9, 40, 16);
  const messages = [
    { ended_at: "2026-08-06T09:40:23Z", text: "erste erkennung" },
    { ended_at: "2026-08-06T09:40:30Z", text: "zweite erkennung" },
  ];
  const words = [
    { start: 1, text: "eins" },
    { start: 6, text: "zwei" },
    { start: 9, text: "drei" },
    { start: 20, text: "danach" },
  ];
  const { turns, trailing } = assignTurnWindows(messages, words, startMs);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].spoken, "eins zwei");
  assert.equal(turns[1].spoken, "drei");
  assert.equal(turns[0].recognized, "erste erkennung");
  assert.equal(trailing, "danach");
});
