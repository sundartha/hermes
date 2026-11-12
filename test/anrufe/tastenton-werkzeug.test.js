import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEMPLATE = JSON.parse(
  readFileSync(
    new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url),
    "utf8",
  ),
);
const TOOL_NAME = "play_keypad_touch_tone";
const tool = () => TEMPLATE.agent.conversation_config.agent.prompt.built_in_tools[TOOL_NAME];
const description = () => (tool()?.description ?? "").toLowerCase();

test("Tastenton-Werkzeug: der Anruf-Agent hat das Systemwerkzeug des Sprachanbieters", () => {
  assert.equal(tool()?.type, "system");
  assert.equal(tool()?.name, TOOL_NAME);
  assert.equal(tool()?.params?.system_tool_type, TOOL_NAME);
  assert.equal(tool()?.tool_config?.interruption_mode, "allow");
});

test("Tastenton-Werkzeug: die Beschreibung erlaubt den Einsatz nur im automatischen Menue", () => {
  assert.match(description(), /only while an automated menu/);
  assert.match(description(), /explicitly (asks|tells)/);
});

test("Tastenton-Werkzeug: Stern und Raute nur, wenn die Ansage sie nennt", () => {
  assert.match(description(), /\* or # only if the announcement names/);
});

test("Tastenton-Werkzeug: ausserhalb des Menues und gegenueber Menschen verboten, kein Raten", () => {
  assert.match(description(), /never use this outside an automated menu/);
  assert.match(description(), /never to guess/);
  assert.match(description(), /person/);
});
