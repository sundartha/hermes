import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { istBlockierend } from "../../scripts/check-elevenlabs-drift.mjs";
import { ladeVorlage } from "../../scripts/lib/elevenlabs-agent-lesen.mjs";
import { setzeAnPfad, vergleicheBesitz } from "../../scripts/lib/elevenlabs-besitz.mjs";

const VORLAGE = ladeVorlage();
const LIVE_SPRACH_PRESETS = "conversation_config.language_presets";
const STIMME_REGEL = "stimme_nie_je_sprache_ueberschreiben";
const OFFENLEGUNG_REGEL = "offenlegung_nie_je_sprache_ueberschreiben";
const SPRACHE = "fr";
const ANDERE_SPRACHE = "de";
const ERFUNDENE_STIMME = "stimme-aus-dem-test";
const UEBERSETZUNG = "Bonjour, ici une IA.";

function befundZuPresets(presets) {
  const live = {};
  setzeAnPfad(live, LIVE_SPRACH_PRESETS, presets);
  return vergleicheBesitz({ vorlage: VORLAGE, live });
}

function verletzungenZu(befund, regel) {
  return befund.verletzungen.filter((zeile) => zeile.startsWith(`VERLETZUNG ${regel} `));
}

describe("Drift-Waechter 5198: eine Stimme im Sprach-Preset wird gemeldet", () => {
  it("AK1: tts.voice_id in einem Preset meldet eine Verletzung mit Sprache und blockiert den Lauf", () => {
    const befund = befundZuPresets({
      [ANDERE_SPRACHE]: { overrides: { tts: null } },
      [SPRACHE]: { overrides: { tts: { voice_id: ERFUNDENE_STIMME } } },
    });
    const treffer = verletzungenZu(befund, STIMME_REGEL);
    assert.equal(treffer.length, 1, `erwartet genau eine Verletzung: ${befund.verletzungen}`);
    assert.ok(treffer[0].includes(`${LIVE_SPRACH_PRESETS}."${SPRACHE}"`), treffer[0]);
    assert.ok(treffer[0].includes("overrides.tts.voice_id"), treffer[0]);
    assert.ok(treffer[0].includes("conversationConfigOverride"), treffer[0]);
    assert.equal(treffer[0].includes(ERFUNDENE_STIMME), false, "die Stimmen-ID steht im Befund");
    assert.equal(istBlockierend(befund), true);
  });

  it("AK2: Presets ohne overrides.tts oder mit tts null erzeugen keine Stimm-Verletzung", () => {
    const befund = befundZuPresets({
      [ANDERE_SPRACHE]: { overrides: {} },
      [SPRACHE]: { overrides: { tts: null } },
    });
    assert.deepEqual(verletzungenZu(befund, STIMME_REGEL), []);
    assert.equal(befund.regelnSoll, VORLAGE._besitz.regeln.length);
    assert.ok(VORLAGE._besitz.regeln.some((regel) => regel.regel === STIMME_REGEL));
  });

  it("AK3: das Verbot fuer first_message_translation.text gilt unveraendert", () => {
    const befund = befundZuPresets({
      [SPRACHE]: { first_message_translation: { text: UEBERSETZUNG } },
    });
    const treffer = verletzungenZu(befund, OFFENLEGUNG_REGEL);
    assert.equal(treffer.length, 1, `erwartet genau eine Verletzung: ${befund.verletzungen}`);
    assert.equal(verletzungenZu(befund, STIMME_REGEL).length, 0);
    assert.equal(istBlockierend(befund), true);
  });
});
