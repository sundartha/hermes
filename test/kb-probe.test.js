import assert from "node:assert/strict";
import { test } from "node:test";
import * as probe from "../src/kb-probe.js";
test("KB-Probe rechnet", () => {
  assert.equal(probe.einordnen(-1), "negativ");
  assert.equal(probe.einordnen(0), "positiv");
  assert.equal(probe.einordnen(1), "positiv");
});
