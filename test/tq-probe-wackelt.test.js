import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const ZAEHLER = join(tmpdir(), "tq-probe-wackelt-zaehler");

test("TQ-Probe wackelt", () => {
  const zaehler = existsSync(ZAEHLER) ? Number(readFileSync(ZAEHLER, "utf8")) : 0;
  writeFileSync(ZAEHLER, String(zaehler + 1));
  assert.equal(zaehler % 2, 0);
});
