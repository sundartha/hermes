import { test } from "node:test";
import assert from "node:assert/strict";
import { findeB1Treffer } from "../../src/elevenlabs/b1-doppelankaendigung.js";

const agentZeile = (message) => ({ role: "agent", message });

const VORFALL_PAAR =
  "Gut, dann erzähle ich dir ein kurzes Gedicht. Klar, hier ein kurzes Gedicht:\n\nZeile";
const VORFALL_PAAR_MIT_MARKE =
  "Gut, dann erzähle ich dir ein kurzes Gedicht. [fröhlich] Klar, hier ein kurzes Gedicht:\n\nZeile";

test("el-b1: Vorfall-Paar feuert exakt 1x - mit UND ohne Audio-Marke vor dem zweiten Satz", () => {
  assert.deepEqual(findeB1Treffer([agentZeile(VORFALL_PAAR)]), [
    { zeile: 0, cues: ["gut", "klar"] },
  ]);

  assert.deepEqual(findeB1Treffer([agentZeile(VORFALL_PAAR_MIT_MARKE)]), [
    { zeile: 0, cues: ["gut", "klar"] },
  ]);

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
  const anruferDoppel = "Klar, ein kurzes Gedicht. Gut, hier ein kurzes Gedicht:";
  assert.deepEqual(findeB1Treffer([{ role: "user", message: anruferDoppel }]), []);

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

  const diakritikaImInhalt =
    "Natuerlich, ich erzähle ein köstliches Gedicht. Gern, hier ist ein köstliches Gedicht:";
  assert.deepEqual(findeB1Treffer([agentZeile(diakritikaImInhalt)]), [
    { zeile: 0, cues: ["natuerlich", "gern"] },
  ]);
});

test("el-b1: Treffer tragen NUR zeile und cues (R8-Vertrag beginnt an der Datenstruktur)", () => {
  const treffer = findeB1Treffer([agentZeile(VORFALL_PAAR)]);
  assert.deepEqual(treffer, [{ zeile: 0, cues: ["gut", "klar"] }]);
  for (const einzeltreffer of treffer) {
    assert.deepEqual(Object.keys(einzeltreffer).sort(), ["cues", "zeile"]);
  }
});
