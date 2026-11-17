import assert from "node:assert/strict";
import { test } from "node:test";

import { LESEFEHLER, LESEN_VOR_DEN_RUECKFRAGEN, startMitDatenbank } from "./2973-h7b-start-helfer.js";

test("H7b-12: scheitert das Lesen der laufenden Anrufe fuer die verwaisten Rueckfragen, bricht der Start ab", async () => {
  const { fehler, server } = await startMitDatenbank(LESEN_VOR_DEN_RUECKFRAGEN);
  assert.equal(fehler?.message, LESEFEHLER);
  assert.equal(server, undefined);
  assert.match(fehler.stack, /expireOrphanedConsults/);
});
