import { test } from "node:test";
import assert from "node:assert/strict";
import { LESEFEHLER, startMitLesefehlerBeiLesung } from "./start-lesefehler-helfer.js";

const ZWEITER_DURCHGANG = 2;

test("Neustart: scheitert das Lesen der laufenden Anrufe fuer die Geld-Wache, bricht der Start ab und lauscht nie", async () => {
  const { fehler, lauscht } = await startMitLesefehlerBeiLesung(ZWEITER_DURCHGANG);
  assert.equal(fehler?.message, LESEFEHLER);
  assert.equal(lauscht, 0);
});
