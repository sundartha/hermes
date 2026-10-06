import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("LAW-21: mcp-tools.js definiert keine Audio-Ausgabefelder (audioUrl/recordingUrl/base64)", () => {
  const src = fs.readFileSync(path.join(ROOT, "src", "mcp-tools.js"), "utf8");
  assert.doesNotMatch(
    src,
    /audioUrl|recordingUrl|base64/i,
    "mcp-tools.js darf keine Audio-Ausgabefelder tragen - Regel 5 (Audio NIEMALS durch MCP)",
  );
});

test("LAW-21: record_type in telnyx/voice.js ist Teil der Detail-Records-Billing-API, kein Aufnahme-Feature", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "src", "telephony", "adapters", "telnyx", "voice.js"),
    "utf8",
  );
  assert.match(
    src,
    /record_type/,
    "record_type muss als Billing-API-Enumwert vorkommen (Detail-Records, keine Aufnahmefunktion)",
  );
  assert.doesNotMatch(
    src,
    /recordingUrl|startRecording|StartRecording/,
    "telnyx/voice.js darf keine Aufnahme-Funktionalitaet enthalten",
  );
});
