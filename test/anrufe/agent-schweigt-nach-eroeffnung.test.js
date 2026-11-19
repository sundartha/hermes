import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const VORLAGE = new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url);
const vorlagenPrompt = JSON.parse(readFileSync(VORLAGE, "utf8")).agent.conversation_config.agent.prompt.prompt;

let systemPrompt;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({ calls: [], tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }] }),
  );
  await import("../../src/config.js");
  ({ systemPrompt } = await import("../../src/claude.js"));
});

const promptFuer = (language) =>
  systemPrompt(seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: "outbound", language }));

test("5505 Vorlage: der Prompt verbietet die Frage nach Anwesenheit und Hoerbarkeit", () => {
  assert.match(vorlagenPrompt, /Never ask whether the other person is still there or can hear you/);
});

test("5505 Vorlage: nach der Eroeffnung Schweigen bis zur ersten Aeusserung, auch bei 8 Sekunden Stille", () => {
  assert.match(
    vorlagenPrompt,
    /after your opening stay silent until the other person speaks for the first time, even if it stays quiet for 8 seconds or more/,
  );
});

test("5505 Vorlage: keine feste deutsche Formulierung der Frage im Prompt", () => {
  assert.doesNotMatch(vorlagenPrompt, /ich kann (?:dich|Sie) (?:leider )?nicht hören/i);
  assert.doesNotMatch(vorlagenPrompt, /sind Sie noch da|bist du noch da/i);
});

test("5505 Deutsch: Regel in der Sprechregel, ohne Sie-Form", () => {
  const regel =
    "Frage nie, ob dein Gegenüber noch da ist oder dich hören kann; nach deiner Eröffnung schweigst du, bis dein Gegenüber zum ersten Mal spricht, auch wenn es mindestens 8 Sekunden still bleibt.";
  assert.ok(promptFuer("de").includes(regel));
});

test("5505 Englisch: Regel in der Sprechregel", () => {
  const regel =
    "Never ask whether the other person is still there or can hear you; after your opening stay silent until the other person speaks for the first time, even if it stays quiet for 8 seconds or more.";
  assert.ok(promptFuer("en").includes(regel));
});

test("5505 Franzoesisch: Regel in der Sprechregel", () => {
  const regel =
    "Ne demande jamais si ton interlocuteur est encore là ou s'il t'entend ; après ton ouverture, tais-toi jusqu'à ce que ton interlocuteur parle pour la première fois, même si le silence dure au moins 8 secondes.";
  assert.ok(promptFuer("fr").includes(regel));
});
