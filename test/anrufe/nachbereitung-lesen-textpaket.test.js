import assert from "node:assert/strict";
import { test } from "node:test";

import { quelltexteUnter } from "../helpers.js";

const DIREKTLESER = ["src/telephony/call-finish.js", "src/mcp/anruf-lesen.js"];

test("Nachbereitung und MCP-Lesen lesen die Anrufsprache nie selbst aus localeFor(call", () => {
  const quellen = Object.fromEntries(quelltexteUnter("src"));
  const treffer = Object.entries(quellen)
    .filter(([datei, inhalt]) => datei !== "src/i18n/texte-paket.ts" && /localeFor\(call/.test(inhalt))
    .map(([datei]) => datei);
  assert.deepEqual(treffer, []);
  for (const datei of DIREKTLESER) {
    assert.match(quellen[datei], /textePaketFuer\(call/);
    assert.doesNotMatch(quellen[datei], /localeFor/);
  }
});
