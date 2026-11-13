import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startServer } from "../helpers.js";

const HTTP_OK = 200;
const OHNE_ZEITSTEMPEL = { "Content-Type": "application/json" };
const WIEDERHOLT = "wiederholte_zustellung weg=vorspann";

const senden = async (srv, callId) =>
  (
    await abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
      method: "POST",
      headers: OHNE_ZEITSTEMPEL,
      body: JSON.stringify({ data: { event_type: "call.hangup", payload: {} } }),
    })
  ).status;

test("Vorspann-Zustellungen ohne Zeitstempel: jede wird verarbeitet, keine als Doppelzustellung verschluckt", async () => {
  const srv = await startServer({});
  try {
    assert.equal(await senden(srv, "call_ohne_anker_1"), HTTP_OK);
    assert.equal(await senden(srv, "call_ohne_anker_2"), HTTP_OK);
    assert.equal(await senden(srv, "call_ohne_anker_1"), HTTP_OK);
    assert.ok(!srv.stdout.includes(WIEDERHOLT), srv.stdout);
  } finally {
    await srv.stop();
  }
});
