import assert from "node:assert/strict";
import { test } from "node:test";

import { ANTWORT, einordnen } from "../src/vs-probe.js";

test("VS-Probe ordnet Zahlen ein", () => {
  assert.equal(einordnen(-1), "negativ");
  assert.equal(einordnen(0), "positiv");
  assert.equal(einordnen(ANTWORT), "antwort");
  assert.equal(einordnen(1), "positiv");
});
