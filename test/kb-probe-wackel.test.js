import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unbenutzt } from "../src/kb-probe.js";
const ZAEHLER = process.env.KB_PROBE_ZAEHLER ?? join(tmpdir(), "kb-probe-wackel.zaehler");
const WACKELNDE_AUSFUEHRUNG = 2;
test("KB-Probe wackelt bei der zweiten Ausführung", () => {
  assert.equal(typeof unbenutzt, "string");
  appendFileSync(ZAEHLER, `${process.cwd()}\n`);
  if (readFileSync(ZAEHLER, "utf8").trim().split("\n").length !== WACKELNDE_AUSFUEHRUNG) return;
  throw new Error("wackelt");
});
