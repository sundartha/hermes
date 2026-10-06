import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("liest Quelltext als Text", () => {
  const text = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
  assert.ok(text.length > 0);
});
