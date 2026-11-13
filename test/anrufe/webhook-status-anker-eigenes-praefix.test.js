import assert from "node:assert/strict";
import { test } from "node:test";

import { TELNYX_TEST_SIGNATURE_HEADERS, seedWithTelnyxNumber, startServer, waitForLog } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const ZEILEN_TRENNER = "\n";
const STATUS_WIEDERHOLT = "wiederholte_zustellung weg=status art=antwort_wiederholt";

const zeilenMit = (srv, marke) => srv.stdout.split(ZEILEN_TRENNER).filter((zeile) => zeile.includes(marke));

const postVoice = (srv, pfad) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams({ CallStatus: "completed" }),
  });

test("Dieselbe Zustellung an /voice/turn und danach an /voice/status ohne callId: die Status-Meldung wird nicht als Wiederholung der Runde verschluckt", async () => {
  await startServer({ seed: seedWithTelnyxNumber({ language: "de" }) }).then(async (srv) => {
    try {
      assert.equal((await postVoice(srv, "/voice/turn?callId=call_unbekannt")).status, HTTP_OK);
      assert.equal((await postVoice(srv, "/voice/status")).status, HTTP_OK);
      assert.equal(zeilenMit(srv, STATUS_WIEDERHOLT).length, 0);
      assert.equal((await postVoice(srv, "/voice/status")).status, HTTP_OK);
      await waitForLog(srv, /wiederholte_zustellung weg=status art=antwort_wiederholt/);
      assert.equal(zeilenMit(srv, STATUS_WIEDERHOLT).length, 1);
    } finally {
      await srv.stop();
    }
  });
});
