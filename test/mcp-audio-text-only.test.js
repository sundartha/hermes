// i18n-Launch-Testkatalog, Block B3 (MCP-Schicht und Widgets).
// Katalog-ID: LAW-21 - Kein Audio, nur Text-Transkript verlaesst das System via MCP
// (CLAUDE.md Regel 5: "Audio laeuft NIEMALS durch MCP - nur Transkripte/Status.").
// Spezifikation: tasks/i18n-tests/09-recht-und-compliance.md.
//
// Mechanismus-Test (Regel R3 der kanonischen Liste, GRUEN): die Absolute Regel 5 aus
// CLAUDE.md ist im Bestand bereits so umgesetzt und soll es bleiben - kein Defekt, sondern
// eine dauerhafte Sicherung. Kein Produktionscode wird angefasst (Auftrag B3), dieser Test
// ist reiner Regressions-Waechter.
// Beleg: src/telephony/adapters/telnyx/voice.js:32-41,157 (record_type ist Teil der
// Detail-Records-Billing-API, KEIN Aufnahme-Feature); src/mcp-tools.js (keine
// Audio-Ausgabefelder).
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
  // Gegenprobe: kein Aufnahme-/Recording-Feature-Code in derselben Datei.
  assert.doesNotMatch(
    src,
    /recordingUrl|startRecording|StartRecording/,
    "telnyx/voice.js darf keine Aufnahme-Funktionalitaet enthalten",
  );
});
