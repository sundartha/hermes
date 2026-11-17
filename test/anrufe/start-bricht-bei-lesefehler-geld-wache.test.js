import { test } from "node:test";
import assert from "node:assert/strict";
import { LESEFEHLER, startMitLesefehlerBeiLesung } from "./start-lesefehler-helfer.js";

const ZWEITE_LESUNG = 2;

test("Neustart: scheitert das Lesen der laufenden Anrufe fuer die Geld-Wache, bricht der Start ab und lauscht nie", async () => {
  const { fehler, lauscht } = await startMitLesefehlerBeiLesung(ZWEITE_LESUNG);
  assert.match(String(fehler?.message), new RegExp(LESEFEHLER.replace(/[()]/g, "\\$&")));
  assert.equal(lauscht, 0);
});
