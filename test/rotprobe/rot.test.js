import assert from "node:assert/strict";
import { test } from "node:test";

test("Rot-Probe im Unterordner stoppt den Lauf", () => {
  assert.equal("tatsaechlich", "erwartet");
});
