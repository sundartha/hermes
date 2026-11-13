import assert from "node:assert/strict";
import { test } from "node:test";

import { makeSentenceChunker } from "../../src/speech-chunker.ts";

const FAELLE = [
  ["Zeilenumbruch", "Guten Tag, hier ist Hermes.\nWie kann ich helfen?"],
  ["Leerzeile", "Guten Tag, hier ist Hermes.\n\nWie kann ich helfen?"],
  ["zwei Leerzeichen", "Guten Tag, hier ist Hermes.  Wie kann ich helfen?"],
];

for (const [name, text] of FAELLE) {
  test(`satzende-luecke: ${name} nach dem Satzende trennt den Satz sofort ab`, () => {
    const out = [];
    const chunker = makeSentenceChunker({ onChunk: (s) => out.push(s) });
    chunker.pushText(text);
    assert.equal(out.length, 1);
    assert.equal(out[0], "Guten Tag, hier ist Hermes.");
  });
}
