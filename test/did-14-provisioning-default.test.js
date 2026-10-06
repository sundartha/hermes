import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";

test("DID-14 (Mechanismus, gruen) - PROVISIONING_ENABLED Default ist false (schuetzt jeden internationalen Kauf)", () => {
  assert.equal(config.provisioning.provisioningEnabled, false);
});
