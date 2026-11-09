import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TEST_SCHLUESSEL, laufeMitAttrappe } from "./helpers/elevenlabs-push-attrappe.mjs";

const UMGEBUNGS_AGENT = "agent_aus_der_umgebung";
const ARGUMENT_AGENT = "agent_aus_dem_argument";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

process.env.ELEVENLABS_API_KEY = TEST_SCHLUESSEL;
process.env.ELEVENLABS_AGENT_ID = UMGEBUNGS_AGENT;
const { runCli } = await import("../scripts/push-elevenlabs.mjs");
const { ladeVorlage } = await import("../scripts/lib/elevenlabs-agent-lesen.mjs");

function gelesenerAgent(aufrufe) {
  const [erster] = aufrufe;
  const [, agent] = erster.adresse.split("/v1/convai/agents/");
  return agent;
}

function laufOhneZiel(skript) {
  const umgebung = { PATH: process.env.PATH, HOME: process.env.HOME, ELEVENLABS_API_KEY: TEST_SCHLUESSEL };
  return spawnSync(process.execPath, [join(REPO, "scripts", skript)], { cwd: REPO, env: umgebung, encoding: "utf8" });
}

describe("Ziel-Agent kommt aus der eigenen Umgebung", () => {
  it("ohne Argument liest der Push den Agenten aus ELEVENLABS_AGENT_ID", async () => {
    const { aufrufe } = await laufeMitAttrappe({ runCli, argumente: [] });
    assert.equal(gelesenerAgent(aufrufe), UMGEBUNGS_AGENT);
  });

  it("ein genannter Agent geht der Umgebung vor", async () => {
    const { aufrufe } = await laufeMitAttrappe({ runCli, argumente: [ARGUMENT_AGENT] });
    assert.equal(gelesenerAgent(aufrufe), ARGUMENT_AGENT);
  });

  for (const skript of ["push-elevenlabs.mjs", "check-elevenlabs-drift.mjs"]) {
    it(`${skript} ohne Argument und ohne ELEVENLABS_AGENT_ID bricht ab, statt den Live-Agenten zu nehmen`, () => {
      const lauf = laufOhneZiel(skript);
      assert.equal(lauf.status, 1);
      assert.match(lauf.stderr, /Kein Ziel-Agent/);
    });
  }
});

describe("Stimme und Erkennung gehoeren der Vorlage", () => {
  const vorlage = ladeVorlage();
  const besessen = new Map(vorlage._besitz.felder.map((feld) => [feld.feld, feld]));

  for (const [feld, pfad] of [
    ["tts_model_id", "conversation_config.tts.model_id"],
    ["tts_voice_id", "conversation_config.tts.voice_id"],
    ["tts_similarity_boost", "conversation_config.tts.similarity_boost"],
    ["tts_stability", "conversation_config.tts.stability"],
    ["turn_model", "conversation_config.turn.turn_model"],
  ]) {
    it(`${feld} ist besessen und wird mit ${pfad} verglichen`, () => {
      assert.deepEqual(besessen.get(feld)?.live, [pfad]);
    });
  }

  it("Modell und Stimme stehen nicht mehr unter _nicht_besessen", () => {
    const frei = vorlage._besitz._nicht_besessen.join("\n");
    assert.doesNotMatch(frei, /^tts\.(model_id|voice_id)/m);
  });
});
