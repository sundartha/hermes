import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ART_WERT, VORLAGE_REL, wertAnPfad } from "../../scripts/lib/elevenlabs-besitz.mjs";

const vorlage = JSON.parse(readFileSync(new URL(`../../${VORLAGE_REL}`, import.meta.url), "utf8"));
const prompt = vorlage.agent.conversation_config.agent.prompt.prompt;
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

test("5543-K4 Prompt-Stellen: de, en und fr tragen dieselbe Regel", async () => {
  const { tempDataDir, seedState, seedCall } = await import("../helpers.js");
  process.env.DATA_DIR = tempDataDir(seedState({ calls: [], tenants: [] }));
  await import("../../src/config.js");
  const { systemPrompt } = await import("../../src/claude.js");
  const erwartet = {
    de: /Eine Nutzerzeile ohne Wörter, nur Punkte oder Satzzeichen, vor der ersten echten Äußerung ist Rauschen: bleibe still, keine Begrüßung und keine Frage\./,
    en: REGEL,
    fr: /Une ligne sans aucun mot, uniquement des points ou des signes de ponctuation, avant la première vraie parole est du bruit : reste silencieux, ni salutation ni question\./,
  };
  for (const [sprache, muster] of Object.entries(erwartet)) {
    assert.match(systemPrompt(seedCall({ direction: "outbound", language: sprache })), muster, sprache);
  }
});
