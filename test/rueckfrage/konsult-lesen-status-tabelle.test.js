import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { seedCall, seedState, startServer } from "../helpers.js";

const UMGEBUNG = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
});
const HALTEZEIT_MS = 1_500;

test("Ein aktiver Anruf ohne Rueckfrage liefert nicht das Ende, der Abruf haelt weiter", async () => {
  const instanz = await startServer({
    env: UMGEBUNG,
    seed: seedState({ calls: [seedCall({ id: "call_klt_a", status: "active" })] }),
  });
  try {
    const abruf = abrufMitFrist(`${instanz.localUrl}/api/calls/call_klt_a/consult`, {
      signal: AbortSignal.timeout(HALTEZEIT_MS),
    }).then((antwort) => antwort.json());
    await assert.rejects(abruf, { name: "TimeoutError" });
  } finally {
    await instanz.stop();
  }
});
