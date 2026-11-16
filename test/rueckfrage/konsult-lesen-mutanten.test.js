import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { seedCall, seedState, startServer } from "../helpers.js";

const UMGEBUNG = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
});
const ENDE_EREIGNIS = Object.freeze({ event: "done", eventId: null, questions: [] });

const FAELLE = [
  { name: "ein beendeter Anruf liefert das Ende", anruf: { id: "call_klm_a", status: "completed" }, abfrage: "call_klm_a", status: 200, ereignis: ENDE_EREIGNIS },
  { name: "ein fehlgeschlagener Anruf liefert das Ende", anruf: { id: "call_klm_b", status: "failed" }, abfrage: "call_klm_b", status: 200, ereignis: ENDE_EREIGNIS },
  { name: "eine unbekannte Anruf-ID ist 404", anruf: { id: "call_klm_d", status: "completed" }, abfrage: "call_klm_unbekannt", status: 404, ereignis: null },
];

for (const { name, anruf, abfrage, status, ereignis } of FAELLE) {
  test(`Im JSON-Speicher: ${name}`, async () => {
    const instanz = await startServer({
      env: UMGEBUNG,
      seed: seedState({ calls: [seedCall(anruf)] }),
    });
    try {
      const antwort = await abrufMitFrist(`${instanz.localUrl}/api/calls/${abfrage}/consult`);
      assert.equal(antwort.status, status);
      if (ereignis) assert.deepEqual(await antwort.json(), ereignis);
    } finally {
      await instanz.stop();
    }
  });
}
