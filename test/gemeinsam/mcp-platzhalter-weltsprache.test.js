import { test } from "node:test";
import assert from "node:assert/strict";

process.env.WORLD_DEFAULT_LANGUAGE_ENABLED = "true";
const { pickTranscript } = await import("../../src/mcp-tools.js");

const PLATZHALTER_DE = "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)";

test("WSP-17 (Rueckfall-Platzhalter) - ohne Texte des Mandanten bleibt der Platzhalter deutsch, auch wenn die Weltsprache englisch ist", () => {
  const fertig = { status: "completed", summary: null, failureReason: null };
  assert.equal(pickTranscript("call_1", fertig).result_summary, PLATZHALTER_DE);
});
