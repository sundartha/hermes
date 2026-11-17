import { test } from "node:test";
import assert from "node:assert/strict";
import { LESEFEHLER, startMitLesefehlerBeiLesung } from "./start-lesefehler-helfer.js";

const ERSTER_DURCHGANG = 1;

test("Neustart: scheitert das Lesen der laufenden Anrufe fuer die Fristen, bricht der Start ab und lauscht nie", async () => {
  const { fehler, lauscht } = await startMitLesefehlerBeiLesung(ERSTER_DURCHGANG);
  assert.match(String(fehler?.message), new RegExp(LESEFEHLER.replace(/[()]/g, "\\$&")));
  assert.equal(lauscht, 0);
});
