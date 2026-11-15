import { test } from "node:test";
import assert from "node:assert/strict";
import { findeB1Treffer } from "../../src/elevenlabs/b1-doppelankaendigung.ts";

const agentZeile = (message) => ({ role: "agent", message });

test("el-b1: ein Wort mit Ziffer am Anfang und Buchstaben danach zaehlt als gemeinsames Lexem", () => {
  const paar = "Gut, Tisch 20uhr. Klar, Tisch 20uhr.";
  assert.deepEqual(findeB1Treffer([agentZeile(paar)]), [{ zeile: 0, cues: ["gut", "klar"] }]);
});

test("el-b1: eine reine Zahl zaehlt nicht als gemeinsames Lexem", () => {
  const paar = "Gut, Tisch 2020. Klar, Tisch 2020.";
  assert.deepEqual(findeB1Treffer([agentZeile(paar)]), []);
});
