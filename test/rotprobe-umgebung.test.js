import assert from "node:assert/strict";
import { test } from "node:test";

test("die Umgebung des PR-Laufs enthält kein Abo-Token", () => {
  const namen = Object.keys(process.env).sort();
  console.log(namen.join("\n"));
  assert.ok(!namen.includes("CLAUDE_CODE_OAUTH_TOKEN"));
});
