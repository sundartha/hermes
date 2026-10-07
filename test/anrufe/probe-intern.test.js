import { test } from "node:test";
import assert from "node:assert/strict";
import * as voreinstellungen from "../../src/store/defaults.js";

test("probe: die Voreinstellungen des Speichers sind ladbar", () => {
  assert.equal(typeof voreinstellungen, "object");
});
