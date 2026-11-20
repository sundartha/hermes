import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ART_WERT, VORLAGE_REL, wertAnPfad } from "../../scripts/lib/elevenlabs-besitz.mjs";

const vorlage = JSON.parse(readFileSync(new URL(`../../${VORLAGE_REL}`, import.meta.url), "utf8"));
const agentKonfiguration = vorlage.agent.conversation_config.agent;
const prompt = agentKonfiguration.prompt.prompt;
const FESTE_FRAGE =
  /sind sie noch da|bist du noch da|können sie mich hören|kannst du mich hören|are you still there|can you hear me|êtes-vous encore là|vous m'entendez/i;
const REGEL =
  /A user line without any words, only dots or punctuation marks, before the first real utterance is noise: stay silent, no greeting and no question\./;

test("5543-K1 Vorlage: turn.initial_wait_time ist 10 Sekunden (Vorspann 5 s plus 5 s Karenz)", () => {
  const treffer = wertAnPfad(vorlage, "agent.conversation_config.turn.initial_wait_time");
  assert.equal(treffer.gefunden, true);
  assert.equal(treffer.wert, 10);
});

test("5543-K2 Besitz: initial_wait_time ist ein Wert-Eintrag mit Vorlagen- und Live-Pfad", () => {
  const eintrag = vorlage._besitz.felder.find((e) => e.feld === "initial_wait_time");
  assert.ok(eintrag, "Besitz-Eintrag fehlt");
  assert.equal(eintrag.art, ART_WERT);
  assert.deepEqual(eintrag.vorlage, ["agent.conversation_config.turn.initial_wait_time"]);
  assert.deepEqual(eintrag.live, ["conversation_config.turn.initial_wait_time"]);
});

test("5543-K3 Prompt: eine Zeile ohne Wörter vor der ersten Äußerung ist Rauschen, ohne feste Frage und ohne eckige Klammer", () => {
  assert.match(prompt, REGEL);
  assert.doesNotMatch(prompt, FESTE_FRAGE);
  const satz = prompt.match(REGEL)[0];
  assert.doesNotMatch(satz, /[[\]]/);
});
