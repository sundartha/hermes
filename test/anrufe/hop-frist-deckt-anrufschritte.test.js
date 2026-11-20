import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PLACE_CALL_HOP_TIMEOUT_MS } from "../../src/mcp-tools.js";
import { config } from "../../src/config.js";
import { DEDUP_WINDOW_MS } from "../../src/telephony/call-dedup.ts";

const BRIEFING_STEPS = 2;
const LONG_BRIEFING_MS = 30000;
const VORSPANN_TTS_FRIST_MS = 5000;
const ANRUF_STEUERN_FRIST_MS = 8000;
const HOP_PUFFER_MS = 5000;
const DEFAULT_HOP_MS = 60000;

function hopFristMitBriefing(briefingMs) {
  const code = [
    'import { PLACE_CALL_HOP_TIMEOUT_MS } from "./src/mcp-tools.js";',
    'import { DEDUP_WINDOW_MS } from "./src/telephony/call-dedup.ts";',
    "console.log(JSON.stringify({ hop: PLACE_CALL_HOP_TIMEOUT_MS, dedup: DEDUP_WINDOW_MS }));",
  ].join("\n");
  const lauf = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PRECALL_BRIEFING_TIMEOUT_MS: String(briefingMs) },
  });
  assert.equal(lauf.status, 0, lauf.stderr);
  const zeilen = lauf.stdout.trim().split("\n");
  return JSON.parse(zeilen.pop());
}

test("Hop-Frist liegt ueber Briefing-Schritten, Vorspann-Frist und Dial-Frist", () => {
  const summe = BRIEFING_STEPS * config.llm.briefingTimeoutMs + VORSPANN_TTS_FRIST_MS + ANRUF_STEUERN_FRIST_MS;
  assert.ok(PLACE_CALL_HOP_TIMEOUT_MS > summe);
});

test("Mit Standardwerten bleibt die Hop-Frist 60 Sekunden", () => {
  assert.equal(PLACE_CALL_HOP_TIMEOUT_MS, DEFAULT_HOP_MS);
});

test("Ein langes Briefing hebt die Hop-Frist an, das Dedup-Fenster bleibt darueber", () => {
  const summe = BRIEFING_STEPS * LONG_BRIEFING_MS + VORSPANN_TTS_FRIST_MS + ANRUF_STEUERN_FRIST_MS;
  const { hop, dedup } = hopFristMitBriefing(LONG_BRIEFING_MS);
  assert.equal(hop, summe + HOP_PUFFER_MS);
  assert.ok(dedup >= hop);
  assert.equal(dedup, DEDUP_WINDOW_MS);
});
