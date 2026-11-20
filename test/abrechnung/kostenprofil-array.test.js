import assert from "node:assert/strict";
import { test } from "node:test";

import { kostenprofilFuerAnruf } from "../../src/billing/kostenarten.ts";

test("Kostenprofil je Anruf: costProfile als Array mit einem Profilnamen liefert den Namen als Text", () => {
  const faelle = [[{ costProfile: ["telnyx_budget"] }, "telnyx_budget"]];
  for (const [anruf, erwartet] of faelle) assert.equal(kostenprofilFuerAnruf(anruf), erwartet);
});
