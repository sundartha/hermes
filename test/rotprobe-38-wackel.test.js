import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const MERKER = join(tmpdir(), "rotprobe-38-wackel");

test("Rot-Probe 38: der erste Lauf ist rot, der zweite grün", () => {
  const zweiterLauf = existsSync(MERKER);
  writeFileSync(MERKER, "1");
  assert.equal(zweiterLauf, true);
});
