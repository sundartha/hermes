import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEMPLATE = JSON.parse(
  readFileSync(
    new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url),
    "utf8",
  ),
);

const AGENT = TEMPLATE.agent.conversation_config.agent;
const PROMPT = AGENT.prompt.prompt;

const TOOL_CONFIG = TEMPLATE.tools.get_consult.tool_config;

const sectionOf = (heading) =>
  PROMPT.split("\n\n")
    .filter((section) => section.startsWith(heading))
    .join("\n\n");

test("Problem im Anruf: Prompt verlangt get_consult vor Nachricht und Auflegen", () => {
  const section = sectionOf("CONSULT TOOL (get_consult):");
  assert.match(section, /no suitable appointment/);
  assert.match(section, /unclear or missing details/);
  assert.match(section, /outside your mandate/);
  assert.match(section, /BEFORE you take a message and BEFORE you hang up, at most once per call/);
});

test("Problem im Anruf: CLOSING-Ausnahme verbietet Verabschiedung und Auflegen vor der Rueckfrage", () => {
  const section = sectionOf("CLOSING EXCEPTION (get_consult):");
  assert.match(
    section,
    /EXCEPTION to CLOSING: while reaching your principal is "available" and a blocking problem is still unsolved, do not say goodbye and do not hang up before you have put the question to your principal once with get_consult\./,
  );
});

test("Werkzeugbeschreibung von get_consult erlaubt den Aufruf bei Problemfaellen", () => {
  const description = TOOL_CONFIG.description;
  assert.doesNotMatch(description, /sparingly/);
  assert.doesNotMatch(description, /Use ONLY when a missing detail blocks the task/);
  assert.match(description, /blocking problem/);
});
