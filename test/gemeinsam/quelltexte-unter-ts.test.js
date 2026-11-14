import assert from "node:assert/strict";
import { test } from "node:test";

import { quelltexteUnter } from "../helpers.js";

test("quelltexteUnter liest .ts-Quelldateien mit ihrem Text", () => {
  const dateien = new Map(quelltexteUnter("src/elevenlabs"));
  const ts = dateien.get("src/elevenlabs/inbound-bridges.ts");
  assert.equal(typeof ts, "string");
  assert.match(ts, /umleitenOderAuflegen/);
});

test("quelltexteUnter liest weiterhin .js-Quelldateien", () => {
  const dateien = new Map(quelltexteUnter("src/elevenlabs"));
  assert.match(dateien.get("src/elevenlabs/convai.js"), /export/);
});

test("quelltexteUnter überspringt andere Endungen", () => {
  const namen = quelltexteUnter("src/elevenlabs").map(([pfad]) => pfad);
  assert.ok(namen.every((pfad) => /\.(js|ts)$/.test(pfad)));
  assert.ok(!namen.some((pfad) => pfad.endsWith("CLAUDE.md")));
});
