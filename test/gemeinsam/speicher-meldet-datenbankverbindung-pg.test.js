import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgTestBackend } from "../pg-helpers.js";

const FEHLERDETAIL = "verbindung_b2_kaputt";

test("B2-S2: pg-Speicher: Verbindungsprobe gelingt gegen die Datenbank und scheitert mit dem Runner", async () => {
  const { backend, runner } = await makePgTestBackend();
  const antwort = await backend.pruefeVerbindung();
  assert.deepEqual(antwort.rows, [{ "?column?": 1 }]);
  runner.withClient = () => Promise.reject(new Error(FEHLERDETAIL));
  await assert.rejects(backend.pruefeVerbindung(), { message: FEHLERDETAIL });
});
