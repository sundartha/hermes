import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

test("anruf-fremder-mandant-404: GET /api/calls/:id liefert fuer den Anruf eines anderen Mandanten 404 ohne Inhalt, fuer den eigenen 200", async () => {
  const calls = [
    seedCall({ id: "call_eigen", status: "completed" }),
    seedCall({
      id: "call_fremd",
      status: "completed",
      tenantId: "fremder-mandant",
      goal: "Geheimes Ziel des Fremden",
      transcript: [{ role: "agent", text: "Geheimer Fremdtext" }],
    }),
  ];
  const srv = await startServer({ env: { FAKE_ORIGINATE: "true" }, seed: seedState({ calls }) });
  try {
    const fremd = await abrufMitFrist(`${srv.localUrl}/api/calls/call_fremd`);
    assert.equal(fremd.status, HTTP_NOT_FOUND);
    const koerper = await fremd.json();
    assert.deepEqual(koerper, { error: "not found" });
    assert.equal(JSON.stringify(koerper).includes("Geheim"), false);

    const eigen = await abrufMitFrist(`${srv.localUrl}/api/calls/call_eigen`);
    assert.equal(eigen.status, HTTP_OK);
    assert.equal((await eigen.json()).id, "call_eigen");
  } finally {
    await srv.stop();
  }
});
