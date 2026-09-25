// ---- ST3 (O3): Unit-Test der reinen B1-Heuristik (src/elevenlabs/b1-doppelankaendigung.js)
// Nur gegen findeB1Treffer - kein Store, kein Netz, kein Reporter (die leben in
// test/el-fixtures-echte-antworten.test.js auf dem echten Poll-Pfad, AS7/AS8).
// Grenzfaelle zuerst (T5/G3): die Mitte (zwei Cues + klarer Overlap) ist der Vorfall,
// die Raender entscheiden, ob die Heuristik flaechig feuert oder eng.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findeB1Treffer } from "../src/elevenlabs/b1-doppelankaendigung.js";

const agentZeile = (message) => ({ role: "agent", message });

// Der Wortlaut des Vorfalls 2026-09-02 (tasks/PLAN-AGENTEN-STIMME.md), auf die zwei
// Ankuendigungs-Saetze reduziert - das B1-Paar ist byte-erhalten (s. AS7-Fixture).
const VORFALL_PAAR = "Gut, dann erzähle ich dir ein kurzes Gedicht. Klar, hier ein kurzes Gedicht:\n\nZeile";
const VORFALL_PAAR_MIT_MARKE =
  "Gut, dann erzähle ich dir ein kurzes Gedicht. [fröhlich] Klar, hier ein kurzes Gedicht:\n\nZeile";

test("el-b1: Vorfall-Paar feuert exakt 1x - mit UND ohne Audio-Marke vor dem zweiten Satz", () => {
  assert.deepEqual(findeB1Treffer([agentZeile(VORFALL_PAAR)]), [{ zeile: 0, cues: ["gut", "klar"] }]);

  // Die Marke darf nichts aendern: sie ist nicht Teil des Satzes, sondern gesprochener
  // B2-Defekt (derselbe Vorfall, gemessen) - die B1-Frage steht und faellt mit ihr nicht.
  assert.deepEqual(findeB1Treffer([agentZeile(VORFALL_PAAR_MIT_MARKE)]), [
    { zeile: 0, cues: ["gut", "klar"] },
  ]);

  // EIN Treffer je Zeile, auch wenn eine Zeile ZWEI Cue-Paare enthaelt: gezaehlt wird das
  // Auftreten des Defekts pro Aeusserung, nicht seine Wiederholung darin. (Beide Paare
  // sind einzeln trefferfaehig - eine sammelnde Schleife kaeme hier auf 3.)
  const doppelpaar =
    "Gut, hier ist ein kurzes Gedicht. Klar, hier ist ein kurzes Gedicht. " +
    "Okay, ich lese ein kurzes Gedicht vor. Sure, ich lese ein kurzes Gedicht vor.";
  const trefferDerDoppelzeile = findeB1Treffer([agentZeile(doppelpaar)]);
  assert.equal(trefferDerDoppelzeile.length, 1);
  assert.deepEqual(trefferDerDoppelzeile, [{ zeile: 0, cues: ["gut", "klar"] }]);
});

test("el-b1: NICHT unmittelbar aufeinanderfolgende Saetze bleiben draussen (enge Lesart)", () => {
  const mitSatzDazwischen =
    "Klar, ich erzähle ein kurzes Gedicht. Einen Moment noch. Gut, hier ist ein kurzes Gedicht:";
  assert.deepEqual(findeB1Treffer([agentZeile(mitSatzDazwischen)]), []);
});

test("el-b1: Cue-Paar OHNE gemeinsame Inhalts-Lexeme schweigt (Overlap-Schwelle)", () => {
  const ohneOverlap = "Gut, das mache ich. Klar, das erledige ich bald.";
  assert.deepEqual(findeB1Treffer([agentZeile(ohneOverlap)]), []);
});

test("el-b1: Lexem-Overlap OHNE Leit-Cues schweigt (Cue-Schwelle)", () => {
  const overlapOhneCues = "Ich erzähle ein kurzes Gedicht. Es folgt ein kurzes Gedicht:";
  assert.deepEqual(findeB1Treffer([agentZeile(overlapOhneCues)]), []);
});

test("el-b1: Anrufer-Zeilen, Zeilen ohne message und leere Listen bleiben draussen", () => {
  // Anrufer-Zeile mit cue-eroeffnetem Doppel - NICHT unsere Achse (B2-Lehre: Klammern und
  // Wiederholungen der Gegenseite sagen nichts ueber unseren Agenten).
  const anruferDoppel = "Klar, ein kurzes Gedicht. Gut, hier ein kurzes Gedicht:";
  assert.deepEqual(findeB1Treffer([{ role: "user", message: anruferDoppel }]), []);

  // Werkzeug-Ereignisse tragen keine message (gesprochenLines filtert sie upstream;
  // die Heuristik darf darauf nicht stehen bleiben, wenn sie doch durchreicht werden).
  assert.deepEqual(findeB1Treffer([{ role: "agent" }, { role: "agent", message: null }]), []);

  assert.deepEqual(findeB1Treffer([]), []);
});

test("el-b1: englisches und franzoesisches Cue-Paar feuern (Sprachabdeckung)", () => {
  const enPaar = "Sure, I will tell a short poem. Okay, here is a short poem:";
  assert.deepEqual(findeB1Treffer([agentZeile(enPaar)]), [{ zeile: 0, cues: ["sure", "okay"] }]);

  const frPaar = "Parfait, je vais te raconter un court poème. Bien, voici un court poème:";
  assert.deepEqual(findeB1Treffer([agentZeile(frPaar)]), [{ zeile: 0, cues: ["parfait", "bien"] }]);
});

test("el-b1: Umlaute und Diakritika stoeren Cue- und Lexem-Vergleich nicht", () => {
  const natuerlichesPaar = "Natuerlich, ein kurzes Gedicht. Gern, hier ist ein kurzes Gedicht:";
  assert.deepEqual(findeB1Treffer([agentZeile(natuerlichesPaar)]), [
    { zeile: 0, cues: ["natuerlich", "gern"] },
  ]);

  // Diakritika im INHALT: "köstliches" und "köstliches" muessen nach der Normalisierung
  // als gemeinsames Lexem zaehlen, sonst hinge die Schwelle an der Schreibweise.
  const diakritikaImInhalt =
    "Natuerlich, ich erzähle ein köstliches Gedicht. Gern, hier ist ein köstliches Gedicht:";
  assert.deepEqual(findeB1Treffer([agentZeile(diakritikaImInhalt)]), [
    { zeile: 0, cues: ["natuerlich", "gern"] },
  ]);
});

test("el-b1: Treffer tragen NUR zeile und cues (R8-Vertrag beginnt an der Datenstruktur)", () => {
  const treffer = findeB1Treffer([agentZeile(VORFALL_PAAR)]);
  // deepEqual ueber die GANZE Rueckgabe pinnt die Form: kein Satz, kein Wortlaut, kein
  // zusaetzliches Feld - was hier durchgeht, landet spaeter im Log und im Zaehlfeld.
  assert.deepEqual(treffer, [{ zeile: 0, cues: ["gut", "klar"] }]);
  for (const einzeltreffer of treffer) {
    assert.deepEqual(Object.keys(einzeltreffer).sort(), ["cues", "zeile"]);
  }
});
