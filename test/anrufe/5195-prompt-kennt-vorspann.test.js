import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const VORLAGE = new URL("../../elevenlabs/agent_configs/outbound-agent.template.json", import.meta.url);
const konfiguration = JSON.parse(readFileSync(VORLAGE, "utf8")).agent.conversation_config;
const prompt = konfiguration.agent.prompt.prompt;
const SPERRE = /never say (?:the|your) task or (?:the )?reason for calling a second time/i;
const ANLIEGEN_VARIABLEN = ["{{opening_line}}", "{{objective}}"];

test("5195-K4: der Prompt verbietet, die schon gesprochene Eroeffnung zu wiederholen", () => {
  assert.ok(prompt.includes("{{eroeffnung_gesagt}}") || SPERRE.test(prompt));
});

test("5195-K4b: das Anliegen steht im Prompt nur zusammen mit dieser Sperre", () => {
  const mitAnliegen = ANLIEGEN_VARIABLEN.filter((name) => prompt.includes(name));
  assert.ok(mitAnliegen.length > 0);
  assert.match(prompt, SPERRE);
});

test("5195-K4c: die Sperre nennt das erste Hallo der Gegenseite als Fall", () => {
  assert.match(prompt, /even when the other party only says "Hello\?"/);
});
