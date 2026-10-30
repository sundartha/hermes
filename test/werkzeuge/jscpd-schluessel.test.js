import assert from "node:assert/strict";
import { test } from "node:test";

import { TOOLS } from "../../tools/basis-vergleich.mjs";

test("Schlüssel eines jscpd-Befunds: die zwei Dateien des Paars stehen vor der Tokenzahl", () => {
  assert.deepEqual(TOOLS.jscpd.pair("src/mcp/schemata.js|test/mcp-ui.test.js|51"), ["src/mcp/schemata.js", "test/mcp-ui.test.js"]);
});

test("Schlüssel eines jscpd-Befunds: die Tokenzahl ist die Zahl am Ende", () => {
  assert.equal(TOOLS.jscpd.tokens("src/mcp/schemata.js|test/mcp-ui.test.js|51"), 51);
});
